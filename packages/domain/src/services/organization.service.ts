import type { Prisma, PrismaClient, ScopeType } from "@ai-task-manager/db";
import { SYSTEM_ROLE_TEMPLATES, type PermissionKey } from "@ai-task-manager/shared";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { AuditService } from "./audit.service";
import { PermissionService } from "./permission.service";
import { PERMISSIONS } from "@ai-task-manager/shared";

export class OrganizationService {
  private readonly permissions: PermissionService;
  private readonly audit: AuditService;

  constructor(private readonly db: PrismaClient) {
    this.permissions = new PermissionService(db);
    this.audit = new AuditService(db);
  }

  /**
   * Creates an organization, its org workspace, the creator's membership, and grants the
   * creator ORG_ADMIN scoped to the whole organization — doc 04 §4.3.
   */
  async createOrganization(actorId: string, input: { name: string; slug: string }) {
    const existingSlug = await this.db.organization.findUnique({ where: { slug: input.slug } });
    if (existingSlug) throw new ConflictError(`Organization slug "${input.slug}" is already taken`);

    const orgAdminRole = await this.db.role.findFirst({ where: { name: "ORG_ADMIN", isSystem: true } });
    if (!orgAdminRole) {
      throw new Error("System role ORG_ADMIN is not seeded — run the database seed script");
    }

    const org = await this.db.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name: input.name, slug: input.slug, createdById: actorId },
      });
      await tx.workspace.create({
        data: { type: "ORGANIZATION", organizationId: created.id, name: input.name },
      });
      await tx.organizationMember.create({
        data: { organizationId: created.id, userId: actorId, status: "ACTIVE" },
      });
      await tx.userRole.create({
        data: {
          userId: actorId,
          roleId: orgAdminRole.id,
          organizationId: created.id,
          scopeType: "ORGANIZATION",
          scopeId: null,
          grantedById: actorId,
        },
      });
      return created;
    });

    await this.audit.log({
      organizationId: org.id,
      actorId,
      action: "organization.created",
      entityType: "Organization",
      entityId: org.id,
      after: { name: org.name, slug: org.slug },
    });

    return org;
  }

  async getOrgWorkspaceId(organizationId: string): Promise<string> {
    const ws = await this.db.workspace.findFirst({ where: { type: "ORGANIZATION", organizationId } });
    if (!ws) throw new NotFoundError(`No workspace found for organization ${organizationId}`);
    return ws.id;
  }

  async addMember(actorId: string, organizationId: string, userId: string) {
    await this.permissions.assertOrgMember(actorId, organizationId);
    await this.permissions.assertCan(actorId, organizationId, PERMISSIONS.ORGANIZATION_MANAGE);

    const member = await this.db.organizationMember.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      update: { status: "ACTIVE" },
      create: { organizationId, userId, status: "ACTIVE" },
    });

    // New members start with no role grants (MEMBER-equivalent by default is intentionally
    // NOT auto-granted here — an explicit grantRole call assigns their starting role, so
    // an admin always makes a deliberate choice rather than everyone silently becoming a
    // MEMBER with task-creation rights they were never explicitly given).
    await this.audit.log({
      organizationId,
      actorId,
      action: "organization.member_added",
      entityType: "OrganizationMember",
      entityId: member.id,
      after: { userId },
    });
    return member;
  }

  async createDepartment(actorId: string, organizationId: string, input: { name: string; parentDepartmentId?: string | null }) {
    await this.permissions.assertOrgMember(actorId, organizationId);
    const parentDeptPath = input.parentDepartmentId
      ? await this.permissions.getDepartmentPath(input.parentDepartmentId)
      : [];
    await this.permissions.assertCan(actorId, organizationId, PERMISSIONS.DEPARTMENT_CREATE, {
      departmentId: parentDeptPath[0] ?? null,
    });

    const dept = await this.db.department.create({
      data: {
        organizationId,
        name: input.name,
        parentDepartmentId: input.parentDepartmentId ?? null,
        createdById: actorId,
      },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: "department.created",
      entityType: "Department",
      entityId: dept.id,
      after: { name: dept.name },
    });
    return dept;
  }

  async createTeam(actorId: string, organizationId: string, input: { name: string; departmentId?: string | null }) {
    await this.permissions.assertOrgMember(actorId, organizationId);
    await this.permissions.assertCan(actorId, organizationId, PERMISSIONS.TEAM_CREATE, {
      departmentId: input.departmentId ?? null,
    });

    const team = await this.db.team.create({
      data: {
        organizationId,
        name: input.name,
        departmentId: input.departmentId ?? null,
        createdById: actorId,
      },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: "team.created",
      entityType: "Team",
      entityId: team.id,
      after: { name: team.name, departmentId: team.departmentId },
    });
    return team;
  }

  async addTeamMember(actorId: string, organizationId: string, teamId: string, input: { userId: string; isHead?: boolean }) {
    await this.permissions.assertOrgMember(actorId, organizationId);
    const team = await this.db.team.findUnique({ where: { id: teamId } });
    if (!team || team.organizationId !== organizationId) throw new NotFoundError("Team not found");

    await this.permissions.assertCan(actorId, organizationId, PERMISSIONS.TEAM_MANAGE_MEMBERS, {
      teamId,
      departmentId: team.departmentId,
    });
    if (input.isHead) {
      await this.permissions.assertCan(actorId, organizationId, PERMISSIONS.TEAM_ASSIGN_HEAD, {
        teamId,
        departmentId: team.departmentId,
      });
    }

    const member = await this.db.teamMember.upsert({
      where: { teamId_userId: { teamId, userId: input.userId } },
      update: { isHead: input.isHead ?? false },
      create: { teamId, userId: input.userId, isHead: input.isHead ?? false },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: "team.member_added",
      entityType: "TeamMember",
      entityId: member.id,
      after: { teamId, userId: input.userId, isHead: member.isHead },
    });
    return member;
  }

  async setTeamHead(actorId: string, organizationId: string, teamId: string, userId: string, isHead: boolean) {
    await this.permissions.assertOrgMember(actorId, organizationId);
    const team = await this.db.team.findUnique({ where: { id: teamId } });
    if (!team || team.organizationId !== organizationId) throw new NotFoundError("Team not found");

    await this.permissions.assertCan(actorId, organizationId, PERMISSIONS.TEAM_ASSIGN_HEAD, {
      teamId,
      departmentId: team.departmentId,
    });

    const existing = await this.db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
    if (!existing) throw new NotFoundError("User is not a member of this team");

    const before = { isHead: existing.isHead };
    const updated = await this.db.teamMember.update({
      where: { teamId_userId: { teamId, userId } },
      data: { isHead },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: "team.head_changed",
      entityType: "TeamMember",
      entityId: updated.id,
      before,
      after: { isHead },
    });
    return updated;
  }

  async listRoles(organizationId: string) {
    return this.db.role.findMany({
      where: { OR: [{ organizationId }, { isSystem: true, organizationId: null }] },
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
  }

  async createCustomRole(actorId: string, organizationId: string, input: { name: string; permissionKeys: PermissionKey[] }) {
    await this.permissions.assertOrgMember(actorId, organizationId);
    await this.permissions.assertCan(actorId, organizationId, PERMISSIONS.ROLE_MANAGE);

    const permissions = await this.db.permission.findMany({ where: { key: { in: input.permissionKeys } } });
    if (permissions.length !== input.permissionKeys.length) {
      throw new ValidationError("One or more permission keys are unknown");
    }

    const role = await this.db.role.create({
      data: {
        organizationId,
        name: input.name,
        isSystem: false,
        rolePermissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
      include: { rolePermissions: { include: { permission: true } } },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: "role.created",
      entityType: "Role",
      entityId: role.id,
      after: { name: role.name, permissions: input.permissionKeys },
    });
    return role;
  }

  async grantRole(
    actorId: string,
    organizationId: string,
    input: { userId: string; roleId: string; scopeType: ScopeType; scopeId?: string | null }
  ) {
    await this.permissions.assertOrgMember(actorId, organizationId);
    await this.permissions.assertCan(actorId, organizationId, PERMISSIONS.ROLE_MANAGE, {
      departmentId: input.scopeType === "DEPARTMENT" ? input.scopeId : null,
      teamId: input.scopeType === "TEAM" ? input.scopeId : null,
    });

    const role = await this.db.role.findUnique({ where: { id: input.roleId } });
    if (!role || (role.organizationId && role.organizationId !== organizationId)) {
      throw new NotFoundError("Role not found");
    }
    if (input.scopeType !== "ORGANIZATION" && !input.scopeId) {
      throw new ValidationError("scopeId is required for DEPARTMENT or TEAM scope");
    }

    const grant = await this.db.userRole.create({
      data: {
        userId: input.userId,
        roleId: input.roleId,
        organizationId,
        scopeType: input.scopeType,
        scopeId: input.scopeType === "ORGANIZATION" ? null : input.scopeId,
        grantedById: actorId,
      },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: "role.granted",
      entityType: "UserRole",
      entityId: grant.id,
      after: { userId: input.userId, roleId: input.roleId, scopeType: input.scopeType, scopeId: input.scopeId },
    });
    return grant;
  }

  async listDepartments(organizationId: string) {
    return this.db.department.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  }

  async listTeams(organizationId: string, departmentId?: string) {
    return this.db.team.findMany({
      where: { organizationId, ...(departmentId ? { departmentId } : {}) },
      include: { members: { include: { user: { select: { id: true, fullName: true, email: true } } } } },
      orderBy: { name: "asc" },
    });
  }

  async listMembers(organizationId: string) {
    return this.db.organizationMember.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, fullName: true, email: true, avatarUrl: true } } },
      orderBy: { joinedAt: "asc" },
    });
  }
}

export { SYSTEM_ROLE_TEMPLATES };
