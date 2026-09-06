import { describe, expect, it } from "vitest";
import { hasPermission, resolveEffectivePermissions, type RoleGrant } from "./resolve-scope";
import { PERMISSIONS } from "@ai-task-manager/shared";

describe("resolveEffectivePermissions", () => {
  it("an ORGANIZATION-scoped grant applies to every resource in the org", () => {
    const grants: RoleGrant[] = [
      { scopeType: "ORGANIZATION", scopeId: null, permissions: [PERMISSIONS.TASK_ASSIGN_ORG_WIDE] },
    ];
    expect(hasPermission(grants, { teamId: "team-1" }, PERMISSIONS.TASK_ASSIGN_ORG_WIDE)).toBe(true);
    expect(hasPermission(grants, {}, PERMISSIONS.TASK_ASSIGN_ORG_WIDE)).toBe(true);
  });

  it("a DEPARTMENT-scoped grant applies to nested (descendant) departments", () => {
    const grants: RoleGrant[] = [
      { scopeType: "DEPARTMENT", scopeId: "dept-root", permissions: [PERMISSIONS.TASK_ASSIGN_CROSS_TEAM] },
    ];
    // resource's department path is itself + ancestors, leaf-first
    const nestedContext = { departmentPathIds: ["dept-child", "dept-root"] };
    expect(hasPermission(grants, nestedContext, PERMISSIONS.TASK_ASSIGN_CROSS_TEAM)).toBe(true);
  });

  it("a DEPARTMENT-scoped grant does NOT apply to an unrelated department", () => {
    const grants: RoleGrant[] = [
      { scopeType: "DEPARTMENT", scopeId: "dept-finance", permissions: [PERMISSIONS.TASK_ASSIGN] },
    ];
    const marketingContext = { departmentPathIds: ["dept-marketing"] };
    expect(hasPermission(grants, marketingContext, PERMISSIONS.TASK_ASSIGN)).toBe(false);
  });

  it("a TEAM-scoped grant does not leak to a sibling team", () => {
    const grants: RoleGrant[] = [
      { scopeType: "TEAM", scopeId: "team-marketing", permissions: [PERMISSIONS.TASK_ACCEPT_ON_BEHALF_OF_TEAM] },
    ];
    expect(hasPermission(grants, { teamId: "team-marketing" }, PERMISSIONS.TASK_ACCEPT_ON_BEHALF_OF_TEAM)).toBe(true);
    expect(hasPermission(grants, { teamId: "team-finance" }, PERMISSIONS.TASK_ACCEPT_ON_BEHALF_OF_TEAM)).toBe(false);
  });

  it("unions permissions across multiple simultaneous role grants (contextual identity, doc 04 §4.6)", () => {
    // Eldo: TEAM_HEAD on Marketing, MEMBER on Admissions
    const grants: RoleGrant[] = [
      { scopeType: "TEAM", scopeId: "team-marketing", permissions: [PERMISSIONS.TASK_ACCEPT_ON_BEHALF_OF_TEAM] },
      { scopeType: "TEAM", scopeId: "team-admissions", permissions: [PERMISSIONS.TASK_COMMENT] },
    ];
    const marketingPerms = resolveEffectivePermissions(grants, { teamId: "team-marketing" });
    expect(marketingPerms.has(PERMISSIONS.TASK_ACCEPT_ON_BEHALF_OF_TEAM)).toBe(true);
    expect(marketingPerms.has(PERMISSIONS.TASK_COMMENT)).toBe(false);

    const admissionsPerms = resolveEffectivePermissions(grants, { teamId: "team-admissions" });
    expect(admissionsPerms.has(PERMISSIONS.TASK_COMMENT)).toBe(true);
    expect(admissionsPerms.has(PERMISSIONS.TASK_ACCEPT_ON_BEHALF_OF_TEAM)).toBe(false);
  });

  it("a revoked grant (absent from the list) stops applying immediately", () => {
    expect(hasPermission([], { teamId: "team-marketing" }, PERMISSIONS.TASK_ASSIGN)).toBe(false);
  });
});
