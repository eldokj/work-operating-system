import { CalendarService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const DELETE = withAuth(async (_req, { userId, params }) => {
  const calendar = new CalendarService(db);
  return calendar.removeParticipant(userId, params.eventId, params.userId);
});
