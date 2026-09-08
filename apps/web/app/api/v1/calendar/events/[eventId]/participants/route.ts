import { addCalendarEventParticipantSchema } from "@ai-task-manager/shared";
import { CalendarService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

// Organizer-only (doc 26 §13/§20) — enforced inside CalendarService.addParticipant, not
// re-derived here.
export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, addCalendarEventParticipantSchema);
  const calendar = new CalendarService(db);
  return calendar.addParticipant(userId, params.eventId, input.userId);
});
