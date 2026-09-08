// Daily plan item status state machine — docs/architecture/19-phase3-daily-work-cycle-
// architecture-report.md §22. Pure, DB-free, unit-testable in isolation, mirroring
// task-status.machine.ts's exact style. Deliberately independent of TaskStatus (doc 19
// §10) — this describes only where a task sits in one day's plan, never the task's own
// lifecycle.

import type { DailyPlanItemStatus } from "@ai-task-manager/db";

export type DailyPlanItemTransitionEvent =
  | "START" // begin work — PLANNED -> IN_PROGRESS
  | "COMPLETE" // mark done for today — PLANNED/IN_PROGRESS -> COMPLETED_TODAY
  | "CARRY_FORWARD" // Close disposition -> CARRIED_FORWARD
  | "MOVE_TO_BACKLOG" // Close disposition -> MOVED_TO_BACKLOG
  | "DROP"; // Close disposition -> DROPPED_FOR_TODAY

const TRANSITIONS: Record<DailyPlanItemStatus, Partial<Record<DailyPlanItemTransitionEvent, DailyPlanItemStatus>>> = {
  PLANNED: {
    START: "IN_PROGRESS",
    COMPLETE: "COMPLETED_TODAY",
    CARRY_FORWARD: "CARRIED_FORWARD",
    MOVE_TO_BACKLOG: "MOVED_TO_BACKLOG",
    DROP: "DROPPED_FOR_TODAY",
  },
  IN_PROGRESS: {
    COMPLETE: "COMPLETED_TODAY",
    CARRY_FORWARD: "CARRIED_FORWARD",
    MOVE_TO_BACKLOG: "MOVED_TO_BACKLOG",
    DROP: "DROPPED_FOR_TODAY",
  },
  COMPLETED_TODAY: {},
  CARRIED_FORWARD: {},
  MOVED_TO_BACKLOG: {},
  DROPPED_FOR_TODAY: {},
};

export class InvalidDailyPlanItemTransitionError extends Error {
  constructor(from: DailyPlanItemStatus, event: DailyPlanItemTransitionEvent) {
    super(`Daily plan item cannot transition via "${event}" from status "${from}"`);
    this.name = "InvalidDailyPlanItemTransitionError";
  }
}

export function canTransitionDailyPlanItem(from: DailyPlanItemStatus, event: DailyPlanItemTransitionEvent): boolean {
  return TRANSITIONS[from]?.[event] !== undefined;
}

export function nextDailyPlanItemStatus(from: DailyPlanItemStatus, event: DailyPlanItemTransitionEvent): DailyPlanItemStatus {
  const next = TRANSITIONS[from]?.[event];
  if (!next) throw new InvalidDailyPlanItemTransitionError(from, event);
  return next;
}

/** doc 19 §8: only PLANNED/IN_PROGRESS ever require an explicit Close disposition — every
 * other status is already a resolved, terminal fact about the day. */
const TERMINAL_STATUSES: readonly DailyPlanItemStatus[] = [
  "COMPLETED_TODAY",
  "CARRIED_FORWARD",
  "MOVED_TO_BACKLOG",
  "DROPPED_FOR_TODAY",
];
export function isTerminalDailyPlanItemStatus(status: DailyPlanItemStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** doc 19 §20: un-planning (DELETE) is only permitted while PLANNED and untouched —
 * once execution has begun (or the item has moved on), removal must go through an
 * explicit, auditable status transition instead of disappearing outright. */
export function canDeleteDailyPlanItem(status: DailyPlanItemStatus, startedAt: Date | null): boolean {
  return status === "PLANNED" && startedAt === null;
}

const CLOSE_DISPOSITION_EVENTS: readonly DailyPlanItemTransitionEvent[] = ["CARRY_FORWARD", "MOVE_TO_BACKLOG", "DROP"];
export function isCloseDispositionEvent(event: DailyPlanItemTransitionEvent): boolean {
  return CLOSE_DISPOSITION_EVENTS.includes(event);
}
