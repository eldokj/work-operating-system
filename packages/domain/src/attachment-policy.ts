// Centralized file-upload policy — docs/architecture/16-work-files-attachments.md §Validation.
// Everything about "what may be uploaded" lives here, not scattered across routes/services.

export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB — generous for work docs/images, small enough for local disk + a single request body.
export const MAX_ATTACHMENTS_PER_UPLOAD = 10;

export interface AllowedFileType {
  mimeType: string;
  extensions: string[];
  category: "image" | "document" | "video";
}

// Allowlist only — never inferred from "not explicitly denied". Anything not listed here
// is rejected, which is what keeps executables/scripts/HTML/SVG out without needing a
// separate denylist to maintain in parallel.
export const ALLOWED_FILE_TYPES: readonly AllowedFileType[] = [
  { mimeType: "image/jpeg", extensions: ["jpg", "jpeg"], category: "image" },
  { mimeType: "image/png", extensions: ["png"], category: "image" },
  { mimeType: "image/webp", extensions: ["webp"], category: "image" },
  { mimeType: "image/gif", extensions: ["gif"], category: "image" },
  { mimeType: "application/pdf", extensions: ["pdf"], category: "document" },
  { mimeType: "application/msword", extensions: ["doc"], category: "document" },
  {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"],
    category: "document",
  },
  { mimeType: "application/vnd.ms-excel", extensions: ["xls"], category: "document" },
  {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: ["xlsx"],
    category: "document",
  },
  { mimeType: "application/vnd.ms-powerpoint", extensions: ["ppt"], category: "document" },
  {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extensions: ["pptx"],
    category: "document",
  },
  { mimeType: "text/plain", extensions: ["txt"], category: "document" },
  { mimeType: "video/mp4", extensions: ["mp4"], category: "video" },
  { mimeType: "video/webm", extensions: ["webm"], category: "video" },
];

const MIME_TO_TYPE = new Map(ALLOWED_FILE_TYPES.map((t) => [t.mimeType, t]));

// Explicitly named, not just "absent from the allowlist" — documents the deliberate
// exclusions the brief called out (svg included: its MIME is technically an image type,
// but it can carry script content, so it's excluded even though other images are allowed).
export const EXPLICITLY_BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "bat", "cmd", "ps1", "sh", "js", "mjs", "cjs", "html", "htm", "svg", "apk", "msi", "com", "jar",
]);

export interface FileValidationInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export type FileValidationResult = { ok: true } | { ok: false; reason: string };

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx === -1 || idx === fileName.length - 1) return "";
  return fileName.slice(idx + 1).toLowerCase();
}

export function validateFile(input: FileValidationInput): FileValidationResult {
  if (input.sizeBytes <= 0) {
    return { ok: false, reason: "File is empty" };
  }
  if (input.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    return { ok: false, reason: `File exceeds the ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB limit` };
  }

  const extension = getExtension(input.fileName);
  if (EXPLICITLY_BLOCKED_EXTENSIONS.has(extension)) {
    return { ok: false, reason: `File type ".${extension}" is not allowed` };
  }

  const allowed = MIME_TO_TYPE.get(input.mimeType);
  if (!allowed) {
    return { ok: false, reason: `File type "${input.mimeType}" is not supported` };
  }
  if (extension && !allowed.extensions.includes(extension)) {
    return { ok: false, reason: `File extension ".${extension}" does not match declared type "${input.mimeType}"` };
  }

  return { ok: true };
}

/**
 * Display-only sanitization — the storage KEY never uses the filename at all (see
 * TaskAttachmentService.buildStorageKey), so this exists purely so the filename shown back
 * to users can't smuggle path separators, control characters, or an absurd length into any
 * UI/log/header that renders it.
 */
export function sanitizeFileNameForDisplay(fileName: string): string {
  const base = fileName
    .replace(/[/\\]/g, "_") // path separators
    .replace(/\.\./g, "_") // parent-dir traversal tokens
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "") // control characters incl. null bytes
    .trim();
  const safe = base.length > 0 ? base : "file";
  return safe.length > 200 ? safe.slice(0, 200) : safe;
}
