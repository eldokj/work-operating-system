import type { Prisma, PrismaClient } from "@ai-task-manager/db";
import { PERMISSIONS, INDIVIDUAL_USER_PERMISSIONS, type PermissionKey } from "@ai-task-manager/shared";
import { resolveEffectivePermissions, type RoleGrant, type ResourceContext } from "../permission-engine/resolve-scope";
import { ForbiddenError } from "../errors";

export interface TeamMembershipInfo {
  teamId: string;
  departmentId: string | null;
  isHead: boolean;
}

const MAX_DEPARTMENT_DEPTH = 25; // guards against a bad/cyclic parent chain

/**
 * The single implementation of docs/architecture/04-rbac-permissions.md. Every API route
 * and every other service calls THIS for authorization — never a hardcoded role check
 * (brief §"AUTHORIZATION" / doc 04 §4.1).
 */
export class PermissionService {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}

  /** doc 02 §2.3 layer 1 — tenant-membership check, independent of permission grants. */
  async isOrgMember(userId: string, organizationId: string): Promise<boolean> {
    const row = await this.db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    return !!row && row.status === "ACTIVE";
  }

  async assertOrgMember(userId: string, organizationId: string): Promise<void> {
    if (!(await this.isOrgMember(userId, organizationId))) {
      throw new ForbiddenError("You are not a member of this organization");
    }
  }

  /** Leaf-first ancestor path of a department, e.g. [self, parent, grandparent, ...]. */
  async getDepartmentPath(departmentId: string | null | undefined): Promise<string[]> {
    if (!departmentId) return [];
    const path: string[] = [];
    let currentId: string | null = departmentId;
    let depth = 0;
    while (currentId && depth < MAX_DEPARTMENT_DEPTH) {
      path.push(currentId);
      const dept: { parentDepartmentId: string | null } | null = await this.db.department.findUnique({
        where: { id: currentId },
        select: { parentDepartmentId: true },
      });
      currentId = dept?.parentDepartmentId ?? null;
      depth++;
    }
    return path;
  }

  /** doc 04 §4.4 steps 1-2: collect a user's role grants (expanded to permissions) in an org. */
  async getRoleGrants(userId: string, organizationId: string): Promise<RoleGrant[]> {
    const userRoles = await this.db.userRole.findMany({
      where: { userId, organizationId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });

    return userRoles.map((ur) => ({
      scopeType: ur.scopeType,
      scopeId: ur.scopeId,
      permissions: ur.role.rolePermissions.map((rp) => rp.permission.key as PermissionKey),
    }));
  }

  async getUserOrgTeams(userId: string, organizationId: string): Promise<TeamMembershipInfo[]> {
    const memberships = await this.db.teamMember.findMany({
      where: { userId, team: { organizationId } },
      include: { team: { select: { id: true, departmentId: true } } },
    });
    return memberships.map((m) => ({
      teamId: m.team.id,
      departmentId: m.team.departmentId,
      isHead: m.isHead,
    }));
  }

  /**
   * Core authorization check for an organization-scoped resource. `context` identifies
   * the resource's own department/team so scope resolution (doc 04 §4.4) can apply.
   */
  async can(
    userId: string,
    organizationId: string,
    permission: PermissionKey,
    context: { departmentId?: string | null; teamId?: string | null } = {}
  ): Promise<boolean> {
    const [grants, departmentPathIds] = await Promise.all([
      this.getRoleGrants(userId, organizationId),
      this.getDepartmentPath(context.departmentId),
    ]);
    const resourceContext: ResourceContext = { departmentPathIds, teamId: context.teamId ?? null };
    return resolveEffectivePermissions(grants, resourceContext).has(permission);
  }

  /**
   * For actions that don't yet have a resource to scope against (e.g. task.create — the
   * task doesn't exist until this check passes): true if ANY of the user's role grants,
   * in any scope, include this permission. Used deliberately narrowly (see call sites) —
   * most checks should use `can()` with a real resource context instead.
   */
  async hasAnyGrantWithPermission(userId: string, organizationId: string, permission: PermissionKey): Promise<boolean> {
    const grants = await this.getRoleGrants(userId, organizationId);
    return grants.some((g) => g.permissions.includes(permission));
  }

  async assertHasAnyGrantWithPermission(userId: string, organizationId: string, permission: PermissionKey): Promise<void> {
    if (!(await this.hasAnyGrantWithPermission(userId, organizationId, permission))) {
      throw new ForbiddenError(`Missing required permission: ${permission}`);
    }
  }

  async assertCan(
    userId: string,
    organizationId: string,
    permission: PermissionKey,
    context: { departmentId?: string | null; teamId?: string | null } = {}
  ): Promise<void> {
    if (!(await this.can(userId, organizationId, permission, context))) {
      throw new ForbiddenError(`Missing required permission: ${permission}`);
    }
  }

  /** Fixed capability set inside a user's own personal workspace (doc 04 §4.3, last row). */
  hasPersonalWorkspacePermission(permission: PermissionKey): boolean {
    return INDIVIDUAL_USER_PERMISSIONS.includes(permission);
  }

  /**
   * Whether `userId` holds `task.accept_on_behalf_of_team` (or an equivalent grant) for a
   * given team. Phase 1 resolves this as: is a designated Team Head OR holds the
   * permission via a role grant scoped to that team/department/org.
   */
  async canActOnBehalfOfTeam(userId: string, organizationId: string, teamId: string): Promise<boolean> {
    const team = await this.db.team.findUnique({ where: { id: teamId }, select: { departmentId: true } });
    const isHead = await this.db.teamMember.findFirst({ where: { teamId, userId, isHead: true } });
    if (isHead) return true;
    return this.can(userId, organizationId, PERMISSIONS.TASK_ACCEPT_ON_BEHALF_OF_TEAM, {
      teamId,
      departmentId: team?.departmentId ?? null,
    });
  }

  /** All users authorized to acknowledge on behalf of a team — Team Heads today. */
  async getTeamAcknowledgers(teamId: string): Promise<string[]> {
    const heads = await this.db.teamMember.findMany({ where: { teamId, isHead: true }, select: { userId: true } });
    return heads.map((h) => h.userId);
  }
}
