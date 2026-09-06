import { TaskService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const POST = withAuth(async (_req, { userId, params }) => {
  const tasks = new TaskService(db);
  return tasks.submitTask(userId, params.taskId);
});
