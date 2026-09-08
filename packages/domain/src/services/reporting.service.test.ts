import { describe, expect, it } from "vitest";
import { isStuckAcknowledgement, summarizeAttention } from "./reporting.service";

// docs/architecture/21-phase4-management-visibility-architecture-report.md §6/§20 — pure
// metric-definition tests, independent of Prisma/the database, matching the style of
// resolve-scope.test.ts and daily-plan-item.machine.test.ts.

function assignment(overrides: Partial<{ isCurrent: boolean; status: string; createdAt: Date }> = {}) {
  return {
    isCurrent: true,
    status: "PENDING_ACKNOWLEDGEMENT",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("isStuckAcknowledgement", () => {
  const THRESHOLD_MS = 24 * 60 * 60 * 1000;
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("is false when the current assignment is not PENDING_ACKNOWLEDGEMENT", () => {
    const task = { assignments: [assignment({ status: "ACCEPTED", createdAt: new Date("2026-06-01T00:00:00.000Z") })] };
    expect(isStuckAcknowledgement(task as never, now, THRESHOLD_MS)).toBe(false);
  });

  it("is false when there is no current assignment at all", () => {
    const task = { assignments: [assignment({ isCurrent: false })] };
    expect(isStuckAcknowledgement(task as never, now, THRESHOLD_MS)).toBe(false);
  });

  it("is false when PENDING_ACKNOWLEDGEMENT but younger than the threshold", () => {
    const task = { assignments: [assignment({ createdAt: new Date(now.getTime() - THRESHOLD_MS + 60_000) })] };
    expect(isStuckAcknowledgement(task as never, now, THRESHOLD_MS)).toBe(false);
  });

  it("is true when PENDING_ACKNOWLEDGEMENT and older than the threshold", () => {
    const task = { assignments: [assignment({ createdAt: new Date(now.getTime() - THRESHOLD_MS - 60_000) })] };
    expect(isStuckAcknowledgement(task as never, now, THRESHOLD_MS)).toBe(true);
  });

  it("only considers the current assignment, never a superseded historical one", () => {
    const task = {
      assignments: [
        assignment({ isCurrent: false, status: "PENDING_ACKNOWLEDGEMENT", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
        assignment({ isCurrent: true, status: "ACCEPTED", createdAt: now }),
      ],
    };
    expect(isStuckAcknowledgement(task as never, now, THRESHOLD_MS)).toBe(false);
  });

  it("respects a custom threshold", () => {
    const task = { assignments: [assignment({ createdAt: new Date(now.getTime() - 60_000) })] };
    expect(isStuckAcknowledgement(task as never, now, 30_000)).toBe(true);
  });
});

describe("summarizeAttention", () => {
  it("sums signals into one AttentionRequiredSummary", () => {
    const signals = [
      { userId: "a", workdayStatus: "OPEN" as const, capacityMinutes: 480, plannedMinutes: 500, overCapacity: true, totalItemCount: 3, unplannedItemCount: 1, carryForwardRepeatCount: 2 },
      { userId: "b", workdayStatus: "NOT_STARTED" as const, capacityMinutes: 480, plannedMinutes: 0, overCapacity: false, totalItemCount: 0, unplannedItemCount: 0, carryForwardRepeatCount: 0 },
      { userId: "c", workdayStatus: "CLOSED" as const, capacityMinutes: 480, plannedMinutes: 600, overCapacity: true, totalItemCount: 5, unplannedItemCount: 2, carryForwardRepeatCount: 1 },
    ];
    expect(summarizeAttention(4, signals)).toEqual({
      stuckAcknowledgementCount: 4,
      overCapacityCount: 2,
      carryForwardRepeatCount: 3,
      unplannedCount: 3,
    });
  });

  it("handles an empty signal set", () => {
    expect(summarizeAttention(0, [])).toEqual({
      stuckAcknowledgementCount: 0,
      overCapacityCount: 0,
      carryForwardRepeatCount: 0,
      unplannedCount: 0,
    });
  });
});
