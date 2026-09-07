import { editMessageSchema } from "@ai-task-manager/shared";
import { ConversationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, withAuth } from "@/lib/api";

export const PATCH = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, editMessageSchema);
  const conversations = new ConversationService(db);
  return conversations.editMessage(userId, params.messageId, input);
});

export const DELETE = withAuth(async (_req, { userId, params }) => {
  const conversations = new ConversationService(db);
  await conversations.deleteMessage(userId, params.messageId);
  return { success: true };
});
