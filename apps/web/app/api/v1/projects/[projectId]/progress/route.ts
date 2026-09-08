import { ProjectService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const projects = new ProjectService(db);
  return projects.getProgress(userId, params.projectId);
});
