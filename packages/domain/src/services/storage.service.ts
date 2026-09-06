import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// StorageService interface — see docs/architecture/14-phase1-implementation-deviations.md #1.
// Swapping to Supabase Storage later means implementing this same interface
// (SupabaseStorageService) and changing the one place that constructs a StorageService.
export interface StorageService {
  put(input: { organizationId: string | null; fileName: string; mimeType: string; data: Buffer }): Promise<{
    storagePath: string;
  }>;
  getUrl(storagePath: string): Promise<string>;
}

/**
 * Phase 1 local-disk adapter, scoped per organization the same way a Supabase
 * bucket-per-org would be. Not suitable for production/multi-instance deployment —
 * that's exactly the swap point documented in doc 14.
 */
export class LocalDiskStorageService implements StorageService {
  constructor(private readonly baseDir: string = process.env.STORAGE_LOCAL_DIR ?? "./storage/local") {}

  async put(input: { organizationId: string | null; fileName: string; mimeType: string; data: Buffer }) {
    const scope = input.organizationId ?? "personal";
    const dir = path.join(this.baseDir, scope);
    await mkdir(dir, { recursive: true });
    const safeName = `${randomUUID()}-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const fullPath = path.join(dir, safeName);
    await writeFile(fullPath, input.data);
    return { storagePath: path.join(scope, safeName) };
  }

  async getUrl(storagePath: string): Promise<string> {
    // Served by an internal route handler that checks authorization before streaming the
    // file back (doc 12 §12.8 — never a public bucket / static path).
    return `/api/v1/attachments/file/${encodeURIComponent(storagePath)}`;
  }
}
