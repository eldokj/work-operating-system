import type { Prisma, PrismaClient } from "@ai-task-manager/db";
import { PERMISSIONS } from "@ai-task-manager/shared";
import type { CreateMessageInput, EditMessageInput } from "@ai-task-manager/shared";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { canAccessConversation as canAccessConversationImpl } from "../permission-engine/conversation-access";
import { AuditService } from "./audit.service";
import { NotificationService, NotificationType } from "./notification.service";
import { PermissionService } from "./permission.service";
import { TaskAttachmentService, type AttachmentDTO } from "./task-attachment.service";
import { TaskService, type TaskWithDetail } from "./task.service";

const PERSON_SELECT = { id: true, fullName: true, email: true } satisfies Prisma.UserSelect;

const MESSAGE_INCLUDE = {
  sender: { select: PERSON_SELECT },
  parentMessage: { include: { sender: { select: PERSON_SELECT } } },
  mentions: { include: { mentionedUser: { select: PERSON_SELECT } } },
  reactions: { include: { user: { select: PERSON_SELECT } } },
  attachments: { where: { isDeleted: false }, include: { uploadedBy: { select: PERSON_SELECT } } },
} satisfies Prisma.TaskMessageInclude;

type RawMessage = Prisma.TaskMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

export interface FormattedReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  users: Array<{ id: string; fullName: string }>;
}

/**
 * Task Conversations — docs/architecture/15-task-conversation.md.
 *
 * Holds exactly one piece of authorization logic of its own — canAccessConversation below
 * — and even that is a composition of existing PermissionService/TaskService building
 * blocks, not a new primitive. Every method loads the task via
 * TaskService.getTaskRawByIdOrThrow (existence only) and then applies
 * canAccessConversation on top, rather than TaskService's own canViewTask, because
 * conversation access is deliberately narrower than task view access in exactly one case
 * (see canAccessConversation's doc comment). There is no separate membership table backing
 * this — see the schema comment on TaskConversation for why.
 */
export class ConversationService {
  private readonly tasks: TaskService;
  private readonly permissions: PermissionService;
  private readonly audit: AuditService;
  private readonly notifications: NotificationService;
  private readonly attachments: TaskAttachmentService;

  constructor(private readonly db: PrismaClient) {
    this.tasks = new TaskService(db);
    this.permissions = new PermissionService(db);
    this.audit = new AuditService(db);
    this.notifications = new NotificationService(db);
    this.attachments = new TaskAttachmentService(db);
  }

  /**
   * Conversation access — deliberately NOT the same as TaskService.canViewTask. See
   * ../permission-engine/conversation-access.ts for the full rule and rationale (extracted
   * there, rather than implemented here, specifically so TaskAttachmentService can reuse it
   * without a circular dependency between the two services — doc 16).
   */
  async canAccessConversation(userId: string, task: TaskWithDetail): Promise<boolean> {
    return canAccessConversationImpl(this.permissions, userId, task);
  }

  private async assertCanAccessConversation(userId: string, task: TaskWithDetail): Promise<void> {
    if (!(await this.canAccessConversation(userId, task))) {
      throw new ForbiddenError("You do not have access to this task's conversation");
    }
  }

  /** Same bar as the pre-existing addComment (doc 04 task.comment) — reused, not reinvented. */
  private async assertCanParticipate(actorId: string, task: TaskWithDetail): Promise<void> {
    if (task.workspace.type === "ORGANIZATION") {
      await this.permissions.assertHasAnyGrantWithPermission(actorId, task.workspace.organizationId!, PERMISSIONS.TASK_COMMENT);
    }
  }

  private formatMessage(raw: RawMessage, viewerId: string) {
    const reactionsByEmoji = new Map<string, FormattedReaction>();
    for (const r of raw.reactions) {
      const existing = reactionsByEmoji.get(r.emoji);
      if (existing) {
        existing.count += 1;
        existing.users.push({ id: r.user.id, fullName: r.user.fullName });
        if (r.userId === viewerId) existing.reactedByMe = true;
      } else {
        reactionsByEmoji.set(r.emoji, {
          emoji: r.emoji,
          count: 1,
          reactedByMe: r.userId === viewerId,
          users: [{ id: r.user.id, fullName: r.user.fullName }],
        });
      }
    }

    return {
      id: raw.id,
      body: raw.isDeleted ? null : raw.body,
      isDeleted: raw.isDeleted,
      isEdited: raw.isEdited,
      editedAt: raw.editedAt,
      createdAt: raw.createdAt,
      sender: raw.sender,
      parentMessage: raw.parentMessage
        ? {
            id: raw.parentMessage.id,
            body: raw.parentMessage.isDeleted ? null : raw.parentMessage.body,
            isDeleted: raw.parentMessage.isDeleted,
            sender: raw.parentMessage.sender,
          }
        : null,
      mentions: raw.mentions.map((m) => m.mentionedUser),
      reactions: [...reactionsByEmoji.values()],
      // Deleted messages hide attachments too, same as they hide body text — a soft-
      // deleted message's content (text or files) is never returned to clients.
      attachments: raw.isDeleted
        ? []
        : raw.attachments.map((a) => ({
            id: a.id,
            fileName: a.fileName,
            mimeType: a.mimeType,
            sizeBytes: Number(a.sizeBytes),
            uploadedBy: a.uploadedBy,
            createdAt: a.createdAt,
          })),
    };
  }

