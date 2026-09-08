import { DailyWorkService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

// Marks the item done for today (doc 19 §7/§20) — never touches Task.status; the
// existing task lifecycle only changes via its own, unmodified Submit/Review APIs.
export const POST = withAuth(async (_req, { userId, params }) => {
  const dailyWork = new DailyWorkService(db);
  return dailyWork.completeItem(userId, params.itemId);
});
