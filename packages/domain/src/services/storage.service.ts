import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// StorageService interface — see docs/architecture/14-phase1-implementation-deviations.md #1
// and docs/architecture/16-work-files-attachments.md. A minimal, opaque key-value blob
// store: `key` is an already-safe, server-generated string (never a client-supplied path
// or filename — see TaskAttachmentService.buildStorageKey). Swapping to S3-compatible
// storage in production means implementing this same interface and changing the one place
// that constructs a StorageService; no business logic changes.
export interface StorageService {
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /**
   * Optional: a short-lived, private, provider-generated download URL. Local disk storage
   * has no such capability (returns undefined) — callers fall back to streaming the file
   * through the server. A future S3-compatible adapter would implement this with a
   * presigned GET URL, never a permanent/public one.
   */
  getSignedDownloadUrl?(key: string, expiresInSeconds: number): Promise<string | undefined>;
}

/**
 * Phase 1/2B local-disk adapter. Not suitable for production/multi-instance deployment —
 * that's exactly the swap point documented in doc 14. `key` may contain `/` (the domain
 * layer uses that to scope by tenant/task) but is validated to never escape `baseDir`.
 */
export class LocalDiskStorageService implements StorageService {
  constructor(private readonly baseDir: string = process.env.STORAGE_LOCAL_DIR ?? "./storage/local") {}

  /** Resolves `key` under baseDir and hard-rejects any attempt to escape it. */
  private resolvePath(key: string): string {
    const resolvedBase = path.resolve(this.baseDir);
    const resolvedTarget = path.resolve(resolvedBase, key);
    if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
      throw new Error(`Refusing to resolve storage key outside baseDir: ${key}`);
    }
    return resolvedTarget;
  }

  async put(key: string, data: Buffer, _mimeType: string): Promise<void> {
    const fullPath = this.resolvePath(key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolvePath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.resolvePath(key), { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  // No getSignedDownloadUrl — local disk has no presigned-URL concept. Callers stream.
}
