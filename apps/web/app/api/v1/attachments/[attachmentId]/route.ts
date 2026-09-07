import { NextResponse } from "next/server";
import { TaskAttachmentService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { withAuth, withAuthRaw } from "@/lib/api";

// Secure retrieval — docs/architecture/16-work-files-attachments.md §Secure retrieval.
// Authorization is re-derived here every time (never cached, never trusted from a prior
// request); a guessed/enumerated attachment id gets exactly the same 403/404 a real
// unauthorized user would.
export const GET = withAuthRaw(async (_req, { userId, params }) => {
  const attachments = new TaskAttachmentService(db);
  const result = await attachments.retrieveAttachment(userId, params.attachmentId);

  if (result.kind === "redirect") {
    return NextResponse.redirect(result.url);
  }

  const body = new Uint8Array(result.data);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": result.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(result.fileName)}"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
});

export const DELETE = withAuth(async (_req, { userId, params }) => {
  const attachments = new TaskAttachmentService(db);
  await attachments.deleteAttachment(userId, params.attachmentId);
  return { success: true };
});
