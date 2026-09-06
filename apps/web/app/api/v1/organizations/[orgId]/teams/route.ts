import { createTeamSchema } from "@ai-task-manager/shared";
import { OrganizationService, PermissionService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, parseQuery, withAuth } from "@/lib/api";
import { z } from "zod";

const listQuerySchema = z.object({ departmentId: z.string().uuid().optional() });

export const GET = withAuth(async (req, { userId, params }) => {
  const permissions = new PermissionService(db);
  await permissions.assertOrgMember(userId, params.orgId);
  const { departmentId } = parseQuery(req, listQuerySchema);
  const orgs = new OrganizationService(db);
  return orgs.listTeams(params.orgId, departmentId);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, createTeamSchema);
  const orgs = new OrganizationService(db);
  return orgs.createTeam(userId, params.orgId, input);
});
