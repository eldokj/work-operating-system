import { TaskService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const DELETE = withAuth(async (_req, { userId, params }) => {
  const tasks = new TaskService(db);
  await tasks.removeDependency(userId, params.taskId, params.dependencyId);
  return { success: true };
});
