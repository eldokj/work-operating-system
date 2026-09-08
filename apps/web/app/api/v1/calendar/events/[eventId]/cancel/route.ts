import { CalendarService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

// Soft-cancel only — matches Task's own "cancelled, never hard-deleted" convention (doc
// 05), applied identically here (doc 26 §3/§23). Idempotent.
export const POST = withAuth(async (_req, { userId, params }) => {
  const calendar = new CalendarService(db);
  return calendar.cancelEvent(userId, params.eventId);
});
