import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorageService } from "./storage.service";

describe("LocalDiskStorageService", () => {
  let baseDir: string;
  let storage: LocalDiskStorageService;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), "attachment-storage-test-"));
    storage = new LocalDiskStorageService(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("writes and reads back a file by an opaque key, including nested scoped paths", async () => {
    const key = "org_abc/task_123/attachment-456";
    await storage.put(key, Buffer.from("hello world"), "text/plain");
    const data = await storage.get(key);
    expect(data?.toString()).toBe("hello world");
  });

  it("returns null for a key that was never written", async () => {
    expect(await storage.get("org_abc/task_123/does-not-exist")).toBeNull();
  });

  it("deletes a file (idempotently — deleting twice does not throw)", async () => {
    const key = "org_abc/task_123/attachment-789";
    await storage.put(key, Buffer.from("data"), "text/plain");
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    await expect(storage.delete(key)).resolves.not.toThrow();
  });

  it("rejects a key that attempts to escape the storage root via parent-directory traversal", async () => {
    await expect(storage.put("../../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toThrow();
  });

  it("rejects an absolute-path-style key", async () => {
    const outside = path.resolve(baseDir, "..", "outside-attack.txt");
    await expect(storage.put(outside, Buffer.from("x"), "text/plain")).rejects.toThrow();
  });
});
