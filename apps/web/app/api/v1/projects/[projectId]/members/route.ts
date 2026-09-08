import { addProjectMemberSchema } from "@ai-task-manager/shared";
import { ProjectService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const projects = new ProjectService(db);
  return projects.listMembers(userId, params.projectId);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, addProjectMemberSchema);
  const projects = new ProjectService(db);
  return projects.addMember(userId, params.projectId, input);
});
