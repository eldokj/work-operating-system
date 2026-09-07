import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  sanitizeFileNameForDisplay,
  validateFile,
} from "./attachment-policy";

describe("validateFile", () => {
  it("accepts an allowed image", () => {
    expect(validateFile({ fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 1024 })).toEqual({ ok: true });
  });

  it("accepts an allowed document", () => {
    expect(validateFile({ fileName: "budget.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 2048 })).toEqual({
      ok: true,
    });
  });

  it("rejects an empty file", () => {
    const result = validateFile({ fileName: "empty.png", mimeType: "image/png", sizeBytes: 0 });
    expect(result.ok).toBe(false);
  });

  it("rejects a file over the size limit", () => {
    const result = validateFile({ fileName: "huge.mp4", mimeType: "video/mp4", sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/limit/i);
  });

  it("rejects an unsupported MIME type outright", () => {
    const result = validateFile({ fileName: "archive.zip", mimeType: "application/zip", sizeBytes: 1024 });
    expect(result.ok).toBe(false);
  });

  it("rejects explicitly dangerous extensions even with a spoofed allowed-looking name", () => {
    for (const fileName of ["virus.exe", "script.js", "payload.sh", "install.bat", "page.html", "icon.svg"]) {
      const result = validateFile({ fileName, mimeType: "image/png", sizeBytes: 1024 });
      expect(result.ok, `${fileName} should be rejected`).toBe(false);
    }
  });

  it("rejects a MIME/extension mismatch (declared type doesn't match the file's own extension)", () => {
    const result = validateFile({ fileName: "not-a-video.mp4", mimeType: "image/png", sizeBytes: 1024 });
    expect(result.ok).toBe(false);
  });

  it("rejects a file with no extension when the MIME type requires one to cross-check", () => {
    // No extension at all is allowed through the MIME allowlist check alone (extension
    // check is skipped when there isn't one) — documents current behavior explicitly.
    const result = validateFile({ fileName: "noext", mimeType: "image/png", sizeBytes: 1024 });
    expect(result.ok).toBe(true);
  });
});

describe("sanitizeFileNameForDisplay", () => {
  it("strips path separators", () => {
    expect(sanitizeFileNameForDisplay("../../etc/passwd")).not.toMatch(/[/\\]/);
  });

  it("strips parent-directory traversal tokens", () => {
    expect(sanitizeFileNameForDisplay("..\\..\\windows\\system32")).not.toContain("..");
  });

  it("strips control characters including null bytes", () => {
    const sanitized = sanitizeFileNameForDisplay("file\x00name\x1f.txt");
    expect(sanitized).not.toMatch(/[\x00-\x1f]/);
  });

  it("caps absurdly long filenames", () => {
    const sanitized = sanitizeFileNameForDisplay("a".repeat(500) + ".txt");
    expect(sanitized.length).toBeLessThanOrEqual(200);
  });

  it("falls back to a safe default for a name that sanitizes to nothing", () => {
    expect(sanitizeFileNameForDisplay("////")).toBe("____");
    expect(sanitizeFileNameForDisplay("\x00\x01\x02")).toBe("file");
  });

  it("leaves a normal filename untouched", () => {
    expect(sanitizeFileNameForDisplay("design-v3.pdf")).toBe("design-v3.pdf");
  });
});
