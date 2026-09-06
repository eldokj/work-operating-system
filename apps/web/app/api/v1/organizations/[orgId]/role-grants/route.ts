import { grantRoleSchema } from "@ai-task-manager/shared";
import { OrganizationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, grantRoleSchema);
  const orgs = new OrganizationService(db);
  return orgs.grantRole(userId, params.orgId, input);
});
