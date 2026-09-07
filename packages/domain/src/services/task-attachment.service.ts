import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@ai-task-manager/db";
import { PERMISSIONS } from "@ai-task-manager/shared";
import {
  MAX_ATTACHMENTS_PER_UPLOAD,
  sanitizeFileNameForDisplay,
  validateFile,
} from "../attachment-policy";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { canAccessConversation } from "../permission-engine/conversation-access";
import { AuditService } from "./audit.service";
import { PermissionService } from "./permission.service";
import { LocalDiskStorageService, type StorageService } from "./storage.service";
import { TaskService, type TaskWithDetail } from "./task.service";

export interface UploadFileInput {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

export interface AttachmentDTO {
  id: string;
  taskId: string;
  messageId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: { id: string; fullName: string; email: string };
  createdAt: Date;
}

const ATTACHMENT_INCLUDE = {
  uploadedBy: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.TaskAttachmentInclude;

type RawAttachment = Prisma.TaskAttachmentGetPayload<{ include: typeof ATTACHMENT_INCLUDE }>;

function toDTO(row: RawAttachment): AttachmentDTO {
  return {
    id: row.id,
    taskId: row.taskId,
    messageId: row.messageId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
  };
}

/**
 * Work Files & Attachments — docs/architecture/16-work-files-attachments.md.
 *
 * Extends the pre-existing (Phase 1, previously unused) TaskAttachment model rather than
 * introducing a competing one. Holds no authorization logic of its own beyond a single
 * call into the shared canAccessConversation predicate (see assertCanAccessAttachment) —
 * attachment access is conversation access, uniformly, whether or not a given attachment
 * happens to be linked to a message. (An earlier version of this file split that into two
 * rules — task access for unlinked uploads, conversation access for linked ones — which a
 * test caught letting a plain team member upload/list files while a task sat
 * team-pending; unifying to one rule removed the gap.)
 *
 * PostgreSQL stores metadata only; binary content lives behind the StorageService
 * abstraction (local disk in dev, S3-compatible in production — doc 16 §Storage).
 */
export class TaskAttachmentService {
  private readonly tasks: TaskService;
  private readonly permissions: PermissionService;
  private readonly audit: AuditService;
  private readonly storage: StorageService;

  constructor(
    private readonly db: PrismaClient,
    storage?: StorageService
  ) {
    this.tasks = new TaskService(db);
    this.permissions = new PermissionService(db);
    this.audit = new AuditService(db);
    this.storage = storage ?? new LocalDiskStorageService();
  }

  /**
   * Server-generated, opaque, tenant/task-scoped — never the original filename, never
   * client-supplied (doc 16 §Storage keys). Tenant segment is derived from the task's own
   * workspace, never from a client-supplied organization id.
   */
  private buildStorageKey(task: TaskWithDetail, attachmentId: string): string {
    const tenantSegment = task.workspace.organizationId
      ? `org_${task.workspace.organizationId}`
      : `user_${task.workspace.ownerUserId}`;
    return `${tenantSegment}/task_${task.id}/${attachmentId}`;
  }

  /**
   * Uploading (task-level, not yet linked to any message) requires plain task visibility
   * plus the same task.comment permission bar posting a message already uses — reasonable
   * given uploading is itself a form of contributing to the task, and keeps this from being
   * a fourth, independently-invented permission.
   */
  /**
   * Upload and retrieval/listing authorization: attachment access is conversation access,
   * uniformly — deliberately NOT plain task access, even for a direct task-level upload
   * with no messageId (doc 16 §Authorization). An earlier version of this service used
   * the broader canViewTask for the messageId-null case, which turned out to let a plain
   * team member upload/list files while the task sat team-pending — exactly the exposure
   * the Phase 2A regression test (doc 15) exists to prevent, just reached through files
   * instead of messages. Using one rule everywhere removes that gap and is simpler besides.
   */
  private async assertCanAccessAttachment(actorId: string, task: TaskWithDetail): Promise<void> {
    if (!(await canAccessConversation(this.permissions, actorId, task))) {
      throw new ForbiddenError("You do not have access to this task's files");
    }
  }

  private async assertCanUpload(actorId: string, task: TaskWithDetail): Promise<void> {
    await this.assertCanAccessAttachment(actorId, task);
    if (task.workspace.type === "ORGANIZATION") {
      await this.permissions.assertHasAnyGrantWithPermission(actorId, task.workspace.organizationId!, PERMISSIONS.TASK_COMMENT);
    }
  }

  async uploadAttachments(actorId: string, taskId: string, files: UploadFileInput[]): Promise<AttachmentDTO[]> {
    if (files.length === 0) throw new ValidationError("No files were provided");
    if (files.length > MAX_ATTACHMENTS_PER_UPLOAD) {
      throw new ValidationError(`Cannot upload more than ${MAX_ATTACHMENTS_PER_UPLOAD} files at once`);
    }

    const task = await this.tasks.getTaskRawByIdOrThrow(taskId);
    await this.assertCanUpload(actorId, task);

    // Validate every file before writing anything to storage (doc 16 §Upload flow).
    for (const file of files) {
      const result = validateFile({ fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.data.byteLength });
      if (!result.ok) throw new ValidationError(result.reason);
    }

    const prepared = files.map((file) => {
      const id = randomUUID();
      return {
        id,
        fileName: sanitizeFileNameForDisplay(file.fileName),
        mimeType: file.mimeType,
        data: file.data,
        storagePath: this.buildStorageKey(task, id),
      };
    });

    const written: string[] = [];
    try {
      for (const p of prepared) {
        await this.storage.put(p.storagePath, p.data, p.mimeType);
        written.push(p.storagePath);
      }

      const rows = await this.db.$transaction(async (tx) => {
        const txAudit = new AuditService(tx);
        const created: RawAttachment[] = [];
        for (const p of prepared) {
          const row = await tx.taskAttachment.create({
            data: {
              id: p.id,
              taskId,
              uploadedById: actorId,
              storagePath: p.storagePath,
              fileName: p.fileName,
              mimeType: p.mimeType,
              sizeBytes: BigInt(p.data.byteLength),
            },
            include: ATTACHMENT_INCLUDE,
          });
          created.push(row);
          await txAudit.log({
            organizationId: task.workspace.organizationId,
            actorId,
            action: "attachment.uploaded",
            entityType: "TaskAttachment",
            entityId: row.id,
            taskId,
            after: { fileName: p.fileName, mimeType: p.mimeType, sizeBytes: p.data.byteLength },
          });
        }
        return created;
      });

      return rows.map(toDTO);
    } catch (err) {
      // Orphan prevention (doc 16 §Upload flow): DB finalization failed after files were
      // already written — best-effort compensating delete rather than a distributed saga.
      await Promise.all(written.map((key) => this.storage.delete(key).catch(() => undefined)));
      throw err;
    }
  }

  async listForTask(actorId: string, taskId: string): Promise<AttachmentDTO[]> {
    const task = await this.tasks.getTaskRawByIdOrThrow(taskId);
    await this.assertCanAccessAttachment(actorId, task);
    const rows = await this.db.taskAttachment.findMany({
      where: { taskId, isDeleted: false },
      include: ATTACHMENT_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDTO);
  }

  private async loadAttachmentAndTask(attachmentId: string) {
    const attachment = await this.db.taskAttachment.findUnique({ where: { id: attachmentId }, include: ATTACHMENT_INCLUDE });
    if (!attachment) throw new NotFoundError("Attachment not found");
    const task = await this.tasks.getTaskRawByIdOrThrow(attachment.taskId);
    return { attachment, task };
  }

  async getAttachmentOrThrow(actorId: string, attachmentId: string): Promise<{ attachment: RawAttachment; task: TaskWithDetail }> {
    const { attachment, task } = await this.loadAttachmentAndTask(attachmentId);
    if (attachment.isDeleted) throw new NotFoundError("Attachment not found");
    await this.assertCanAccessAttachment(actorId, task);
    return { attachment, task };
  }

  /** Retrieval: returns the file bytes plus display metadata, or a signed URL when the
   * storage provider supports one (doc 16 §Secure retrieval). Never returns the raw
   * storage key to the caller. */
  async retrieveAttachment(actorId: string, attachmentId: string) {
    const { attachment } = await this.getAttachmentOrThrow(actorId, attachmentId);

    const signedUrl = await this.storage.getSignedDownloadUrl?.(attachment.storagePath, 300);
    if (signedUrl) {
      return { kind: "redirect" as const, url: signedUrl, fileName: attachment.fileName, mimeType: attachment.mimeType };
    }

    const data = await this.storage.get(attachment.storagePath);
    if (!data) throw new NotFoundError("Attachment file not found in storage");
    return { kind: "stream" as const, data, fileName: attachment.fileName, mimeType: attachment.mimeType };
  }

  /** Sender/uploader-only, same precedent as TaskMessage edit/delete (doc 15). Soft-delete
   * only — the physical bytes are kept (doc 16 §Deletion: "do not immediately hard-delete
   * data if that conflicts with audit/history"); a retention/cleanup job is future work. */
  async deleteAttachment(actorId: string, attachmentId: string): Promise<void> {
    const { attachment, task } = await this.loadAttachmentAndTask(attachmentId);
    if (attachment.isDeleted) return;
    if (attachment.uploadedById !== actorId) {
      throw new ForbiddenError("Only the uploader can delete this attachment");
    }

    await this.db.taskAttachment.update({ where: { id: attachmentId }, data: { isDeleted: true, deletedAt: new Date() } });
    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "attachment.deleted",
      entityType: "TaskAttachment",
      entityId: attachmentId,
      taskId: task.id,
    });
  }

  /**
   * Called by ConversationService.createMessage: validates that every attachmentId (a)
   * exists, (b) belongs to this exact task, (c) was uploaded by the actor sending the
   * message, and (d) isn't already linked to a different message — never trusting the
   * client's list at face value. Read-only; the caller performs the actual link (a simple
   * updateMany) inside its own message-creation transaction.
   */
  async assertAttachmentsLinkable(actorId: string, taskId: string, attachmentIds: string[]): Promise<void> {
    if (attachmentIds.length === 0) return;
    const rows = await this.db.taskAttachment.findMany({ where: { id: { in: attachmentIds } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of attachmentIds) {
      const row = byId.get(id);
      if (!row || row.taskId !== taskId || row.isDeleted) {
        throw new ValidationError(`Attachment not found on this task: ${id}`);
      }
      if (row.uploadedById !== actorId) {
        throw new ForbiddenError(`Only the uploader can attach this file to a message: ${id}`);
      }
      if (row.messageId) {
        throw new ConflictError(`Attachment is already linked to another message: ${id}`);
      }
    }
  }
}
