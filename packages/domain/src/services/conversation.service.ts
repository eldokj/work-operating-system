import type { Prisma, PrismaClient } from "@ai-task-manager/db";
import { PERMISSIONS } from "@ai-task-manager/shared";
import type { CreateMessageInput, EditMessageInput } from "@ai-task-manager/shared";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { canAccessConversation as canAccessConversationImpl } from "../permission-engine/conversation-access";
import { canAccessProject as canAccessProjectImpl } from "../permission-engine/project-access";
import { AuditService } from "./audit.service";
import { NotificationService, NotificationType } from "./notification.service";
import { PermissionService } from "./permission.service";
import { ProjectService, type ProjectDetail } from "./project.service";
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

/** What every conversation operation needs, regardless of whether it's the task-scoped or
 * project-scoped conversation — resolved once by resolveTaskContext/resolveProjectContext. */
type ConversationContext =
  | { kind: "TASK"; task: TaskWithDetail; organizationId: string | null }
  | { kind: "PROJECT"; project: ProjectDetail; organizationId: string | null };

/**
 * Task & Project Conversations — docs/architecture/15-task-conversation.md (Phase 2A,
 * task-only), generalized in Phase 2C (docs/architecture/17-phase2c-project-workspace-
 * architecture-report.md §11) to also support one main conversation per project, reusing
 * every model/method here rather than duplicating them — TaskMessage/mentions/reactions/
 * read-state are completely unchanged; only the Conversation row itself gained an optional
 * projectId alongside its existing optional taskId (exactly one of the two is ever set).
 *
 * Holds two pieces of authorization logic of its own — canAccessConversation (task) and,
 * new in Phase 2C, project access via canAccessProject — both compositions of existing
 * PermissionService/TaskService/ProjectService building blocks, never new primitives.
 */
export class ConversationService {
  private readonly tasks: TaskService;
  private readonly projects: ProjectService;
  private readonly permissions: PermissionService;
  private readonly audit: AuditService;
  private readonly notifications: NotificationService;
  private readonly attachments: TaskAttachmentService;

