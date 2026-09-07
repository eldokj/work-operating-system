import { z } from "zod";

// Phase 2A — docs/architecture/15-task-conversation.md.

export const createMessageSchema = z.object({
  body: z.string().min(1).max(10_000),
  parentMessageId: z.string().uuid().nullable().optional(),
  // Server-validated against the SAME task-access check used everywhere else (never
  // trusted at face value) — see ConversationService.createMessage.
  mentionedUserIds: z.array(z.string().uuid()).max(50).optional(),
});
export type CreateMessageInput = z.infer<typeof createMessageSchema>;

export const editMessageSchema = z.object({
  body: z.string().min(1).max(10_000),
});
export type EditMessageInput = z.infer<typeof editMessageSchema>;

export const addReactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});
export type AddReactionInput = z.infer<typeof addReactionSchema>;

export const messageListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;
