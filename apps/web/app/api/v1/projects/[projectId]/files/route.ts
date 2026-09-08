import { TaskAttachmentService, ValidationError } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { userId, params }) => {
  const attachments = new TaskAttachmentService(db);
  return attachments.listForProject(userId, params.projectId);
});

export const POST = withAuth(async (req, { userId, params }) => {
  const form = await req.formData().catch(() => {
    throw new ValidationError("Request must be multipart/form-data");
  });

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    throw new ValidationError("No files were provided (expected one or more 'files' form fields)");
  }

  const prepared = await Promise.all(
    files.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      data: Buffer.from(await file.arrayBuffer()),
    }))
  );

  const attachments = new TaskAttachmentService(db);
  return attachments.uploadAttachmentsForProject(userId, params.projectId, prepared);
});
