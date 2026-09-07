import { PERMISSIONS } from "@ai-task-manager/shared";
import type { PermissionService } from "../services/permission.service";
import type { TaskWithDetail } from "../services/task.service";

/**
 * Conversation access — extracted from ConversationService (Phase 2A) so it can be reused
 * by TaskAttachmentService (Phase 2B) without a circular dependency between the two
 * service classes (Conversation needs Attachment for message-linking; Attachment needs
 * this predicate for retrieval auth). This is the ONLY place the rule is implemented —
 * both services call this exact function, never re-derive it.
 *
 * Deliberately NOT the same as TaskService.canViewTask. Every other rule is identical
 * (creator, anyone ever in the assignment chain, the current individual assignee,
 * reports.view holders), reusing exactly those existing checks. The one narrowing: while
 * the CURRENT assignment targets a TEAM as a whole, canViewTask grants every team member
 * task visibility (correct, unchanged Phase 1 behavior — the team needs to see what it's
 * being asked to do before the Head decides), but the conversation (and anything shared
 * through it, including attachments — doc 16) must not be exposed to the whole team just
 * because one member happens to belong to it (doc 15's Marketing/Rahul example). Only
 * whoever can act on the team's behalf (PermissionService.canActOnBehalfOfTeam —
 * unchanged, existing) gets access at that point; plain members gain it once the task is
 * actually distributed to them individually, exactly like everyone else.
 */
export async function canAccessConversation(
  permissions: PermissionService,
  userId: string,
  task: TaskWithDetail
): Promise<boolean> {
  if (task.workspace.type === "PERSONAL") {
    return task.workspace.ownerUserId === userId;
  }
  const organizationId = task.workspace.organizationId!;
  if (!(await permissions.isOrgMember(userId, organizationId))) return false;
  if (task.createdById === userId) return true;

  for (const a of task.assignments) {
    if (a.assignedById === userId || a.respondedById === userId) return true;
  }

  const current = task.assignments.find((a) => a.isCurrent);
  if (current) {
    if (current.assigneeType === "USER" && current.assigneeUserId === userId) return true;
    if (current.assigneeType === "TEAM") {
      if (await permissions.canActOnBehalfOfTeam(userId, organizationId, current.assigneeTeamId!)) {
        return true;
      }
    }
  }

  const teamId = current?.assigneeTeamId ?? task.originTeamId ?? null;
  const departmentId = task.originDepartmentId ?? null;
  return permissions.can(userId, organizationId, PERMISSIONS.REPORTS_VIEW, { teamId, departmentId });
}
