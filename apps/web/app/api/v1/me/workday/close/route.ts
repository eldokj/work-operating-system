import { closeWorkdaySchema } from "@ai-task-manager/shared";
import { DailyWorkService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

// Transactional and complete (doc 19 §8/§20): every unresolved item must have an
// explicit disposition or the whole close is rejected (422) — never a partial close,
// never a silent carry-forward. NOT idempotent by design: closing an already-closed day
// is a 409, not a harmless no-op.
export const POST = withAuth(async (req, { userId }) => {
  const input = await parseJsonBody(req, closeWorkdaySchema);
  const dailyWork = new DailyWorkService(db);
  return dailyWork.closeWorkday(userId, input);
});