  private async getConversationOrThrow(taskId: string) {
    const conversation = await this.db.taskConversation.findUnique({ where: { taskId } });
    if (!conversation) {
      // Should not happen post-backfill (every task gets one transactionally on creation
      // — see TaskService.createTask) — surfaced as 404 rather than silently created here,
      // so a real gap is visible instead of masked.
      throw new NotFoundError("This task has no conversation");
    }
    return conversation;
  }

  async getConversationForTask(actorId: string, taskId: string) {
    const task = await this.tasks.getTaskRawByIdOrThrow(taskId);
    await this.assertCanAccessConversation(actorId, task);
    const conversation = await this.getConversationOrThrow(taskId);
    const read = await this.db.taskConversationRead.findUnique({
      where: { conversationId_userId: { conversationId: conversation.id, userId: actorId } },
    });
    const lastReadAt = read?.lastReadAt ?? new Date(0);
    const unreadCount = await this.db.taskMessage.count({
      where: {
        conversationId: conversation.id,
        isDeleted: false,
        senderId: { not: actorId },
        createdAt: { gt: lastReadAt },
      },
    });
    return { id: conversation.id, taskId, unreadCount, lastReadAt: read?.lastReadAt ?? null };
  }

  async listMessages(actorId: string, taskId: string, opts: { cursor?: string; limit?: number } = {}) {
    const task = await this.tasks.getTaskRawByIdOrThrow(taskId);
    await this.assertCanAccessConversation(actorId, task);
    const conversation = await this.getConversationOrThrow(taskId);
    const limit = opts.limit ?? 30;

    const rows = await this.db.taskMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: MESSAGE_INCLUDE,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    // Fetched newest-first for cursor pagination, returned oldest-first for natural
    // top-to-bottom chat rendering.
    return { items: page.reverse().map((m) => this.formatMessage(m, actorId)), nextCursor };
  }

