import { describe, expect, it } from "vitest";
import {
  canTransitionAssignment,
  nextAssignmentStatus,
  InvalidAssignmentTransitionError,
} from "./assignment-status.machine";

describe("assignment status machine", () => {
  it("accepts from pending", () => {
    expect(nextAssignmentStatus("PENDING_ACKNOWLEDGEMENT", "ACCEPT")).toBe("ACCEPTED");
  });

  it("declines from pending", () => {
    expect(nextAssignmentStatus("PENDING_ACKNOWLEDGEMENT", "DECLINE")).toBe("DECLINED");
  });

  it("supersedes an accepted assignment (internal distribution / reassignment)", () => {
    expect(nextAssignmentStatus("ACCEPTED", "SUPERSEDE")).toBe("SUPERSEDED");
  });

  it("supersedes a still-pending assignment (redirect before the recipient responds)", () => {
    expect(nextAssignmentStatus("PENDING_ACKNOWLEDGEMENT", "SUPERSEDE")).toBe("SUPERSEDED");
  });

  it("treats declined/superseded as terminal", () => {
    expect(canTransitionAssignment("DECLINED", "ACCEPT")).toBe(false);
    expect(canTransitionAssignment("SUPERSEDED", "ACCEPT")).toBe(false);
  });

  it("rejects accepting an already-accepted row", () => {
    expect(() => nextAssignmentStatus("ACCEPTED", "ACCEPT")).toThrow(
      InvalidAssignmentTransitionError
    );
  });
});
