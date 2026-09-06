import { z } from "zod";
import { NotificationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseQuery, withAuth } from "@/lib/api";

const querySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = withAuth(async (req, { userId }) => {
  const query = parseQuery(req, querySchema);
  const notifications = new NotificationService(db);
  return notifications.listForUser(userId, query);
});
