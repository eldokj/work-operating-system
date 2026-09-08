import { ProjectService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const DELETE = withAuth(async (_req, { userId, params }) => {
  const projects = new ProjectService(db);
  await projects.removeTeam(userId, params.projectId, params.teamId);
  return { success: true };
});
