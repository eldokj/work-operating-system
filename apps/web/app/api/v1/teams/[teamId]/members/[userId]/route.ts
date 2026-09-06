import { setTeamHeadSchema } from "@ai-task-manager/shared";
import { NotFoundError, OrganizationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

async function resolveOrgId(teamId: string): Promise<string> {
  const team = await db.team.findUnique({ where: { id: teamId }, select: { organizationId: true } });
  if (!team) throw new NotFoundError("Team not found");
  return team.organizationId;
}

// Set/unset a Team Head — doc 04 §"team.assign_head".
export const PATCH = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, setTeamHeadSchema);
  const organizationId = await resolveOrgId(params.teamId);
  const orgs = new OrganizationService(db);
  return orgs.setTeamHead(userId, organizationId, params.teamId, params.userId, input.isHead);
});
