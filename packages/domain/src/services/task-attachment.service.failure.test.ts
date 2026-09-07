// Integration-style tests (real Postgres, not mocked) for the two failure-consistency
// scenarios that are impractical to exercise as black-box HTTP E2E tests: a storage
// write failing mid-batch, and the database transaction failing after storage writes
// already succeeded. Both must leave zero orphaned files and zero inconsistent DB rows
// (docs/architecture/16-work-files-attachments.md §Upload flow).
//
// Uses a real PrismaClient against the same test database the E2E suite uses, and a
// minimal personal-workspace fixture (skips org/RBAC setup entirely — upload
// authorization for a personal task is just "you own the workspace").
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@ai-task-manager/db";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StorageService } from "./storage.service";
import { TaskAttachmentService } from "./task-attachment.service";

// Falls back to the same local Postgres connection docker-compose.yml/.env.example
// define, so this test runs without extra env-loading tooling as long as `docker compose
// up` has been run (same precondition the E2E suite already has).
const DEFAULT_LOCAL_DB_URL = "postgresql://app:app_dev_password@localhost:5433/ai_task_manager?schema=public";
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? process.env.DATABASE_RUNTIME_URL ?? DEFAULT_LOCAL_DB_URL } },
});

class FakeStorage implements StorageService {
  written: string[] = [];
  deleted: string[] = [];
  /** 1-based call index to fail on (e.g. 2 = fail on the second file written), or null to
   * never fail. Storage keys are opaque UUIDs with no filename in them by design (doc 16
   * §Storage keys), so failure injection has to be by call order, not by key content. */
  failOnCallNumber: number | null = null;
  private callCount = 0;

  async put(key: string, _data: Buffer, _mimeType: string): Promise<void> {
    this.callCount += 1;
    if (this.failOnCallNumber !== null && this.callCount === this.failOnCallNumber) {
      throw new Error("Simulated storage failure");
    }
    this.written.push(key);
  }
  async get(): Promise<Buffer | null> {
    return null;
  }
  async delete(key: string): Promise<void> {
    this.deleted.push(key);
  }
}

describe("TaskAttachmentService — upload failure consistency", () => {
  let userId: string;
  let taskId: string;

  beforeAll(async () => {
    const email = `attach-failure-${randomUUID()}@test.local`;
    const user = await prisma.user.create({
      data: { email, fullName: "Attachment Failure Test", passwordHash: await bcrypt.hash("password123!", 4) },
    });
    userId = user.id;
    const workspace = await prisma.workspace.create({ data: { type: "PERSONAL", ownerUserId: userId, name: "Personal" } });
    const task = await prisma.task.create({
      data: { workspaceId: workspace.id, title: "Failure test task", createdById: userId, createdVia: "DIRECT" },
    });
    taskId = task.id;
    await prisma.taskConversation.create({ data: { taskId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("22. a storage failure partway through a multi-file upload leaves zero attachment rows and cleans up files already written", async () => {
    const storage = new FakeStorage();
    storage.failOnCallNumber = 2;
    const service = new TaskAttachmentService(prisma, storage);

    const files = [
      { fileName: "first-file.txt", mimeType: "text/plain", data: Buffer.from("one") },
      { fileName: "second-file.txt", mimeType: "text/plain", data: Buffer.from("two") },
    ];

    await expect(service.uploadAttachments(userId, taskId, files)).rejects.toThrow("Simulated storage failure");

    const rows = await prisma.taskAttachment.findMany({ where: { taskId } });
    expect(rows).toHaveLength(0);
    // The first file WAS written before the second one failed — must be cleaned up.
    expect(storage.deleted.length).toBeGreaterThanOrEqual(1);
  });

  it("23. a database failure after storage succeeds leaves no untracked file — cleanup still runs", async () => {
    const storage = new FakeStorage(); // no induced storage failure this time
    const realService = new TaskAttachmentService(prisma, storage);

    // Force the transaction step specifically to fail, simulating a DB-layer failure
    // that occurs strictly AFTER the storage writes have already succeeded.
    const failingDb = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === "$transaction") {
          return async () => {
            throw new Error("Simulated database failure");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as PrismaClient;
    const failingService = new TaskAttachmentService(failingDb, storage);
    void realService; // constructed only to document the "storage succeeds normally" baseline

    const files = [{ fileName: "db-failure.txt", mimeType: "text/plain", data: Buffer.from("data") }];

    await expect(failingService.uploadAttachments(userId, taskId, files)).rejects.toThrow("Simulated database failure");

    const rows = await prisma.taskAttachment.findMany({ where: { taskId } });
    expect(rows).toHaveLength(0);
    // Storage write succeeded (no induced failure) but must have been rolled back via
    // compensating delete once the DB transaction failed.
    expect(storage.written).toHaveLength(1);
    expect(storage.deleted).toHaveLength(1);
    expect(storage.deleted[0]).toBe(storage.written[0]);
  });
});
