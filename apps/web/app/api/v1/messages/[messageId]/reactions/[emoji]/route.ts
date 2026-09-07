import { ConversationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const DELETE = withAuth(async (_req, { userId, params }) => {
  const conversations = new ConversationService(db);
  return conversations.removeReaction(userId, params.messageId, decodeURIComponent(params.emoji));
});