  constructor(private readonly db: PrismaClient) {
    this.tasks = new TaskService(db);
    this.projects = new ProjectService(db);
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

  private async resolveTaskContext(taskId: string): Promise<ConversationContext> {
    const task = await this.tasks.getTaskRawByIdOrThrow(taskId);
    return { kind: "TASK", task, organizationId: task.workspace.organizationId };
  }

  private async resolveProjectContext(projectId: string): Promise<ConversationContext> {
    const project = await this.projects.getProjectRawByIdOrThrow(projectId);
    return { kind: "PROJECT", project, organizationId: project.workspace.organizationId };
  }

  private async canAccessContext(userId: string, ctx: ConversationContext): Promise<boolean> {
    return ctx.kind === "TASK"
      ? canAccessConversationImpl(this.permissions, userId, ctx.task)
      : canAccessProjectImpl(this.db, this.permissions, userId, ctx.project);
  }

  private async assertCanAccessContext(userId: string, ctx: ConversationContext): Promise<void> {
    if (!(await this.canAccessContext(userId, ctx))) {
      throw new ForbiddenError("You do not have access to this conversation");
    }
  }

  /** Same bar as the pre-existing addComment (doc 04 task.comment) — reused, not
   * reinvented, for both task and project conversations. */
  private async assertCanParticipate(actorId: string, ctx: ConversationContext): Promise<void> {
    if (ctx.organizationId) {
      await this.permissions.assertHasAnyGrantWithPermission(actorId, ctx.organizationId, PERMISSIONS.TASK_COMMENT);
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

  private async getConversationRowOrThrow(ctx: ConversationContext) {
    const where = ctx.kind === "TASK" ? { taskId: ctx.task.id } : { projectId: ctx.project.id };
    const conversation = await this.db.conversation.findUnique({ where: where as Prisma.ConversationWhereUniqueInput });
    if (!conversation) {
      // Should not happen post-creation (every task/project gets one transactionally —
      // see TaskService.createTask / ProjectService.createProject) — surfaced as 404
      // rather than silently created here, so a real gap is visible instead of masked.
      throw new NotFoundError("This conversation does not exist");
    }
    return conversation;
  }

  private async getConversationInfo(actorId: string, ctx: ConversationContext) {
    await this.assertCanAccessContext(actorId, ctx);
    const conversation = await this.getConversationRowOrThrow(ctx);
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
    return {
      id: conversation.id,
      taskId: conversation.taskId,
      projectId: conversation.projectId,
      unreadCount,
      lastReadAt: read?.lastReadAt ?? null,
    };
  }

  async getConversationForTask(actorId: string, taskId: string) {
    return this.getConversationInfo(actorId, await this.resolveTaskContext(taskId));
  }

  async getConversationForProject(actorId: string, projectId: string) {
    return this.getConversationInfo(actorId, await this.resolveProjectContext(projectId));
  }

  private async listMessagesForContext(actorId: string, ctx: ConversationContext, opts: { cursor?: string; limit?: number } = {}) {
    await this.assertCanAccessContext(actorId, ctx);
    const conversation = await this.getConversationRowOrThrow(ctx);
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

  async listMessages(actorId: string, taskId: string, opts: { cursor?: string; limit?: number } = {}) {
    return this.listMessagesForContext(actorId, await this.resolveTaskContext(taskId), opts);
  }

  async listMessagesForProject(actorId: string, projectId: string, opts: { cursor?: string; limit?: number } = {}) {
    return this.listMessagesForContext(actorId, await this.resolveProjectContext(projectId), opts);
  }

  private async createMessageInContext(actorId: string, ctx: ConversationContext, input: CreateMessageInput) {
    await this.assertCanAccessContext(actorId, ctx);
    await this.assertCanParticipate(actorId, ctx);
    const conversation = await this.getConversationRowOrThrow(ctx);

    let parent: { id: string; senderId: string; conversationId: string } | null = null;
    if (input.parentMessageId) {
      parent = await this.db.taskMessage.findUnique({
        where: { id: input.parentMessageId },
        select: { id: true, senderId: true, conversationId: true },
      });
      if (!parent || parent.conversationId !== conversation.id) {
        throw new ValidationError("parentMessageId does not belong to this conversation");
      }
    }

    // Never trust the client's mention list at face value — each mentioned user must
    // independently satisfy the exact same CONTEXT-access check as the poster (doc: "Do
    // not allow arbitrary organization-wide user mentions if they do not have access").
    const mentionedUserIds = [...new Set(input.mentionedUserIds ?? [])].filter((id) => id !== actorId);
    for (const candidateId of mentionedUserIds) {
      if (!(await this.canAccessContext(candidateId, ctx))) {
        throw new ValidationError(`Cannot mention a user who does not have access to this task: ${candidateId}`);
      }
    }

    // Same treatment for attachments (doc 16): never trust the client's attachmentIds list
    // — each must belong to this exact task/project, this actor's own upload, and not
    // already linked elsewhere.
    const attachmentIds = [...new Set(input.attachmentIds ?? [])];
    if (attachmentIds.length) {
      if (ctx.kind === "TASK") {
        await this.attachments.assertAttachmentsLinkable(actorId, ctx.task.id, attachmentIds);
      } else {
        await this.attachments.assertAttachmentsLinkableForProject(actorId, ctx.project.id, attachmentIds);
      }
    }

    const entityId = ctx.kind === "TASK" ? ctx.task.id : ctx.project.id;

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
          where:
            ctx.kind === "TASK"
              ? { id: { in: attachmentIds }, taskId: entityId, uploadedById: actorId, messageId: null }
              : { id: { in: attachmentIds }, projectId: entityId, uploadedById: actorId, messageId: null },
          data: { messageId: message.id },
        });
      }
      const txAudit = new AuditService(tx);
      await txAudit.log({
        organizationId: ctx.organizationId,
        actorId,
        action: ctx.kind === "TASK" ? "task.message_added" : "project.message_added",
        entityType: "TaskMessage",
        entityId: message.id,
        taskId: ctx.kind === "TASK" ? entityId : undefined,
        projectId: ctx.kind === "PROJECT" ? entityId : undefined,
        after: { parentMessageId: input.parentMessageId ?? null, mentionCount: mentionedUserIds.length, attachmentCount: attachmentIds.length },
      });
      return message;
    });

    // Notify existing primary participants plus, for a reply, the parent message's sender
    // — same pattern as the pre-existing addComment notification, extended to also cover
    // replies and project conversations. For a task: creator + current individual
    // assignee. For a project: its owner.
    const notifyIds = new Set<string>();
    // Preserves the pre-existing payload key convention every other notification in this
    // codebase uses (`taskTitle` — see AssignmentService/TaskService), which
    // notification-copy.ts's describeNotification reads by name; `projectTitle` is the
    // equivalent for a project-scoped message, added alongside it (not replacing it).
    const titleField: Record<string, string> =
      ctx.kind === "TASK" ? { taskTitle: ctx.task.title } : { projectTitle: ctx.project.name };
    if (ctx.kind === "TASK") {
      notifyIds.add(ctx.task.createdById);
      const current = ctx.task.assignments.find((a) => a.isCurrent);
      if (current?.assigneeType === "USER" && current.assigneeUserId) notifyIds.add(current.assigneeUserId);
    } else {
      notifyIds.add(ctx.project.ownerId);
    }
    if (parent) notifyIds.add(parent.senderId);
    notifyIds.delete(actorId);
    await this.notifications.notifyMany(
      [...notifyIds],
      NotificationType.MESSAGE_ADDED,
      { taskId: ctx.kind === "TASK" ? entityId : undefined, projectId: ctx.kind === "PROJECT" ? entityId : undefined, ...titleField, messageId: created.id, senderId: actorId },
      ctx.kind === "TASK" ? entityId : null
    );

