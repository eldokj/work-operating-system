import { z } from "zod";

// Phase 2B — docs/architecture/16-work-files-attachments.md. The actual file upload is
// multipart/form-data (see apps/web's route handler — Zod validates the extracted fields,
// not the multipart envelope itself). Declared client-side mimeType/fileName here are
// hints only; packages/domain's attachment-policy re-validates them server-side and is the
// actual authority (doc: "never trust... MIME type alone / original filename").

export const attachmentListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AttachmentListQuery = z.infer<typeof attachmentListQuerySchema>;
