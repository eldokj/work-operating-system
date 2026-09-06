import { addProgressUpdateSchema } from "@ai-task-manager/shared";
import { TaskService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const tasks = new TaskService(db);
  return tasks.listUpdates(userId, params.taskId);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, addProgressUpdateSchema);
  const tasks = new TaskService(db);
  return tasks.addProgressUpdate(userId, params.taskId, input);
});
