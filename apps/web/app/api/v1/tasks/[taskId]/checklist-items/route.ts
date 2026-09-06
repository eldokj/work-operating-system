import { addChecklistItemSchema } from "@ai-task-manager/shared";
import { TaskService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, addChecklistItemSchema);
  const tasks = new TaskService(db);
  return tasks.addChecklistItem(userId, params.taskId, input);
});
