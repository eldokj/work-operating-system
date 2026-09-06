import { z } from "zod";
import { OrganizationService, PermissionService, ValidationError } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

const addMemberSchema = z.object({ userId: z.string().uuid().optional(), email: z.string().email().optional() });

export const GET = withAuth(async (_req, { userId, params }) => {
  const permissions = new PermissionService(db);
  await permissions.assertOrgMember(userId, params.orgId);
  const orgs = new OrganizationService(db);
  return orgs.listMembers(params.orgId);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, addMemberSchema);
  const orgs = new OrganizationService(db);

  let targetUserId = input.userId;
  if (!targetUserId && input.email) {
    const user = await db.user.findUnique({ where: { email: input.email } });
    if (!user) {
      throw new ValidationError(
        `No user found with email ${input.email} — they must sign up first (Phase 1 has no email-invite flow yet)`
      );
    }
    targetUserId = user.id;
  }
  if (!targetUserId) throw new ValidationError("userId or email is required");

  return orgs.addMember(userId, params.orgId, targetUserId);
});
