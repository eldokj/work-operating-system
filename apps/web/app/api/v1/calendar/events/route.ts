import { calendarEventRangeQuerySchema, createCalendarEventSchema } from "@ai-task-manager/shared";
import { CalendarService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, parseQuery, withAuth } from "@/lib/api";

// A bounded day/week/agenda range query — unpaginated by design (doc 26 §18/§21), same
// "human-scale" reasoning already applied to a day's plan (doc 19 §29) and search (doc 22).
export const GET = withAuth(async (req, { userId }) => {
  const query = parseQuery(req, calendarEventRangeQuerySchema);
  const calendar = new CalendarService(db);
  const items = await calendar.listEvents(userId, query.workspaceId, query.from, query.to);
  return { items };
});

export const POST = withAuth(async (req, { userId }) => {
  const input = await parseJsonBody(req, createCalendarEventSchema);
  const calendar = new CalendarService(db);
  return calendar.createEvent(userId, input);
});
