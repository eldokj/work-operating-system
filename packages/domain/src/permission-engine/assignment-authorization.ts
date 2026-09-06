// Pure assignment-authorization logic — docs/architecture/04-rbac-permissions.md §4.5.
// The relationship classification (given actor's own team/department vs. the target's)
// is computed here; the DB lookups needed to classify it live in AssignmentService.

import { PERMISSIONS, type PermissionKey } from "@ai-task-manager/shared";

export type AssignmentRelationship =
  | "SAME_TEAM"
  | "CROSS_TEAM_SAME_DEPARTMENT"
  | "CROSS_DEPARTMENT"
  | "ORG_WIDE";

export interface ClassifyAssignmentInput {
  /** Team id(s) the actor belongs to, if any. */
  actorTeamIds: string[];
  /** Department id(s) the actor belongs to (via team membership), if any. */
  actorDepartmentIds: string[];
  /** The team being targeted, if assigning to a team. */
  targetTeamId?: string | null;
  /** The department the target team belongs to (or the target user's team's department). */
  targetDepartmentId?: string | null;
  /**
   * True when the actor is acting at the organization/management level with no team of
   * their own in this org (e.g. an ORG_ADMIN dispatching to any team) — doc 04 §4.5
   * "actor is acting at the organization/management level (no team of origin)".
   */
  actorHasNoOriginTeam: boolean;
}

export function classifyAssignmentRelationship(input: ClassifyAssignmentInput): AssignmentRelationship {
  if (input.actorHasNoOriginTeam) return "ORG_WIDE";

  if (input.targetTeamId && input.actorTeamIds.includes(input.targetTeamId)) {
    return "SAME_TEAM";
  }

  if (
    input.targetDepartmentId &&
    input.actorDepartmentIds.includes(input.targetDepartmentId)
  ) {
    return "CROSS_TEAM_SAME_DEPARTMENT";
  }

  return "CROSS_DEPARTMENT";
}

export function permissionRequiredForAssignment(relationship: AssignmentRelationship): PermissionKey {
  switch (relationship) {
    case "SAME_TEAM":
      return PERMISSIONS.TASK_ASSIGN;
    case "CROSS_TEAM_SAME_DEPARTMENT":
      return PERMISSIONS.TASK_ASSIGN_CROSS_TEAM;
    case "CROSS_DEPARTMENT":
      return PERMISSIONS.TASK_ASSIGN_CROSS_DEPARTMENT;
    case "ORG_WIDE":
      return PERMISSIONS.TASK_ASSIGN_ORG_WIDE;
  }
}
