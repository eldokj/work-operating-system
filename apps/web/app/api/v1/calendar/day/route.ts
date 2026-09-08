import { calendarDayQuerySchema } from "@ai-task-manager/shared";
import { CalendarService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseQuery, withAuth } from "@/lib/api";

// The Today page's merged timeline — doc 26 §17/§18. CalendarEvents + scheduled
// DailyPlanItems, reconciled only here at read time, never persisted together.
export const GET = withAuth(async (req, { userId }) => {
  const query = parseQuery(req, calendarDayQuerySchema);
  const calendar = new CalendarService(db);
  return calendar.getDayTimeline(userId, query.workspaceId, query.date);
});
