import { createTaskSchema, taskListFilterSchema } from "@ai-task-manager/shared";
import { TaskService, ValidationError } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, parseQuery, withAuth } from "@/lib/api";

export const POST = withAuth(async (req, { userId }) => {
  const input = await parseJsonBody(req, createTaskSchema);
  const tasks = new TaskService(db);
  return tasks.createTask(userId, input);
});

export const GET = withAuth(async (req, { userId }) => {
  const filter = parseQuery(req, taskListFilterSchema);
  if (!filter.workspaceId) throw new ValidationError("workspaceId query parameter is required");
  const tasks = new TaskService(db);
  return tasks.listTasks(userId, filter.workspaceId, filter);
});
