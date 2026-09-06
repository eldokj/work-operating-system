// Per-assignment acknowledgement state machine — docs/architecture/06-assignment-ack-state-machine.md.

import type { AssignmentStatus } from "@ai-task-manager/db";

export type AssignmentTransitionEvent = "ACCEPT" | "DECLINE" | "SUPERSEDE";

const TRANSITIONS: Record<AssignmentStatus, Partial<Record<AssignmentTransitionEvent, AssignmentStatus>>> = {
  // SUPERSEDE from PENDING_ACKNOWLEDGEMENT covers an assignor redirecting a task before
  // the original recipient has responded at all (e.g. reassigning before acceptance).
  PENDING_ACKNOWLEDGEMENT: { ACCEPT: "ACCEPTED", DECLINE: "DECLINED", SUPERSEDE: "SUPERSEDED" },
  ACCEPTED: { SUPERSEDE: "SUPERSEDED" },
  DECLINED: {},
  SUPERSEDED: {},
};

export class InvalidAssignmentTransitionError extends Error {
  constructor(from: AssignmentStatus, event: AssignmentTransitionEvent) {
    super(`Assignment cannot transition via "${event}" from status "${from}"`);
    this.name = "InvalidAssignmentTransitionError";
  }
}

export function canTransitionAssignment(from: AssignmentStatus, event: AssignmentTransitionEvent): boolean {
  return TRANSITIONS[from]?.[event] !== undefined;
}

export function nextAssignmentStatus(from: AssignmentStatus, event: AssignmentTransitionEvent): AssignmentStatus {
  const next = TRANSITIONS[from]?.[event];
  if (!next) throw new InvalidAssignmentTransitionError(from, event);
  return next;
}
