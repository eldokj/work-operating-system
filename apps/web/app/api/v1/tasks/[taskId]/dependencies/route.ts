import { addTaskDependencySchema } from "@ai-task-manager/shared";
import { TaskService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

// Phase 8 — docs/architecture/28-phase8-task-dependencies-architecture-report.md §6.
export const GET = withAuth(async (_req, { userId, params }) => {
  const tasks = new TaskService(db);
  return tasks.listDependencies(userId, params.taskId);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, addTaskDependencySchema);
  const tasks = new TaskService(db);
  return tasks.addDependency(userId, params.taskId, input);
});
