import { ConversationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const conversations = new ConversationService(db);
  return conversations.getConversationForTask(userId, params.taskId);
});
