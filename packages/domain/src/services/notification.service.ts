import type { Prisma, PrismaClient } from "@ai-task-manager/db";

// Notification event types — docs/architecture/21 (brief). Kept as string literals
// rather than a DB enum so new event types don't require a migration (doc 03 §notifications:
// "type text").
export const NotificationType = {
  TASK_ASSIGNED: "task.assigned",
  TASK_ASSIGNED_TO_TEAM: "task.assigned_to_team",
  ASSIGNMENT_ACCEPTED: "assignment.accepted",
  ASSIGNMENT_DECLINED: "assignment.declined",
  TASK_REASSIGNED: "task.reassigned",
  COMMENT_ADDED: "comment.added",
  DEADLINE_APPROACHING: "deadline.approaching",
  TASK_OVERDUE: "task.overdue",
  REVIEW_REQUESTED: "review.requested",
  // REVIEW_COMPLETED intentionally removed — Phase 6, doc 24 §4.2/§13. The review flow is
  // a two-party exchange (submit → notifies the reviewer via REVIEW_REQUESTED; decision →
  // notifies the assignee via TASK_COMPLETED/CHANGES_REQUESTED below) with no third party
  // in the current authorization model to receive a distinct "review completed" signal —
  // wiring it up would mean inventing a recipient rather than fixing a real gap.
  CHANGES_REQUESTED: "changes.requested",
  TASK_COMPLETED: "task.completed",
  // Phase 2A additions — docs/architecture/15-task-conversation.md.
  MESSAGE_ADDED: "message.added",
  MENTIONED_IN_TASK: "task.mentioned",
  // Phase 7 additions — docs/architecture/26-phase7-calendar-meeting-architecture-report.md
  // §15. Deliberately only these two: event-changed/participant-added are named there as
  // explicitly deferred (COULD HAVE), not built now.
  MEETING_STARTING_SOON: "meeting.starting_soon",
  CALENDAR_EVENT_CANCELLED: "calendar_event.cancelled",
} as const;
export type NotificationTypeValue = (typeof NotificationType)[keyof typeof NotificationType];

/**
 * In-app notifications — docs/architecture/21 (brief). Push/email delivery channels are
 * a named extension point (doc 02 §2.2) not wired up in Phase 1; every notification is
 * created as IN_APP.
 */
export class NotificationService {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}

  async notify(
    userId: string,
    type: NotificationTypeValue,
    payload: Record<string, unknown>,
    relatedTaskId?: string | null
  ) {
    return this.db.notification.create({
      data: {
        userId,
        type,
        payload: payload as Prisma.InputJsonValue,
        relatedTaskId: relatedTaskId ?? null,
      },
    });
  }

  async notifyMany(
    userIds: string[],
    type: NotificationTypeValue,
    payload: Record<string, unknown>,
    relatedTaskId?: string | null
  ) {
    if (userIds.length === 0) return;
    await this.db.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type,
        payload: payload as Prisma.InputJsonValue,
        relatedTaskId: relatedTaskId ?? null,
      })),
    });
  }

  async listForUser(userId: string, opts: { unreadOnly?: boolean; limit?: number; cursor?: string } = {}) {
    const limit = opts.limit ?? 30;
    const rows = await this.db.notification.findMany({
      where: { userId, ...(opts.unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
  }

  async markRead(id: string, userId: string) {
    await this.db.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
  }

  async markAllRead(userId: string) {
    await this.db.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  }
}
