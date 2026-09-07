import { z } from "zod";

// Phase 2A — docs/architecture/15-task-conversation.md.
// Phase 2B addition (docs/architecture/16-work-files-attachments.md): `body` is now
// optional so an attachment-only message ("[design.pdf]", no text) is valid — but the
// refine below still rejects a truly empty message (no text AND no attachments), so
// existing text-only behavior is unchanged and there is no way to post nothing at all.

export const createMessageSchema = z
  .object({
    body: z.string().max(10_000).optional(),
    parentMessageId: z.string().uuid().nullable().optional(),
    // Server-validated against the SAME task-access check used everywhere else (never
    // trusted at face value) — see ConversationService.createMessage.
    mentionedUserIds: z.array(z.string().uuid()).max(50).optional(),
    // Attachment ids from a prior POST /tasks/:id/attachments upload — server re-verifies
    // each one belongs to this task and this uploader before linking (never trusted at
    // face value either).
    attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .refine((v) => (v.body && v.body.trim().length > 0) || (v.attachmentIds && v.attachmentIds.length > 0), {
    message: "A message needs text, at least one attachment, or both",
    path: ["body"],
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
