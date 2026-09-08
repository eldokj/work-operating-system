import { createMessageSchema, messageListQuerySchema } from "@ai-task-manager/shared";
import { ConversationService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseJsonBody, parseQuery, withAuth } from "@/lib/api";

export const GET = withAuth(async (req, { userId, params }) => {
  const query = parseQuery(req, messageListQuerySchema);
  const conversations = new ConversationService(db);
  return conversations.listMessagesForProject(userId, params.projectId, query);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const input = await parseJsonBody(req, createMessageSchema);
  const conversations = new ConversationService(db);
  return conversations.createMessageForProject(userId, params.projectId, input);
});
