// Task lifecycle state machine — docs/architecture/05-task-state-machine.md.
// Pure, DB-free, unit-testable in isolation (doc 11 §11.1).

import type { TaskStatus } from "@ai-task-manager/db";

export type TaskTransitionEvent =
  | "CONFIRM_DRAFT"
  | "DISCARD"
  | "ASSIGN"
  | "ASSIGNMENT_ACCEPTED"
  | "ASSIGNMENT_DECLINED"
  | "REASSIGNED"
  | "SUBMIT"
  | "REVIEW_APPROVED"
  | "REVIEW_CHANGES_REQUESTED"
  | "RESUME"
  | "CANCEL";

const TRANSITIONS: Record<TaskStatus, Partial<Record<TaskTransitionEvent, TaskStatus>>> = {
  DRAFT: { CONFIRM_DRAFT: "UNASSIGNED", DISCARD: "CANCELLED" },
  UNASSIGNED: { ASSIGN: "ASSIGNED", CANCEL: "CANCELLED" },
  ASSIGNED: {
    ASSIGNMENT_ACCEPTED: "IN_PROGRESS",
    ASSIGNMENT_DECLINED: "UNASSIGNED",
    CANCEL: "CANCELLED",
  },
  IN_PROGRESS: {
    REASSIGNED: "ASSIGNED",
    SUBMIT: "SUBMITTED",
    CANCEL: "CANCELLED",
  },
  SUBMITTED: {
    // Submission and review-open are treated as the same instant for Phase 1 (doc 05).
    REVIEW_APPROVED: "COMPLETED",
    REVIEW_CHANGES_REQUESTED: "CHANGES_REQUESTED",
  },
  UNDER_REVIEW: {
    REVIEW_APPROVED: "COMPLETED",
    REVIEW_CHANGES_REQUESTED: "CHANGES_REQUESTED",
  },
  CHANGES_REQUESTED: {
    RESUME: "IN_PROGRESS",
  },
  COMPLETED: {},
  CANCELLED: {},
};

export class InvalidTaskTransitionError extends Error {
  constructor(from: TaskStatus, event: TaskTransitionEvent) {
    super(`Task cannot transition via "${event}" from status "${from}"`);
    this.name = "InvalidTaskTransitionError";
  }
}

export function canTransitionTask(from: TaskStatus, event: TaskTransitionEvent): boolean {
  return TRANSITIONS[from]?.[event] !== undefined;
}

export function nextTaskStatus(from: TaskStatus, event: TaskTransitionEvent): TaskStatus {
  const next = TRANSITIONS[from]?.[event];
  if (!next) throw new InvalidTaskTransitionError(from, event);
  return next;
}

/**
 * OVERDUE is intentionally NOT a stored status (doc 05 §5.1) — it's derived for display.
 */
export function isOverdue(status: TaskStatus, dueDate: Date | null, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  if (status === "COMPLETED" || status === "CANCELLED") return false;
  return dueDate.getTime() < now.getTime();
}

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ["COMPLETED", "CANCELLED"];
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}
