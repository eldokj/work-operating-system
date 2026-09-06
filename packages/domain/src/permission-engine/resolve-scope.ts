// Pure scope-resolution logic — docs/architecture/04-rbac-permissions.md §4.4.
// Deliberately has zero DB dependency so it is unit-testable with plain fixtures
// (docs/architecture/11-testing-strategy.md §11.1).

import type { PermissionKey } from "@ai-task-manager/shared";

export type ScopeType = "ORGANIZATION" | "DEPARTMENT" | "TEAM";

export interface RoleGrant {
  scopeType: ScopeType;
  scopeId: string | null; // null iff scopeType === ORGANIZATION
  permissions: PermissionKey[];
}

export interface ResourceContext {
  /**
   * The resource's department, expressed as its full ancestor path INCLUDING itself,
   * ordered leaf-first: [departmentId, parentId, grandparentId, ...]. A department-scoped
   * grant applies if its scopeId appears anywhere in this path (doc 04: "D is descendant
   * of scope_id (nested depts) -> applies").
   */
  departmentPathIds?: string[];
  /** The resource's team id, if any. Teams are not hierarchical — exact match only. */
  teamId?: string | null;
}

/**
 * Resolves the union of permissions a set of role grants confers over one resource
 * context. This is step 3-4 of the doc 04 §4.4 algorithm; step 1-2 (collecting a user's
 * role grants and expanding them to permissions via role_permissions) happens in the
 * PermissionService, which fetches from the database and calls this pure function.
 */
export function resolveEffectivePermissions(
  grants: RoleGrant[],
  context: ResourceContext
): Set<PermissionKey> {
  const result = new Set<PermissionKey>();

  for (const grant of grants) {
    let applies = false;

    if (grant.scopeType === "ORGANIZATION") {
      applies = true;
    } else if (grant.scopeType === "DEPARTMENT") {
      applies = !!context.departmentPathIds?.includes(grant.scopeId ?? "");
    } else if (grant.scopeType === "TEAM") {
      applies = !!context.teamId && context.teamId === grant.scopeId;
    }

    if (applies) {
      for (const p of grant.permissions) result.add(p);
    }
  }

  return result;
}

export function hasPermission(
  grants: RoleGrant[],
  context: ResourceContext,
  permission: PermissionKey
): boolean {
  return resolveEffectivePermissions(grants, context).has(permission);
}
