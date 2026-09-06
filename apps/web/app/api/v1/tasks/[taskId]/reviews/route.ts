import { reviewDecisionSchema } from "@ai-task-manager/shared";
import { TaskService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, reviewDecisionSchema);
  const tasks = new TaskService(db);
  return tasks.reviewTask(userId, params.taskId, input);
});
