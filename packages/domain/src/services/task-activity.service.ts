import type { PrismaClient } from "@ai-task-manager/db";
import { AuditService } from "./audit.service";
import { TaskService } from "./task.service";

/**
 * Read-only view over the existing audit log, scoped to one task — docs/architecture/15-task-conversation.md
 * §Activity feed. Deliberately not a new event-sourcing table: every write path that
 * already calls AuditService.log() for a task-related action (assignment, review, status
 * change, checklist, comment, message) now also carries a `taskId`, so this is a single
 * indexed query rather than a parallel system generating a second copy of the same facts.
 */
export class TaskActivityService {
  private readonly tasks: TaskService;
  private readonly audit: AuditService;

  constructor(private readonly db: PrismaClient) {
    this.tasks = new TaskService(db);
    this.audit = new AuditService(db);
  }

  async listForTask(actorId: string, taskId: string, opts: { cursor?: string; limit?: number } = {}) {
    await this.tasks.getTaskByIdOrThrow(actorId, taskId); // same view-access check as everywhere else
    return this.audit.listForTask(taskId, opts);
  }
}
