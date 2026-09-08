import type { PrismaClient, WorkspaceType } from "@ai-task-manager/db";
import { PERMISSIONS } from "@ai-task-manager/shared";
import type { PermissionService } from "../services/permission.service";

export interface ProjectWithWorkspace {
  id: string;
  ownerId: string;
  departmentId: string | null;
  teamId: string | null;
  workspace: {
    type: WorkspaceType;
    organizationId: string | null;
    ownerUserId: string | null;
  };
}

/**
 * Project-level access — docs/architecture/17-phase2c-project-workspace-architecture-report.md
 * §8/§9. Extracted as a standalone function (same precedent as conversation-access.ts in
 * Phase 2A) so ConversationService/TaskAttachmentService can reuse it without depending on
 * the full ProjectService class.
 *
 * Granted to: the project owner, anyone in ProjectMember, anyone currently in a Team
 * that's in ProjectTeam (live lookup, never a snapshot — same freshness guarantee every
 * other team-scoped grant in this codebase already has), or anyone holding reports.view.
 *
 * This is deliberately COARSER than task-team-assignment's narrowing (doc 15/16): adding a
 * team to a project is a declarative membership decision made once by someone holding
 * workspace_project.manage_members, not a pending-acknowledgement step, so there is no
 * "hasn't accepted yet" ambiguity to protect against the way there is for a task assigned
 * to a team. Project access is necessary but never sufficient for task-level access —
 * TaskService.canViewTask / canAccessConversation remain completely unchanged and are
 * still separately required to open any specific task's own conversation/files (doc 17 §10).
 */
export async function canAccessProject(
  db: PrismaClient,
  permissions: PermissionService,
  userId: string,
  project: ProjectWithWorkspace
): Promise<boolean> {
  if (project.workspace.type === "PERSONAL") {
    return project.workspace.ownerUserId === userId;
  }

  const organizationId = project.workspace.organizationId!;
  if (!(await permissions.isOrgMember(userId, organizationId))) return false;
  if (project.ownerId === userId) return true;

  const directMember = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId } },
  });
  if (directMember) return true;

  const userTeams = await permissions.getUserOrgTeams(userId, organizationId);
  if (userTeams.length > 0) {
    const teamParticipant = await db.projectTeam.findFirst({
      where: { projectId: project.id, teamId: { in: userTeams.map((t) => t.teamId) } },
    });
    if (teamParticipant) return true;
  }

  return permissions.can(userId, organizationId, PERMISSIONS.REPORTS_VIEW, {
    teamId: project.teamId,
    departmentId: project.departmentId,
  });
}
