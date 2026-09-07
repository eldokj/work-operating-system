import { ConversationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const POST = withAuth(async (_req, { userId, params }) => {
  const conversations = new ConversationService(db);
  await conversations.markRead(userId, params.taskId);
  return { success: true };
});
