import { createDepartmentSchema } from "@ai-task-manager/shared";
import { OrganizationService, PermissionService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const permissions = new PermissionService(db);
  await permissions.assertOrgMember(userId, params.orgId);
  const orgs = new OrganizationService(db);
  return orgs.listDepartments(params.orgId);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, createDepartmentSchema);
  const orgs = new OrganizationService(db);
  return orgs.createDepartment(userId, params.orgId, input);
});
