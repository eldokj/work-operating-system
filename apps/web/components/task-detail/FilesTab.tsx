"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { AttachmentChip, type AttachmentSummary } from "./AttachmentChip";

interface TaskAttachmentRow extends AttachmentSummary {
  messageId: string | null;
}

/** Task Files — docs/architecture/16-work-files-attachments.md §Task Files view. Simple
 * aggregation, not a document-management UI: name, type icon, size, uploader, time, and a
 * download link. Deleted attachments are already excluded server-side. */
export function FilesTab({ taskId }: { taskId: string }) {
  const [files, setFiles] = useState<TaskAttachmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<TaskAttachmentRow[]>(`/api/v1/tasks/${taskId}/attachments`)
      .then(setFiles)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load files"));
  }, [taskId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!files) return <p className="text-sm text-slate-400">Loading files…</p>;

  return (
    <div className="card p-4">
      {files.length === 0 ? (
        <p className="text-sm text-slate-400">No files on this task yet.</p>
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
