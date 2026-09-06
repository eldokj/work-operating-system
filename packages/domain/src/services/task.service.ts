import type { Prisma, PrismaClient } from "@ai-task-manager/db";
import { PERMISSIONS } from "@ai-task-manager/shared";
import type {
  AddChecklistItemInput,
  AddCommentInput,
  AddProgressUpdateInput,
  CreateTaskInput,
  ReviewDecisionInput,
  TaskListFilter,
  UpdateChecklistItemInput,
  UpdateTaskInput,
} from "@ai-task-manager/shared";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { isOverdue, nextTaskStatus } from "../state-machines/task-status.machine";
import { AssignmentService } from "./assignment.service";
import { AuditService } from "./audit.service";
import { NotificationService, NotificationType } from "./notification.service";
import { PermissionService } from "./permission.service";

const TASK_DETAIL_INCLUDE = {
  workspace: true,
  project: true,
  createdBy: { select: { id: true, fullName: true, email: true } },
  originOrganization: { select: { id: true, name: true } },
  originDepartment: { select: { id: true, name: true } },
  originTeam: { select: { id: true, name: true } },
  originAssignor: { select: { id: true, fullName: true, email: true } },
  checklistItems: { orderBy: { position: "asc" as const } },
  assignments: {
    orderBy: { createdAt: "asc" as const },
    include: {
      assigneeUser: { select: { id: true, fullName: true, email: true } },
      assigneeTeam: { select: { id: true, name: true } },
      assignedBy: { select: { id: true, fullName: true, email: true } },
      respondedBy: { select: { id: true, fullName: true, email: true } },
    },
  },
} satisfies Prisma.TaskInclude;

export type TaskWithDetail = Prisma.TaskGetPayload<{ include: typeof TASK_DETAIL_INCLUDE }>;

export class TaskService {
  private readonly permissions: PermissionService;
  private readonly assignments: AssignmentService;
  private readonly audit: AuditService;
  private readonly notifications: NotificationService;

  constructor(private readonly db: PrismaClient) {
    this.permissions = new PermissionService(db);
    this.assignments = new AssignmentService(db);
    this.audit = new AuditService(db);
    this.notifications = new NotificationService(db);
  }

  // ── Creation ──────────────────────────────────────────────────────────

