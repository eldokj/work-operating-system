import { updateChecklistItemSchema } from "@ai-task-manager/shared";
import { NotFoundError, TaskService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

async function resolveTaskId(itemId: string): Promise<string> {
  const item = await db.taskChecklistItem.findUnique({ where: { id: itemId }, select: { taskId: true } });
  if (!item) throw new NotFoundError("Checklist item not found");
  return item.taskId;
}

export const PATCH = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, updateChecklistItemSchema);
  const taskId = await resolveTaskId(params.itemId);
  const tasks = new TaskService(db);
  return tasks.updateChecklistItem(userId, taskId, params.itemId, input);
});

export const DELETE = withAuth(async (_req, { userId, params }) => {
  const taskId = await resolveTaskId(params.itemId);
  const tasks = new TaskService(db);
  await tasks.deleteChecklistItem(userId, taskId, params.itemId);
  return { success: true };
});
