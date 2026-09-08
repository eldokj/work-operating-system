import { addDailyPlanItemSchema, workdayDateQuerySchema } from "@ai-task-manager/shared";
import { DailyWorkService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, parseQuery, withAuth } from "@/lib/api";

// One day's plan is inherently small (a person's daily plan, not an unbounded list) —
// returned unpaginated, matching the existing /projects/:id/tasks precedent (doc 19 §20).
export const GET = withAuth(async (req, { userId }) => {
  const query = parseQuery(req, workdayDateQuerySchema);
  const dailyWork = new DailyWorkService(db);
  return dailyWork.listItems(userId, query.date);
});

export const POST = withAuth(async (req, { userId }) => {
  const input = await parseJsonBody(req, addDailyPlanItemSchema);
  const dailyWork = new DailyWorkService(db);
  return dailyWork.addItem(userId, input);
});
