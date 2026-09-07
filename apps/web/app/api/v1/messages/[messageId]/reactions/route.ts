import { addReactionSchema } from "@ai-task-manager/shared";
import { ConversationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, addReactionSchema);
  const conversations = new ConversationService(db);
  return conversations.addReaction(userId, params.messageId, input.emoji);
});
