import { updateDailyPlanItemSchema } from "@ai-task-manager/shared";
import { DailyWorkService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

// Flat item route (matches /project-dates/:id, /messages/:id) — resolves its own owning
// Workday/user server-side from the item id, never trusting a client-supplied ownership
// claim (doc 19 §20/§27).
export const PATCH = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, updateDailyPlanItemSchema);
  const dailyWork = new DailyWorkService(db);
  return dailyWork.updateItem(userId, params.itemId, input);
});

// Only permitted while PLANNED and untouched (doc 19 §8/§20) — once execution has begun,
// removal must go through an explicit Close disposition instead of disappearing outright.
export const DELETE = withAuth(async (_req, { userId, params }) => {
  const dailyWork = new DailyWorkService(db);
  await dailyWork.deleteItem(userId, params.itemId);
  return { success: true };
});