  async createTask(actorId: string, input: CreateTaskInput): Promise<TaskWithDetail> {
    const workspace = await this.db.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new NotFoundError("Workspace not found");

    if (workspace.type === "PERSONAL") {
      if (workspace.ownerUserId !== actorId) {
        throw new ForbiddenError("You do not own this personal workspace");
      }
      if (input.assignTo) {
        throw new ForbiddenError(
          "Personal workspace tasks are self-assignment only — assigning to another person or team requires an organization (doc 13 #11)"
        );
      }
    } else {
      const organizationId = workspace.organizationId!;
      await this.permissions.assertOrgMember(actorId, organizationId);
      if (!(await this.permissions.hasAnyGrantWithPermission(actorId, organizationId, PERMISSIONS.TASK_CREATE))) {
        throw new ForbiddenError("Missing required permission: task.create");
      }
    }

    const task = await this.db.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId ?? null,
          parentTaskId: input.parentTaskId ?? null,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          status: "UNASSIGNED",
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
          createdById: actorId,
          createdVia: "DIRECT",
        },
      });

      if (input.checklist?.length) {
        await tx.taskChecklistItem.createMany({
          data: input.checklist.map((label, index) => ({
            taskId: created.id,
            label,
            position: index,
            createdById: actorId,
          })),
        });
      }

      const txAudit = new AuditService(tx);
      await txAudit.log({
        organizationId: workspace.organizationId ?? null,
        actorId,
        action: "task.created",
        entityType: "Task",
        entityId: created.id,
        after: { title: created.title, workspaceId: created.workspaceId },
      });

      return created;
    });

    if (workspace.type === "PERSONAL") {
      // Personal tasks are always self-assigned, instantly and without acknowledgement —
      // there is no one else to accept/decline (doc 13 #11). This keeps every task,
      // personal or organizational, running through the identical assignment-chain model
      // (doc 01 §1.6 "one pipeline") rather than special-casing personal tasks elsewhere.
      await this.db.$transaction(async (tx) => {
        await tx.taskAssignment.create({
          data: {
            taskId: task.id,
            assigneeType: "USER",
            assigneeUserId: actorId,
            assignedById: actorId,
            status: "ACCEPTED",
            respondedById: actorId,
            respondedAt: new Date(),
            isCurrent: true,
          },
        });
        const finalStatus = nextTaskStatus(nextTaskStatus(task.status, "ASSIGN"), "ASSIGNMENT_ACCEPTED");
        await tx.task.update({ where: { id: task.id }, data: { status: finalStatus } });
      });
    } else if (input.assignTo) {
      await this.assignments.assign(actorId, task.id, {
        assigneeType: input.assignTo.type,
        assigneeUserId: input.assignTo.type === "USER" ? input.assignTo.id : null,
        assigneeTeamId: input.assignTo.type === "TEAM" ? input.assignTo.id : null,
      });
    }

    return this.getTaskByIdOrThrow(actorId, task.id);
  }

  // ── Reads & visibility ───────────────────────────────────────────────

  /**
   * A task is visible to an org member if they created it, are anywhere in its
   * assignment chain (assignor, responder, or current assignee/current-assignee's-team
   * member), or hold reports.view / audit.view over its current team/department.
   * Personal-workspace tasks are visible only to their owner.
   */
  private async canView(actorId: string, task: TaskWithDetail): Promise<boolean> {
    if (task.workspace.type === "PERSONAL") {
      return task.workspace.ownerUserId === actorId;
    }
    const organizationId = task.workspace.organizationId!;
    if (!(await this.permissions.isOrgMember(actorId, organizationId))) return false;
    if (task.createdById === actorId) return true;

    const current = task.assignments.find((a) => a.isCurrent);
    for (const a of task.assignments) {
      if (a.assignedById === actorId || a.respondedById === actorId) return true;
    }
    if (current) {
      if (current.assigneeType === "USER" && current.assigneeUserId === actorId) return true;
      if (current.assigneeType === "TEAM") {
        const membership = await this.db.teamMember.findUnique({
          where: { teamId_userId: { teamId: current.assigneeTeamId!, userId: actorId } },
        });
        if (membership) return true;
      }
    }
    const teamId = current?.assigneeTeamId ?? task.originTeamId ?? null;
    const departmentId = task.originDepartmentId ?? null;
    if (await this.permissions.can(actorId, organizationId, PERMISSIONS.REPORTS_VIEW, { teamId, departmentId })) {
      return true;
    }
    return false;
  }

  async getTaskByIdOrThrow(actorId: string, taskId: string): Promise<TaskWithDetail> {
    const task = await this.db.task.findUnique({ where: { id: taskId }, include: TASK_DETAIL_INCLUDE });
    if (!task) throw new NotFoundError("Task not found");
    if (!(await this.canView(actorId, task))) throw new ForbiddenError("You cannot view this task");
    return task;
  }

  /**
   * "My Tasks" = ALL tasks for which the actor is the CURRENT accountable individual
   * assignee (an accepted, is_current=true, USER-type assignment) — never derived from
   * who created the task. A team assignment never appears here for anyone until the Team
   * Head distributes it internally and the individual accepts.
   */
  async listTasks(actorId: string, workspaceId: string, filter: TaskListFilter) {
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundError("Workspace not found");

    if (workspace.type === "PERSONAL") {
      if (workspace.ownerUserId !== actorId) throw new ForbiddenError("You do not own this personal workspace");
      return this.db.task.findMany({
        where: { workspaceId, ...(filter.status ? { status: filter.status } : {}) },
        include: TASK_DETAIL_INCLUDE,
        orderBy: { createdAt: "desc" },
      });
    }

    const organizationId = workspace.organizationId!;
    await this.permissions.assertOrgMember(actorId, organizationId);

    const baseWhere: Prisma.TaskWhereInput = {
      workspaceId,
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };

    let where: Prisma.TaskWhereInput;

    switch (filter.view) {
      case "MY_TASKS": {
        where = {
          ...baseWhere,
          assignments: { some: { isCurrent: true, assigneeType: "USER", assigneeUserId: actorId, status: "ACCEPTED" } },
        };
        break;
      }
      case "PENDING_MY_ACKNOWLEDGEMENT": {
        const teams = await this.permissions.getUserOrgTeams(actorId, organizationId);
        const headTeamIds = teams.filter((t) => t.isHead).map((t) => t.teamId);
        where = {
          ...baseWhere,
          assignments: {
            some: {
              isCurrent: true,
              status: "PENDING_ACKNOWLEDGEMENT",
              OR: [
                { assigneeType: "USER", assigneeUserId: actorId },
                ...(headTeamIds.length ? [{ assigneeType: "TEAM" as const, assigneeTeamId: { in: headTeamIds } }] : []),
              ],
            },
          },
        };
        break;
      }
      case "TEAM_INCOMING": {
        if (!filter.teamId) throw new ValidationError("teamId is required for the TEAM_INCOMING view");
        where = {
          ...baseWhere,
          assignments: {
            some: { isCurrent: true, assigneeType: "TEAM", assigneeTeamId: filter.teamId, status: "PENDING_ACKNOWLEDGEMENT" },
          },
        };
        break;
      }
      case "TEAM_TASKS": {
        if (!filter.teamId) throw new ValidationError("teamId is required for the TEAM_TASKS view");
        const memberIds = (
          await this.db.teamMember.findMany({ where: { teamId: filter.teamId }, select: { userId: true } })
        ).map((m) => m.userId);
        where = {
          ...baseWhere,
          OR: [
            { originTeamId: filter.teamId },
            { assignments: { some: { isCurrent: true, assigneeType: "TEAM", assigneeTeamId: filter.teamId } } },
            {
              assignments: {
                some: { isCurrent: true, assigneeType: "USER", assigneeUserId: { in: memberIds } },
              },
            },
          ],
        };
        break;
      }
      case "ALL":
      default: {
        const canSeeEverything = await this.permissions.can(actorId, organizationId, PERMISSIONS.REPORTS_VIEW, {
          teamId: filter.teamId ?? null,
          departmentId: filter.departmentId ?? null,
        });
        if (canSeeEverything) {
          where = {
            ...baseWhere,
            ...(filter.departmentId ? { originDepartmentId: filter.departmentId } : {}),
            ...(filter.teamId ? { originTeamId: filter.teamId } : {}),
          };
        } else {
          const teams = await this.permissions.getUserOrgTeams(actorId, organizationId);
          const headTeamIds = teams.filter((t) => t.isHead).map((t) => t.teamId);
          const memberTeamIds = teams.map((t) => t.teamId);
          where = {
            ...baseWhere,
            OR: [
              { createdById: actorId },
              { assignments: { some: { isCurrent: true, assigneeType: "USER", assigneeUserId: actorId } } },
              ...(headTeamIds.length
                ? [{ assignments: { some: { isCurrent: true, assigneeType: "TEAM" as const, assigneeTeamId: { in: headTeamIds } } } }]
                : []),
              ...(memberTeamIds.length
                ? [{ assignments: { some: { isCurrent: true, assigneeType: "TEAM" as const, assigneeTeamId: { in: memberTeamIds } } } }]
                : []),
            ],
          };
        }
        break;
      }
    }

    const tasks = await this.db.task.findMany({ where, include: TASK_DETAIL_INCLUDE, orderBy: { createdAt: "desc" } });
    if (filter.overdueOnly) {
      return tasks.filter((t) => isOverdue(t.status, t.dueDate));
    }
    return tasks;
  }

  // ── Editing ───────────────────────────────────────────────────────────

  private async assertCanEdit(actorId: string, task: TaskWithDetail): Promise<void> {
    if (task.workspace.type === "PERSONAL") {
      if (task.workspace.ownerUserId !== actorId) throw new ForbiddenError("You do not own this task");
      return;
    }
    const current = task.assignments.find((a) => a.isCurrent);
    const isCurrentAssignee = current?.assigneeType === "USER" && current.assigneeUserId === actorId;
    const isCreator = task.createdById === actorId;
    const isAssignor = current?.assignedById === actorId;
    if (!isCreator && !isCurrentAssignee && !isAssignor) {
      throw new ForbiddenError("You do not have permission to edit this task");
    }
  }

  async updateTask(actorId: string, taskId: string, input: UpdateTaskInput): Promise<TaskWithDetail> {
    const task = await this.getTaskByIdOrThrow(actorId, taskId);
    await this.assertCanEdit(actorId, task);

    const before = { title: task.title, priority: task.priority, dueDate: task.dueDate };
    await this.db.task.update({
      where: { id: taskId },
      data: {
        title: input.title,
        description: input.description,
        priority: input.priority,
        startDate: input.startDate,
        dueDate: input.dueDate,
        estimatedDurationMinutes: input.estimatedDurationMinutes,
      },
    });

    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "task.updated",
      entityType: "Task",
      entityId: taskId,
      before,
      after: input,
    });

    return this.getTaskByIdOrThrow(actorId, taskId);
  }

  async cancelTask(actorId: string, taskId: string, reason?: string): Promise<TaskWithDetail> {
    const task = await this.getTaskByIdOrThrow(actorId, taskId);
    const isCreator = task.createdById === actorId;
    const isOriginAssignor = task.originAssignor?.id === actorId;

    if (task.workspace.type === "ORGANIZATION" && !isCreator && !isOriginAssignor) {
      await this.permissions.assertCan(actorId, task.workspace.organizationId!, PERMISSIONS.TASK_CANCEL, {
        teamId: task.originTeamId,
        departmentId: task.originDepartmentId,
      });
    } else if (task.workspace.type === "PERSONAL" && task.workspace.ownerUserId !== actorId) {
      throw new ForbiddenError("You do not own this task");
    }

    const newStatus = nextTaskStatus(task.status, "CANCEL");
    await this.db.task.update({ where: { id: taskId }, data: { status: newStatus } });
    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "task.cancelled",
      entityType: "Task",
      entityId: taskId,
      before: { status: task.status },
      after: { status: newStatus },
      reason,
    });
    return this.getTaskByIdOrThrow(actorId, taskId);
  }

  // ── Checklist ─────────────────────────────────────────────────────────

  async addChecklistItem(actorId: string, taskId: string, input: AddChecklistItemInput) {
    const task = await this.getTaskByIdOrThrow(actorId, taskId);
    await this.assertCanEdit(actorId, task);
    const position = task.checklistItems.length;
    const item = await this.db.taskChecklistItem.create({
      data: { taskId, label: input.label, position, createdById: actorId },
    });
    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "task.checklist_item_added",
      entityType: "TaskChecklistItem",
      entityId: item.id,
      after: { label: input.label },
    });
    return item;
  }

  async updateChecklistItem(actorId: string, taskId: string, itemId: string, input: UpdateChecklistItemInput) {
    const task = await this.getTaskByIdOrThrow(actorId, taskId);
    await this.assertCanEdit(actorId, task);
    const item = await this.db.taskChecklistItem.findUnique({ where: { id: itemId } });
    if (!item || item.taskId !== taskId) throw new NotFoundError("Checklist item not found");

    const updated = await this.db.taskChecklistItem.update({
      where: { id: itemId },
      data: { label: input.label, isDone: input.isDone, position: input.position },
    });
    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "task.checklist_item_updated",
      entityType: "TaskChecklistItem",
      entityId: itemId,
      before: { isDone: item.isDone },
      after: { isDone: updated.isDone },
    });
    return updated;
  }

  async deleteChecklistItem(actorId: string, taskId: string, itemId: string) {
    const task = await this.getTaskByIdOrThrow(actorId, taskId);
    await this.assertCanEdit(actorId, task);
    await this.db.taskChecklistItem.delete({ where: { id: itemId } });
    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "task.checklist_item_deleted",
      entityType: "TaskChecklistItem",
      entityId: itemId,
    });
  }

  // ── Comments ──────────────────────────────────────────────────────────

  async addComment(actorId: string, taskId: string, input: AddCommentInput) {
    const task = await this.getTaskByIdOrThrow(actorId, taskId);
    if (task.workspace.type === "ORGANIZATION") {
      await this.permissions.assertHasAnyGrantWithPermission(actorId, task.workspace.organizationId!, PERMISSIONS.TASK_COMMENT);
    }
    const comment = await this.db.taskComment.create({ data: { taskId, userId: actorId, body: input.body } });

    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "task.comment_added",
      entityType: "TaskComment",
      entityId: comment.id,
    });

    // Notify everyone else currently touching the task (creator + current assignee).
    const notifyUserIds = new Set<string>([task.createdById]);
    const current = task.assignments.find((a) => a.isCurrent);
    if (current?.assigneeType === "USER" && current.assigneeUserId) notifyUserIds.add(current.assigneeUserId);
    notifyUserIds.delete(actorId);
    await this.notifications.notifyMany(
      [...notifyUserIds],
      NotificationType.COMMENT_ADDED,
      { taskId, taskTitle: task.title, commentBy: actorId },
      taskId
    );

    return comment;
  }

  async listComments(actorId: string, taskId: string) {
    await this.getTaskByIdOrThrow(actorId, taskId); // enforces visibility
    return this.db.taskComment.findMany({
      where: { taskId },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  // ── Progress updates ─────────────────────────────────────────────────

  async addProgressUpdate(actorId: string, taskId: string, input: AddProgressUpdateInput) {
    const task = await this.getTaskByIdOrThrow(actorId, taskId);
    const current = task.assignments.find((a) => a.isCurrent);
    const isCurrentAssignee = current?.assigneeType === "USER" && current.assigneeUserId === actorId;
    if (!isCurrentAssignee) {
      throw new ForbiddenError("Only the current assignee can post a progress update");
    }
    if (task.workspace.type === "ORGANIZATION") {
      await this.permissions.assertHasAnyGrantWithPermission(actorId, task.workspace.organizationId!, PERMISSIONS.TASK_UPDATE_PROGRESS);
    }

    const update = await this.db.taskUpdate.create({
      data: {
        taskId,
        assignmentId: current?.id,
        userId: actorId,
        percentage: input.percentage,
        note: input.note,
        statusSnapshot: task.status,
      },
    });

    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "task.progress_update_added",
      entityType: "TaskUpdate",
      entityId: update.id,
      after: { percentage: input.percentage },
    });

    return update;
  }

  async listUpdates(actorId: string, taskId: string) {
    await this.getTaskByIdOrThrow(actorId, taskId);
    return this.db.taskUpdate.findMany({
      where: { taskId },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  // ── Submit / review / complete ───────────────────────────────────────

  async submitTask(actorId: string, taskId: string): Promise<TaskWithDetail> {
    const task = await this.getTaskByIdOrThrow(actorId, taskId);
    const current = task.assignments.find((a) => a.isCurrent);
    const isCurrentAssignee = current?.assigneeType === "USER" && current.assigneeUserId === actorId;
    if (!isCurrentAssignee) throw new ForbiddenError("Only the current assignee can submit this task");
    if (task.workspace.type === "ORGANIZATION") {
      await this.permissions.assertHasAnyGrantWithPermission(actorId, task.workspace.organizationId!, PERMISSIONS.TASK_UPDATE_PROGRESS);
    }

    const newStatus = nextTaskStatus(task.status, "SUBMIT");
    await this.db.task.update({ where: { id: taskId }, data: { status: newStatus } });

    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "task.submitted",
      entityType: "Task",
      entityId: taskId,
      before: { status: task.status },
      after: { status: newStatus },
    });

    if (current) {
      await this.notifications.notify(
        current.assignedById,
        NotificationType.REVIEW_REQUESTED,
        { taskId, taskTitle: task.title, submittedBy: actorId },
        taskId
      );
    }

    return this.getTaskByIdOrThrow(actorId, taskId);
  }

  /** Default reviewer resolution: whoever assigned the task to its current executor. */
  private isDesignatedReviewer(task: TaskWithDetail, actorId: string): boolean {
    const current = task.assignments.find((a) => a.isCurrent);
    return current?.assignedById === actorId;
  }

  async reviewTask(actorId: string, taskId: string, input: ReviewDecisionInput): Promise<TaskWithDetail> {
    const task = await this.getTaskByIdOrThrow(actorId, taskId);
    const current = task.assignments.find((a) => a.isCurrent);
    if (!current) throw new ConflictError("Task has no current assignment to review");

    const isDesignated = this.isDesignatedReviewer(task, actorId);
    if (task.workspace.type === "ORGANIZATION") {
      const organizationId = task.workspace.organizationId!;
      const hasReviewPermission = await this.permissions.can(actorId, organizationId, PERMISSIONS.TASK_REVIEW, {
        teamId: task.originTeamId,
        departmentId: task.originDepartmentId,
      });
      if (!isDesignated && !hasReviewPermission) {
        throw new ForbiddenError("You are not authorized to review this task");
      }
      if (!hasReviewPermission) {
        throw new ForbiddenError("Missing required permission: task.review");
      }
    } else if (!isDesignated) {
      throw new ForbiddenError("You are not authorized to review this task");
    }

    const event = input.decision === "APPROVED" ? "REVIEW_APPROVED" : "REVIEW_CHANGES_REQUESTED";
    const newStatus = nextTaskStatus(task.status, event);

    await this.db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: taskId }, data: { status: newStatus } });
      await tx.taskReview.create({
        data: { taskId, assignmentId: current.id, reviewerId: actorId, decision: input.decision, notes: input.notes },
      });
    });

    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: input.decision === "APPROVED" ? "task.approved" : "task.changes_requested",
      entityType: "Task",
      entityId: taskId,
      before: { status: task.status },
      after: { status: newStatus },
      reason: input.notes ?? undefined,
    });

    if (current.assigneeType === "USER" && current.assigneeUserId) {
      await this.notifications.notify(
        current.assigneeUserId,
        input.decision === "APPROVED" ? NotificationType.TASK_COMPLETED : NotificationType.CHANGES_REQUESTED,
        { taskId, taskTitle: task.title, reviewedBy: actorId, notes: input.notes },
        taskId
      );
    }

    return this.getTaskByIdOrThrow(actorId, taskId);
  }
}
