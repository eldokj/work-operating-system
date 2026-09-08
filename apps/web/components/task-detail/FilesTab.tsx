"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { AttachmentChip, type AttachmentSummary } from "./AttachmentChip";
import type { ConversationScope } from "./ConversationTab";

interface TaskAttachmentRow extends AttachmentSummary {
  messageId: string | null;
}

/** Task & Project Files — docs/architecture/16-work-files-attachments.md §Task Files view,
 * extended in Phase 2C (doc 17 §12) to also list a project's files via the same component.
 * Simple aggregation, not a document-management UI: name, type icon, size, uploader, time,
 * and a download link. Deleted attachments are already excluded server-side. */
export function FilesTab({ scope }: { scope: ConversationScope }) {
  const [files, setFiles] = useState<TaskAttachmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const path = scope.kind === "TASK" ? `/api/v1/tasks/${scope.id}/attachments` : `/api/v1/projects/${scope.id}/files`;
    api
      .get<TaskAttachmentRow[]>(path)
      .then(setFiles)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load files"));
  }, [scope.kind, scope.id]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!files) return <p className="text-sm text-slate-400">Loading files…</p>;

  return (
    <div className="card p-4">
      {files.length === 0 ? (
        <p className="text-sm text-slate-400">No files on this {scope.kind === "TASK" ? "task" : "project"} yet.</p>
      ) : (
        <div className="space-y-2">
          {files.map((file) => (
            <div key={file.id} className="flex items-center justify-between gap-3">
              <AttachmentChip attachment={file} />
              <div className="shrink-0 text-right text-xs text-slate-400">
                <p>{file.uploadedBy.fullName}</p>
                <p>{new Date(file.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
