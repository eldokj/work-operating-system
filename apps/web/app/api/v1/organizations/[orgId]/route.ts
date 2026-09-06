import { NotFoundError, PermissionService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const permissions = new PermissionService(db);
  await permissions.assertOrgMember(userId, params.orgId);
  const org = await db.organization.findUnique({ where: { id: params.orgId } });
  if (!org) throw new NotFoundError("Organization not found");
  return org;
});
