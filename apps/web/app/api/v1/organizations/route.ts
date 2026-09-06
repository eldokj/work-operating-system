import { createOrganizationSchema } from "@ai-task-manager/shared";
import { OrganizationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const POST = withAuth(async (req, { userId }) => {
  const input = await parseJsonBody(req, createOrganizationSchema);
  const orgs = new OrganizationService(db);
  return orgs.createOrganization(userId, input);
});

export const GET = withAuth(async (_req, { userId }) => {
  const memberships = await db.organizationMember.findMany({
    where: { userId, status: "ACTIVE" },
    include: { organization: true },
  });
  return memberships.map((m) => m.organization);
});
