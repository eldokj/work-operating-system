import { workdayDateQuerySchema } from "@ai-task-manager/shared";
import { DailyWorkService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseQuery, withAuth } from "@/lib/api";

// Idempotent (doc 19 §20/§22): lazily creates the Workday row if absent and sets
// startedAt if unset — "starting the day" is an implicit side effect of engaging with it,
// not a button the user must remember to press first.
export const POST = withAuth(async (req, { userId }) => {
  const query = parseQuery(req, workdayDateQuerySchema);
  const dailyWork = new DailyWorkService(db);
  return dailyWork.startWorkday(userId, query.date);
});
