import { createProjectDateSchema } from "@ai-task-manager/shared";
import { ProjectService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const projects = new ProjectService(db);
  return projects.listDates(userId, params.projectId);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, createProjectDateSchema);
  const projects = new ProjectService(db);
  return projects.addDate(userId, params.projectId, input);
});
