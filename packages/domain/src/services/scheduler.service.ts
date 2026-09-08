import type { PrismaClient } from "@ai-task-manager/db";
import { NotificationService, NotificationType } from "./notification.service";

/**
 * Phase 6 — docs/architecture/24-phase6-notifications-scheduler-architecture-report.md
 * §5-§11. The system's only scheduled/background execution: one plain, directly-callable
 * "tick" function serving exactly two checks (deadline-approaching, overdue). Deliberately
 * not a job-definition DSL, a persistent job-queue table, or anything with retries/backoff
 * — the doc's explicit conclusion is that neither is justified by the current, confirmed
 * single-process deployment reality, and the conditional-write idempotency design below
 * (§8) stays correct without modification even if that ever changes (§11).
 *
 * Invocation: live, via apps/web/instrumentation.ts's setInterval wrapper; in tests,
 * called directly with an injected `now` — no timer involved either way, mirroring
 * local-day.ts's own testability discipline.
 */

// doc 24 §5 — a single, deliberately unconfigurable-for-v1 constant. Revisit only if a
// real product need for per-org/per-user tuning appears (doc 24 §12 COULD HAVE).
export const DEADLINE_APPROACHING_WINDOW_MS = 24 * 60 * 60 * 1000;

// doc 24 §7 — the proposed live tick frequency. Exported so apps/web/instrumentation.ts
// and this module's own tests share one source of truth rather than two copies of "15".
export const SCHEDULER_TICK_INTERVAL_MS = 15 * 60 * 1000;

const NON_TERMINAL_TASK_STATUSES = ["DRAFT", "UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED"] as const;

export interface SchedulerTickResult {
  deadlineApproaching: number;
  overdue: number;
}

/**
 * One scheduler tick. Idempotent and safe under concurrent execution (doc §8): each
 * candidate is claimed via a conditional `updateMany` (`...WHERE ...NotifiedAt IS NULL`)
 * before its notification is sent, so a task claimed by one call is invisible to a
 * concurrent one — at-most-once delivery per task per condition, no lock/queue needed.
 */
export async function runScheduledChecks(db: PrismaClient, now: Date = new Date()): Promise<SchedulerTickResult> {
  const notifications = new NotificationService(db);
  const [deadlineApproaching, overdue] = await Promise.all([
    tickDeadlineApproaching(db, notifications, now),
    tickOverdue(db, notifications, now),
  ]);
  return { deadlineApproaching, overdue };
}

/**
 * doc 24 §5: a task is "approaching" if it has a future dueDate within the lookahead
 * window, is not terminal, and has not already been notified. Recipient: the current
 * *accepted* individual assignee only — the same "current accountable owner" rule doc 21
 * §7 established and this codebase uses everywhere (PENDING_ACKNOWLEDGEMENT is explicitly
 * not yet workload, doc 21 §6) — a team-assigned-but-undistributed task has no such
 * individual and is correctly skipped, matching how team signals are handled elsewhere.
 */
async function tickDeadlineApproaching(db: PrismaClient, notifications: NotificationService, now: Date): Promise<number> {
  const approachingBy = new Date(now.getTime() + DEADLINE_APPROACHING_WINDOW_MS);

  const candidates = await db.task.findMany({
    where: {
      dueDate: { gt: now, lte: approachingBy },
      status: { in: [...NON_TERMINAL_TASK_STATUSES] },
      deadlineApproachingNotifiedAt: null,
      assignments: { some: { isCurrent: true, status: "ACCEPTED", assigneeType: "USER" } },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignments: { where: { isCurrent: true, status: "ACCEPTED", assigneeType: "USER" }, select: { assigneeUserId: true } },
    },
  });

  let sent = 0;
  for (const task of candidates) {
    const assigneeId = task.assignments[0]?.assigneeUserId;
    if (!assigneeId) continue;

    const claimed = await db.task.updateMany({
      where: { id: task.id, deadlineApproachingNotifiedAt: null },
      data: { deadlineApproachingNotifiedAt: now },
    });
    if (claimed.count === 0) continue; // a concurrent tick already claimed this task

    await notifications.notify(
      assigneeId,
      NotificationType.DEADLINE_APPROACHING,
      { taskId: task.id, taskTitle: task.title, dueDate: task.dueDate },
      task.id
    );
    sent++;
  }
  return sent;
}

/** doc 24 §6 — reuses `isOverdue`'s exact definition (dueDate < now, non-terminal) via the
 * same filter shape, applied at the query level rather than calling the function
 * per-candidate (the query IS the definition here — no divergence risk). Same
 * recipient/idempotency rules as the approaching check. */
async function tickOverdue(db: PrismaClient, notifications: NotificationService, now: Date): Promise<number> {
  const candidates = await db.task.findMany({
    where: {
      dueDate: { lt: now },
      status: { in: [...NON_TERMINAL_TASK_STATUSES] },
      overdueNotifiedAt: null,
      assignments: { some: { isCurrent: true, status: "ACCEPTED", assigneeType: "USER" } },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignments: { where: { isCurrent: true, status: "ACCEPTED", assigneeType: "USER" }, select: { assigneeUserId: true } },
    },
  });

  let sent = 0;
  for (const task of candidates) {
    const assigneeId = task.assignments[0]?.assigneeUserId;
    if (!assigneeId) continue;

    const claimed = await db.task.updateMany({
      where: { id: task.id, overdueNotifiedAt: null },
      data: { overdueNotifiedAt: now },
    });
    if (claimed.count === 0) continue;

    await notifications.notify(assigneeId, NotificationType.TASK_OVERDUE, { taskId: task.id, taskTitle: task.title, dueDate: task.dueDate }, task.id);
    sent++;
  }
  return sent;
}
