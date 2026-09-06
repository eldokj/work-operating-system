import { NotificationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const POST = withAuth(async (_req, { userId, params }) => {
  const notifications = new NotificationService(db);
  await notifications.markRead(params.id, userId);
  return { success: true };
});
