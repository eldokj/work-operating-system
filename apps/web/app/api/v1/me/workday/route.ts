import { workdayDateQuerySchema } from "@ai-task-manager/shared";
import { DailyWorkService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseQuery, withAuth } from "@/lib/api";

// Phase 3 — docs/architecture/19-phase3-daily-work-cycle-architecture-report.md §20.
// Read-only — never creates a Workday row (that's POST .../start). Defaults to "today" in
// the caller's own local timezone (User.defaultTimezone), never the server's clock.
export const GET = withAuth(async (req, { userId }) => {
  const query = parseQuery(req, workdayDateQuerySchema);
  const dailyWork = new DailyWorkService(db);
  return dailyWork.getWorkday(userId, query.date);
});
