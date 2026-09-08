import { z } from "zod";
import { localDateStringSchema, uuidSchema } from "@ai-task-manager/shared";
import { DailyWorkService, ValidationError } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseQuery, withAuth } from "@/lib/api";

const inboxQuerySchema = z.object({
  workspaceId: uuidSchema.optional(),
  date: localDateStringSchema.optional(),
});

// Derived (never a stored list, doc 19 §10): current accepted individual assignments
// (the existing, unchanged "My Tasks") minus tasks already on this day's plan. Scoped to
// one workspace at a time, matching every other "My Tasks"-shaped view already in the app.
export const GET = withAuth(async (req, { userId }) => {
  const query = parseQuery(req, inboxQuerySchema);
  if (!query.workspaceId) throw new ValidationError("workspaceId query parameter is required");
  const dailyWork = new DailyWorkService(db);
  return dailyWork.getInbox(userId, query.workspaceId, query.date);
});
