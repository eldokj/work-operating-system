import { updateCalendarEventSchema } from "@ai-task-manager/shared";
import { CalendarService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const calendar = new CalendarService(db);
  return calendar.getEventByIdOrThrow(userId, params.eventId);
});

export const PATCH = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, updateCalendarEventSchema);
  const calendar = new CalendarService(db);
  return calendar.updateEvent(userId, params.eventId, input);
});