  async createMessage(actorId: string, taskId: string, input: CreateMessageInput) {
    const task = await this.tasks.getTaskRawByIdOrThrow(taskId);
    await this.assertCanAccessConversation(actorId, task);
    await this.assertCanParticipate(actorId, task);
    const conversation = await this.getConversationOrThrow(taskId);

    let parent: { id: string; senderId: string; conversationId: string } | null = null;
    if (input.parentMessageId) {
      parent = await this.db.taskMessage.findUnique({
        where: { id: input.parentMessageId },
        select: { id: true, senderId: true, conversationId: true },
      });
      if (!parent || parent.conversationId !== conversation.id) {
        throw new ValidationError("parentMessageId does not belong to this task's conversation");
      }
    }

    // Never trust the client's mention list at face value — each mentioned user must
    // independently satisfy the exact same CONVERSATION-access check as the poster (doc:
    // "Do not allow arbitrary organization-wide user mentions if they do not have access").
    const mentionedUserIds = [...new Set(input.mentionedUserIds ?? [])].filter((id) => id !== actorId);
    for (const candidateId of mentionedUserIds) {
      if (!(await this.canAccessConversation(candidateId, task))) {
        throw new ValidationError(`Cannot mention a user who does not have access to this task: ${candidateId}`);
      }
    }

    // Same treatment for attachments (doc 16): never trust the client's attachmentIds list
    // — each must be this task's, this actor's own upload, and not already linked elsewhere.
    const attachmentIds = [...new Set(input.attachmentIds ?? [])];
    if (attachmentIds.length) {
      await this.attachments.assertAttachmentsLinkable(actorId, taskId, attachmentIds);
    }

    const created = await this.db.$transaction(async (tx) => {
      const message = await tx.taskMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: actorId,
          parentMessageId: input.parentMessageId ?? null,
          body: input.body ?? "",
        },
      });
      if (mentionedUserIds.length) {
        await tx.taskMessageMention.createMany({
          data: mentionedUserIds.map((mentionedUserId) => ({ messageId: message.id, mentionedUserId })),
        });
      }
      if (attachmentIds.length) {
        await tx.taskAttachment.updateMany({
          where: { id: { in: attachmentIds }, taskId, uploadedById: actorId, messageId: null },
          data: { messageId: message.id },
        });
      }
      const txAudit = new AuditService(tx);
      await txAudit.log({
        organizationId: task.workspace.organizationId,
        actorId,
        action: "task.message_added",
        entityType: "TaskMessage",
        entityId: message.id,
        taskId,
        after: { parentMessageId: input.parentMessageId ?? null, mentionCount: mentionedUserIds.length, attachmentCount: attachmentIds.length },
      });
      return message;
    });

    // Notify existing primary participants (creator + current individual assignee) plus,
    // for a reply, the parent message's sender — same pattern as the pre-existing
    // addComment notification, extended to also cover replies.
    const notifyIds = new Set<string>([task.createdById]);
    const current = task.assignments.find((a) => a.isCurrent);
    if (current?.assigneeType === "USER" && current.assigneeUserId) notifyIds.add(current.assigneeUserId);
    if (parent) notifyIds.add(parent.senderId);
    notifyIds.delete(actorId);
    await this.notifications.notifyMany(
      [...notifyIds],
      NotificationType.MESSAGE_ADDED,
      { taskId, taskTitle: task.title, messageId: created.id, senderId: actorId },
      taskId
    );

    if (mentionedUserIds.length) {
      await this.notifications.notifyMany(
        mentionedUserIds,
        NotificationType.MENTIONED_IN_TASK,
        { taskId, taskTitle: task.title, messageId: created.id, mentionedBy: actorId },
        taskId
      );
    }

    return this.getMessageByIdOrThrow(created.id, actorId);
  }

  private async getMessageByIdOrThrow(messageId: string, viewerId: string) {
    const raw = await this.db.taskMessage.findUnique({ where: { id: messageId }, include: MESSAGE_INCLUDE });
    if (!raw) throw new NotFoundError("Message not found");
    return this.formatMessage(raw, viewerId);
  }

  private async loadMessageAndTask(actorId: string, messageId: string) {
    const message = await this.db.taskMessage.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!message) throw new NotFoundError("Message not found");
    const task = await this.tasks.getTaskRawByIdOrThrow(message.conversation.taskId);
    await this.assertCanAccessConversation(actorId, task);
    return { message, task };
  }

  async editMessage(actorId: string, messageId: string, input: EditMessageInput) {
    const { message, task } = await this.loadMessageAndTask(actorId, messageId);
    if (message.senderId !== actorId) throw new ForbiddenError("Only the sender can edit this message");
    if (message.isDeleted) throw new ConflictError("Cannot edit a deleted message");

    await this.db.taskMessage.update({
      where: { id: messageId },
      data: { body: input.body, isEdited: true, editedAt: new Date() },
    });
    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "task.message_edited",
      entityType: "TaskMessage",
      entityId: messageId,
      taskId: task.id,
    });
    return this.getMessageByIdOrThrow(messageId, actorId);
  }

  async deleteMessage(actorId: string, messageId: string): Promise<void> {
    const { message, task } = await this.loadMessageAndTask(actorId, messageId);
    if (message.senderId !== actorId) throw new ForbiddenError("Only the sender can delete this message");
    if (message.isDeleted) return;

    await this.db.taskMessage.update({
      where: { id: messageId },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "task.message_deleted",
      entityType: "TaskMessage",
      entityId: messageId,
      taskId: task.id,
    });
  }

  async addReaction(actorId: string, messageId: string, emoji: string) {
    const { message, task } = await this.loadMessageAndTask(actorId, messageId);
    await this.assertCanParticipate(actorId, task);
    if (message.isDeleted) throw new ConflictError("Cannot react to a deleted message");

    await this.db.taskMessageReaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId: actorId, emoji } },
      update: {},
      create: { messageId, userId: actorId, emoji },
    });
    return this.getMessageByIdOrThrow(messageId, actorId);
  }

  async removeReaction(actorId: string, messageId: string, emoji: string) {
    await this.loadMessageAndTask(actorId, messageId); // authorization only
    await this.db.taskMessageReaction.deleteMany({ where: { messageId, userId: actorId, emoji } });
    return this.getMessageByIdOrThrow(messageId, actorId);
  }

  async markRead(actorId: string, taskId: string): Promise<void> {
    const task = await this.tasks.getTaskRawByIdOrThrow(taskId);
    await this.assertCanAccessConversation(actorId, task);
    const conversation = await this.getConversationOrThrow(taskId);
    await this.db.taskConversationRead.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId: actorId } },
      update: { lastReadAt: new Date() },
      create: { conversationId: conversation.id, userId: actorId, lastReadAt: new Date() },
    });
  }
}
