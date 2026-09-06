import { addTeamMemberSchema } from "@ai-task-manager/shared";
import { NotFoundError, OrganizationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

async function resolveOrgId(teamId: string): Promise<string> {
  const team = await db.team.findUnique({ where: { id: teamId }, select: { organizationId: true } });
  if (!team) throw new NotFoundError("Team not found");
  return team.organizationId;
}

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, addTeamMemberSchema);
  const organizationId = await resolveOrgId(params.teamId);
  const orgs = new OrganizationService(db);
  return orgs.addTeamMember(userId, organizationId, params.teamId, input);
});
