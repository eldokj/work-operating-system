import { z } from "zod";
import { OrganizationService, PermissionService } from "@ai-task-manager/domain";
import { PERMISSIONS, type PermissionKey } from "@ai-task-manager/shared";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

const permissionKeyValues = Object.values(PERMISSIONS) as [PermissionKey, ...PermissionKey[]];
const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  permissionKeys: z.array(z.enum(permissionKeyValues)).min(1),
});

export const GET = withAuth(async (_req, { userId, params }) => {
  const permissions = new PermissionService(db);
  await permissions.assertOrgMember(userId, params.orgId);
  const orgs = new OrganizationService(db);
  return orgs.listRoles(params.orgId);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, createRoleSchema);
  const orgs = new OrganizationService(db);
  return orgs.createCustomRole(userId, params.orgId, input);
});
