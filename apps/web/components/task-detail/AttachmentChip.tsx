export interface AttachmentSummary {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: { fullName: string };
  createdAt: string;
}

function iconFor(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType === "application/pdf") return "📕";
  if (mimeType.includes("word")) return "📝";
  if (mimeType.includes("sheet") || mimeType.includes("excel")) return "📊";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "📽️";
  if (mimeType === "text/plain") return "📄";
  return "📎";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A single attachment, shown inline in a message bubble or the Files tab list. Preview is
 * intentionally minimal (doc 16 §Previews): images get an inline thumbnail via the same
 * authenticated retrieval endpoint (the browser sends the session cookie automatically on
 * a same-origin <img> request); everything else is a plain authenticated download link —
 * no office-document rendering, no video transcoding, no thumbnail service. */
export function AttachmentChip({ attachment, compact = false }: { attachment: AttachmentSummary; compact?: boolean }) {
  const href = `/api/v1/attachments/${attachment.id}`;
  const isImage = attachment.mimeType.startsWith("image/");

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm hover:border-brand-300 hover:bg-brand-50 ${
        compact ? "max-w-xs" : ""
      }`}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={href} alt={attachment.fileName} className="h-8 w-8 shrink-0 rounded object-cover" />
      ) : (
        <span className="text-lg leading-none">{iconFor(attachment.mimeType)}</span>
      )}
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-700">{attachment.fileName}</p>
        <p className="text-xs text-slate-400">{formatFileSize(attachment.sizeBytes)}</p>
      </div>
    </a>
  );
}
