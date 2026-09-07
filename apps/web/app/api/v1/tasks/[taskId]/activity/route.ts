import { z } from "zod";
import { TaskActivityService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseQuery, withAuth } from "@/lib/api";

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = withAuth(async (req, { userId, params }) => {
  const query = parseQuery(req, querySchema);
  const activity = new TaskActivityService(db);
  return activity.listForTask(userId, params.taskId, query);
});
