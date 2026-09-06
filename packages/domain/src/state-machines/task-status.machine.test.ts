import { describe, expect, it } from "vitest";
import {
  canTransitionTask,
  nextTaskStatus,
  isOverdue,
  InvalidTaskTransitionError,
} from "./task-status.machine";

describe("task status machine", () => {
  it("allows the full happy-path chain from the ABC College scenario", () => {
    expect(nextTaskStatus("UNASSIGNED", "ASSIGN")).toBe("ASSIGNED");
    expect(nextTaskStatus("ASSIGNED", "ASSIGNMENT_ACCEPTED")).toBe("IN_PROGRESS");
    expect(nextTaskStatus("IN_PROGRESS", "SUBMIT")).toBe("SUBMITTED");
    expect(nextTaskStatus("SUBMITTED", "REVIEW_APPROVED")).toBe("COMPLETED");
  });

  it("returns to UNASSIGNED on decline", () => {
    expect(nextTaskStatus("ASSIGNED", "ASSIGNMENT_DECLINED")).toBe("UNASSIGNED");
  });

  it("supports changes-requested -> resume -> submit -> approve loop", () => {
    expect(nextTaskStatus("SUBMITTED", "REVIEW_CHANGES_REQUESTED")).toBe("CHANGES_REQUESTED");
    expect(nextTaskStatus("CHANGES_REQUESTED", "RESUME")).toBe("IN_PROGRESS");
  });

  it("rejects illegal transitions", () => {
    expect(canTransitionTask("COMPLETED", "CANCEL")).toBe(false);
    expect(canTransitionTask("UNASSIGNED", "SUBMIT")).toBe(false);
    expect(() => nextTaskStatus("COMPLETED", "SUBMIT")).toThrow(InvalidTaskTransitionError);
  });

  it("computes overdue as a derived flag, never a stored terminal status", () => {
    const past = new Date(Date.now() - 1000 * 60 * 60);
    const future = new Date(Date.now() + 1000 * 60 * 60);
    expect(isOverdue("IN_PROGRESS", past)).toBe(true);
    expect(isOverdue("IN_PROGRESS", future)).toBe(false);
    expect(isOverdue("COMPLETED", past)).toBe(false); // terminal statuses are never overdue
    expect(isOverdue("IN_PROGRESS", null)).toBe(false);
  });
});
