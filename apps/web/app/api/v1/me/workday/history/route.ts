import { z } from "zod";
import { DailyWorkService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseQuery, withAuth } from "@/lib/api";

const historyQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Cursor-paginated browse of past Workdays (doc 19 §20/§26) — mostly future-reporting-
// facing today, and useful for START's "what happened recently" view.
export const GET = withAuth(async (req, { userId }) => {
  const query = parseQuery(req, historyQuerySchema);
  const dailyWork = new DailyWorkService(db);
  return dailyWork.listHistory(userId, query);
});
