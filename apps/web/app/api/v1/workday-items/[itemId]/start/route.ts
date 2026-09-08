import { DailyWorkService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

// Idempotent: re-posting after startedAt is already set is a harmless no-op re-fetch, not
// an error (doc 19 §20). Never touches Task.status — purely local to the daily-plan layer.
export const POST = withAuth(async (_req, { userId, params }) => {
  const dailyWork = new DailyWorkService(db);
  return dailyWork.startItem(userId, params.itemId);
});
