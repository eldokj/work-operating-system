import type { Prisma, PrismaClient } from "@ai-task-manager/db";
import { PERMISSIONS } from "@ai-task-manager/shared";
import type {
  AddProjectMemberInput,
  AddProjectTeamInput,
  CreateProjectDateInput,
  CreateProjectInput,
  UpdateProjectDateInput,
  UpdateProjectInput,
} from "@ai-task-manager/shared";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { canAccessProject, type ProjectWithWorkspace } from "../permission-engine/project-access";
import { AuditService } from "./audit.service";
import { PermissionService } from "./permission.service";

const PERSON_SELECT = { id: true, fullName: true, email: true } satisfies Prisma.UserSelect;

const PROJECT_INCLUDE = {
  workspace: true,
  owner: { select: PERSON_SELECT },
  department: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
} satisfies Prisma.ProjectInclude;

export type ProjectDetail = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

/**
 * Project / Event Workspace — docs/architecture/17-phase2c-project-workspace-architecture-report.md.
 *
 * Extends the pre-existing (Phase 1, minimally wired) Project model rather than
 * introducing a competing "Workspace"-named entity — see doc 17 §2/§5 for why that name
 * is deliberately avoided. Holds no task/conversation/attachment authorization logic of
 * its own: those remain exactly TaskService.canViewTask / canAccessConversation /
 * TaskAttachmentService's own checks, completely unchanged (doc 17 §7/§10). This service
 * owns only: the Project row itself, its membership rosters (ProjectMember/ProjectTeam),
 * its dates, and the derived progress calculation.
 */
export class ProjectService {
  private readonly permissions: PermissionService;
  private readonly audit: AuditService;

  constructor(private readonly db: PrismaClient) {
    this.permissions = new PermissionService(db);
    this.audit = new AuditService(db);
  }

  /** No authorization — existence only, mirroring TaskService.getTaskRawByIdOrThrow. For
   * callers (ConversationService/TaskAttachmentService) that apply their own access rule. */
  async getProjectRawByIdOrThrow(projectId: string): Promise<ProjectDetail> {
    const project = await this.db.project.findUnique({ where: { id: projectId }, include: PROJECT_INCLUDE });
    if (!project) throw new NotFoundError("Project not found");
    return project;
  }

  async canAccessProject(userId: string, project: ProjectWithWorkspace): Promise<boolean> {
    return canAccessProject(this.db, this.permissions, userId, project);
  }

  async getProjectByIdOrThrow(actorId: string, projectId: string): Promise<ProjectDetail> {
    const project = await this.getProjectRawByIdOrThrow(projectId);
    if (!(await this.canAccessProject(actorId, project))) {
      throw new ForbiddenError("You do not have access to this project");
    }
    return project;
  }

  private async assertCanManage(actorId: string, project: ProjectDetail, permission: string): Promise<void> {
    if (project.workspace.type === "PERSONAL") {
      if (project.workspace.ownerUserId !== actorId) throw new ForbiddenError("You do not own this project");
      return;
    }
    if (project.ownerId === actorId) return;
    const organizationId = project.workspace.organizationId!;
    await this.permissions.assertOrgMember(actorId, organizationId);
    await this.permissions.assertCan(actorId, organizationId, permission as never, {
      teamId: project.teamId,
      departmentId: project.departmentId,
    });
  }

  // ── CRUD ──────────────────────────────────────────────────────────────

