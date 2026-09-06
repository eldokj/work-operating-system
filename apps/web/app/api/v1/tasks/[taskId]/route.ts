import { updateTaskSchema } from "@ai-task-manager/shared";
import { TaskService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const tasks = new TaskService(db);
  return tasks.getTaskByIdOrThrow(userId, params.taskId);
});

export const PATCH = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, updateTaskSchema);
  const tasks = new TaskService(db);
  return tasks.updateTask(userId, params.taskId, input);
});

export const DELETE = withAuth(async (_req, { userId, params }) => {
  const tasks = new TaskService(db);
  return tasks.cancelTask(userId, params.taskId);
});
