import { addProjectTeamSchema } from "@ai-task-manager/shared";
import { ProjectService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const projects = new ProjectService(db);
  return projects.listTeams(userId, params.projectId);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, addProjectTeamSchema);
  const projects = new ProjectService(db);
  return projects.addTeam(userId, params.projectId, input);
});