  async createProject(actorId: string, workspaceId: string, input: CreateProjectInput): Promise<ProjectDetail> {
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundError("Workspace not found");

    if (workspace.type === "PERSONAL") {
      if (workspace.ownerUserId !== actorId) throw new ForbiddenError("You do not own this workspace");
    } else {
      await this.permissions.assertOrgMember(actorId, workspace.organizationId!);
      await this.permissions.assertCan(actorId, workspace.organizationId!, PERMISSIONS.PROJECT_CREATE, {
        teamId: input.teamId,
        departmentId: input.departmentId,
      });
    }

    const project = await this.db.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          workspaceId,
          name: input.name,
          description: input.description,
          departmentId: input.departmentId,
          teamId: input.teamId,
          ownerId: actorId,
          kind: input.kind,
          startDate: input.startDate,
          targetDate: input.targetDate,
        },
      });

      // Every project gets exactly one main conversation, created transactionally with
      // the project — same invariant, same reasoning as Phase 2A's per-task conversation
      // (doc 15 §1.2, doc 17 §11): never lazily, so "duplicate primary conversation" is a
      // database guarantee (Conversation.projectId is @unique), not a race to guard
      // against elsewhere.
      await tx.conversation.create({
        data: { projectId: created.id, organizationId: workspace.organizationId ?? null },
      });

      // Owner is automatically listed as a participant for a coherent People tab — not
      // required for their own access (the owner-check in canAccessProject already covers
      // that unconditionally), purely so they visibly appear in the roster.
      await tx.projectMember.create({
        data: { projectId: created.id, userId: actorId, addedById: actorId },
      });

      const txAudit = new AuditService(tx);
      await txAudit.log({
        organizationId: workspace.organizationId,
        actorId,
        action: "project.created",
        entityType: "Project",
        entityId: created.id,
        projectId: created.id,
        after: { name: created.name, kind: created.kind },
      });

      return created;
    });

    return this.getProjectByIdOrThrow(actorId, project.id);
  }

  async updateProject(actorId: string, projectId: string, input: UpdateProjectInput): Promise<ProjectDetail> {
    const project = await this.getProjectByIdOrThrow(actorId, projectId);
    await this.assertCanManage(actorId, project, PERMISSIONS.PROJECT_MANAGE);

    const before = { name: project.name, status: project.status };
    await this.db.project.update({
      where: { id: projectId },
      data: {
        name: input.name,
        description: input.description,
        status: input.status,
        kind: input.kind,
        startDate: input.startDate,
        targetDate: input.targetDate,
      },
    });

    await this.audit.log({
      organizationId: project.workspace.organizationId,
      actorId,
      action: "project.updated",
      entityType: "Project",
      entityId: projectId,
      projectId,
      before,
      after: input,
    });

    return this.getProjectByIdOrThrow(actorId, projectId);
  }

  /** "Deletion" is archival (status=ARCHIVED), matching every other soft-delete/status-
   * transition convention in this codebase — never a hard delete. */
  async archiveProject(actorId: string, projectId: string): Promise<ProjectDetail> {
    const project = await this.getProjectByIdOrThrow(actorId, projectId);
    await this.assertCanManage(actorId, project, PERMISSIONS.PROJECT_MANAGE);

    await this.db.project.update({ where: { id: projectId }, data: { status: "ARCHIVED" } });
    await this.audit.log({
      organizationId: project.workspace.organizationId,
      actorId,
      action: "project.archived",
      entityType: "Project",
      entityId: projectId,
      projectId,
      before: { status: project.status },
      after: { status: "ARCHIVED" },
    });
    return this.getProjectByIdOrThrow(actorId, projectId);
  }

  /**
   * "My Projects" — doc 17 §2/§16 explicitly calls out that the pre-existing dashboard
   * widget lists every project in the workspace rather than ones the caller actually
   * participates in. Fixed here: for a personal workspace this is moot (only the owner
   * ever calls with their own workspaceId); for an organization workspace, filtered to
   * canAccessProject.
   */
  async listProjectsForUser(actorId: string, workspaceId: string): Promise<ProjectDetail[]> {
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundError("Workspace not found");

    if (workspace.type === "PERSONAL") {
      if (workspace.ownerUserId !== actorId) throw new ForbiddenError("You do not own this workspace");
      return this.db.project.findMany({ where: { workspaceId }, include: PROJECT_INCLUDE, orderBy: { createdAt: "desc" } });
    }

    await this.permissions.assertOrgMember(actorId, workspace.organizationId!);
    const all = await this.db.project.findMany({ where: { workspaceId }, include: PROJECT_INCLUDE, orderBy: { createdAt: "desc" } });
    const visible: ProjectDetail[] = [];
    for (const project of all) {
      if (await this.canAccessProject(actorId, project)) visible.push(project);
    }
    return visible;
  }

  // ── Membership ────────────────────────────────────────────────────────

  async listMembers(actorId: string, projectId: string) {
    const project = await this.getProjectByIdOrThrow(actorId, projectId);
    return this.db.projectMember.findMany({
      where: { projectId: project.id },
      include: { user: { select: PERSON_SELECT } },
      orderBy: { createdAt: "asc" },
    });
  }

  async addMember(actorId: string, projectId: string, input: AddProjectMemberInput) {
    const project = await this.getProjectByIdOrThrow(actorId, projectId);
    if (project.workspace.type === "PERSONAL") {
      // No cross-user collaboration in a personal workspace (doc 13 #11's confirmed rule,
      // applied here the same way it already applies to personal-task assignment).
      throw new ForbiddenError("Personal workspace projects cannot have other participants");
    }
    await this.assertCanManage(actorId, project, PERMISSIONS.WORKSPACE_PROJECT_MANAGE_MEMBERS);

    if (!(await this.permissions.isOrgMember(input.userId, project.workspace.organizationId!))) {
      throw new ValidationError("Target user is not a member of this organization");
    }

    const member = await this.db.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: input.userId } },
      update: {},
      create: { projectId, userId: input.userId, addedById: actorId },
    });

    await this.audit.log({
      organizationId: project.workspace.organizationId,
      actorId,
      action: "project.member_added",
      entityType: "ProjectMember",
      entityId: member.id,
      projectId,
      after: { userId: input.userId },
    });
    return member;
  }

  async removeMember(actorId: string, projectId: string, userId: string): Promise<void> {
    const project = await this.getProjectByIdOrThrow(actorId, projectId);
    await this.assertCanManage(actorId, project, PERMISSIONS.WORKSPACE_PROJECT_MANAGE_MEMBERS);

    if (userId === project.ownerId) {
      throw new ConflictError("Cannot remove the project owner from its member roster");
    }

    await this.db.projectMember.deleteMany({ where: { projectId, userId } });
    await this.audit.log({
      organizationId: project.workspace.organizationId,
      actorId,
      action: "project.member_removed",
      entityType: "ProjectMember",
      entityId: `${projectId}:${userId}`,
      projectId,
      after: { userId },
    });
  }

  async listTeams(actorId: string, projectId: string) {
    const project = await this.getProjectByIdOrThrow(actorId, projectId);
    return this.db.projectTeam.findMany({
      where: { projectId: project.id },
      include: { team: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async addTeam(actorId: string, projectId: string, input: AddProjectTeamInput) {
    const project = await this.getProjectByIdOrThrow(actorId, projectId);
    if (project.workspace.type === "PERSONAL") {
      throw new ForbiddenError("Personal workspace projects cannot have participating teams");
    }
    await this.assertCanManage(actorId, project, PERMISSIONS.WORKSPACE_PROJECT_MANAGE_MEMBERS);

    const team = await this.db.team.findUnique({ where: { id: input.teamId } });
    if (!team || team.organizationId !== project.workspace.organizationId) {
      throw new NotFoundError("Team not found");
    }

    const projectTeam = await this.db.projectTeam.upsert({
      where: { projectId_teamId: { projectId, teamId: input.teamId } },
      update: {},
      create: { projectId, teamId: input.teamId, addedById: actorId },
    });

    await this.audit.log({
      organizationId: project.workspace.organizationId,
      actorId,
      action: "project.team_added",
      entityType: "ProjectTeam",
      entityId: projectTeam.id,
      projectId,
      after: { teamId: input.teamId },
    });
    return projectTeam;
  }

  async removeTeam(actorId: string, projectId: string, teamId: string): Promise<void> {
    const project = await this.getProjectByIdOrThrow(actorId, projectId);
    await this.assertCanManage(actorId, project, PERMISSIONS.WORKSPACE_PROJECT_MANAGE_MEMBERS);

    await this.db.projectTeam.deleteMany({ where: { projectId, teamId } });
    await this.audit.log({
      organizationId: project.workspace.organizationId,
      actorId,
      action: "project.team_removed",
      entityType: "ProjectTeam",
      entityId: `${projectId}:${teamId}`,
      projectId,
      after: { teamId },
    });
  }

  // ── Important dates ──────────────────────────────────────────────────

  async listDates(actorId: string, projectId: string) {
    const project = await this.getProjectByIdOrThrow(actorId, projectId);
    return this.db.projectDate.findMany({
      where: { projectId: project.id },
      include: { createdBy: { select: PERSON_SELECT } },
      orderBy: { date: "asc" },
    });
  }

  async addDate(actorId: string, projectId: string, input: CreateProjectDateInput) {
    const project = await this.getProjectByIdOrThrow(actorId, projectId);
    await this.assertCanManage(actorId, project, PERMISSIONS.WORKSPACE_PROJECT_MANAGE_DATES);

    const date = await this.db.projectDate.create({
      data: { projectId, title: input.title, date: input.date, notes: input.notes, createdById: actorId },
    });
    await this.audit.log({
      organizationId: project.workspace.organizationId,
      actorId,
      action: "project_date.created",
      entityType: "ProjectDate",
      entityId: date.id,
      projectId,
      after: { title: input.title, date: input.date },
    });
    return date;
  }

  private async loadDateAndProject(actorId: string, dateId: string) {
    const date = await this.db.projectDate.findUnique({ where: { id: dateId } });
    if (!date) throw new NotFoundError("Date not found");
    const project = await this.getProjectByIdOrThrow(actorId, date.projectId);
    return { date, project };
  }

  async updateDate(actorId: string, dateId: string, input: UpdateProjectDateInput) {
    const { date, project } = await this.loadDateAndProject(actorId, dateId);
    await this.assertCanManage(actorId, project, PERMISSIONS.WORKSPACE_PROJECT_MANAGE_DATES);

    const updated = await this.db.projectDate.update({
      where: { id: dateId },
      data: { title: input.title, date: input.date, notes: input.notes },
    });
    await this.audit.log({
      organizationId: project.workspace.organizationId,
      actorId,
      action: "project_date.updated",
      entityType: "ProjectDate",
      entityId: dateId,
      projectId: project.id,
      before: { title: date.title, date: date.date },
      after: input,
    });
    return updated;
  }

  async deleteDate(actorId: string, dateId: string): Promise<void> {
    const { project } = await this.loadDateAndProject(actorId, dateId);
    await this.assertCanManage(actorId, project, PERMISSIONS.WORKSPACE_PROJECT_MANAGE_DATES);

    await this.db.projectDate.delete({ where: { id: dateId } });
    await this.audit.log({
      organizationId: project.workspace.organizationId,
      actorId,
      action: "project_date.deleted",
      entityType: "ProjectDate",
      entityId: dateId,
      projectId: project.id,
    });
  }

  // ── Progress (derived, never stored — doc 17 §14) ───────────────────

  async getProgress(actorId: string, projectId: string) {
    const project = await this.getProjectByIdOrThrow(actorId, projectId);
    const tasks = await this.db.task.findMany({ where: { projectId: project.id }, select: { status: true } });

    const completed = tasks.filter((t) => t.status === "COMPLETED").length;
    const cancelled = tasks.filter((t) => t.status === "CANCELLED").length;
    const active = tasks.length - completed - cancelled;
    const total = completed + active; // cancelled tasks excluded from the denominator (doc 17 §14)
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, active, cancelled, percent };
  }
}