    if (mentionedUserIds.length) {
      await this.notifications.notifyMany(
        mentionedUserIds,
        NotificationType.MENTIONED_IN_TASK,
        { taskId: ctx.kind === "TASK" ? entityId : undefined, projectId: ctx.kind === "PROJECT" ? entityId : undefined, ...titleField, messageId: created.id, mentionedBy: actorId },
        ctx.kind === "TASK" ? entityId : null
      );
    }

    return this.getMessageByIdOrThrow(created.id, actorId);
  }

  async createMessage(actorId: string, taskId: string, input: CreateMessageInput) {
    return this.createMessageInContext(actorId, await this.resolveTaskContext(taskId), input);
  }

  async createMessageForProject(actorId: string, projectId: string, input: CreateMessageInput) {
    return this.createMessageInContext(actorId, await this.resolveProjectContext(projectId), input);
  }

  private async getMessageByIdOrThrow(messageId: string, viewerId: string) {
    const raw = await this.db.taskMessage.findUnique({ where: { id: messageId }, include: MESSAGE_INCLUDE });
    if (!raw) throw new NotFoundError("Message not found");
    return this.formatMessage(raw, viewerId);
  }

  private async loadMessageAndContext(actorId: string, messageId: string) {
    const message = await this.db.taskMessage.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!message) throw new NotFoundError("Message not found");
    const ctx = message.conversation.taskId
      ? await this.resolveTaskContext(message.conversation.taskId)
      : await this.resolveProjectContext(message.conversation.projectId!);
    await this.assertCanAccessContext(actorId, ctx);
    return { message, ctx };
  }

  async editMessage(actorId: string, messageId: string, input: EditMessageInput) {
    const { message, ctx } = await this.loadMessageAndContext(actorId, messageId);
    if (message.senderId !== actorId) throw new ForbiddenError("Only the sender can edit this message");
    if (message.isDeleted) throw new ConflictError("Cannot edit a deleted message");

    await this.db.taskMessage.update({
      where: { id: messageId },
      data: { body: input.body, isEdited: true, editedAt: new Date() },
    });
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorId,
      action: ctx.kind === "TASK" ? "task.message_edited" : "project.message_edited",
      entityType: "TaskMessage",
      entityId: messageId,
      taskId: ctx.kind === "TASK" ? ctx.task.id : undefined,
      projectId: ctx.kind === "PROJECT" ? ctx.project.id : undefined,
    });
    return this.getMessageByIdOrThrow(messageId, actorId);
  }

  async deleteMessage(actorId: string, messageId: string): Promise<void> {
    const { message, ctx } = await this.loadMessageAndContext(actorId, messageId);
    if (message.senderId !== actorId) throw new ForbiddenError("Only the sender can delete this message");
    if (message.isDeleted) return;

    await this.db.taskMessage.update({
      where: { id: messageId },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorId,
      action: ctx.kind === "TASK" ? "task.message_deleted" : "project.message_deleted",
      entityType: "TaskMessage",
      entityId: messageId,
      taskId: ctx.kind === "TASK" ? ctx.task.id : undefined,
      projectId: ctx.kind === "PROJECT" ? ctx.project.id : undefined,
    });
  }

  async addReaction(actorId: string, messageId: string, emoji: string) {
    const { message, ctx } = await this.loadMessageAndContext(actorId, messageId);
    await this.assertCanParticipate(actorId, ctx);
    if (message.isDeleted) throw new ConflictError("Cannot react to a deleted message");

    await this.db.taskMessageReaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId: actorId, emoji } },
      update: {},
      create: { messageId, userId: actorId, emoji },
    });
    return this.getMessageByIdOrThrow(messageId, actorId);
  }

  async removeReaction(actorId: string, messageId: string, emoji: string) {
    await this.loadMessageAndContext(actorId, messageId); // authorization only
    await this.db.taskMessageReaction.deleteMany({ where: { messageId, userId: actorId, emoji } });
    return this.getMessageByIdOrThrow(messageId, actorId);
  }

  private async markReadInContext(actorId: string, ctx: ConversationContext): Promise<void> {
    await this.assertCanAccessContext(actorId, ctx);
    const conversation = await this.getConversationRowOrThrow(ctx);
    await this.db.taskConversationRead.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId: actorId } },
      update: { lastReadAt: new Date() },
      create: { conversationId: conversation.id, userId: actorId, lastReadAt: new Date() },
    });
  }

  async markRead(actorId: string, taskId: string): Promise<void> {
    return this.markReadInContext(actorId, await this.resolveTaskContext(taskId));
  }

  async markReadForProject(actorId: string, projectId: string): Promise<void> {
    return this.markReadInContext(actorId, await this.resolveProjectContext(projectId));
  }
}
