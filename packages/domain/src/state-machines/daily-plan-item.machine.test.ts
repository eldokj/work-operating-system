import { describe, expect, it } from "vitest";
import {
  canDeleteDailyPlanItem,
  canTransitionDailyPlanItem,
  InvalidDailyPlanItemTransitionError,
  isTerminalDailyPlanItemStatus,
  nextDailyPlanItemStatus,
} from "./daily-plan-item.machine";

describe("daily-plan-item state machine", () => {
  it("PLANNED can Start, Complete, or receive any Close disposition", () => {
    expect(nextDailyPlanItemStatus("PLANNED", "START")).toBe("IN_PROGRESS");
    expect(nextDailyPlanItemStatus("PLANNED", "COMPLETE")).toBe("COMPLETED_TODAY");
    expect(nextDailyPlanItemStatus("PLANNED", "CARRY_FORWARD")).toBe("CARRIED_FORWARD");
    expect(nextDailyPlanItemStatus("PLANNED", "MOVE_TO_BACKLOG")).toBe("MOVED_TO_BACKLOG");
    expect(nextDailyPlanItemStatus("PLANNED", "DROP")).toBe("DROPPED_FOR_TODAY");
  });

  it("IN_PROGRESS cannot Start again, but can Complete or receive a Close disposition", () => {
    expect(canTransitionDailyPlanItem("IN_PROGRESS", "START")).toBe(false);
    expect(nextDailyPlanItemStatus("IN_PROGRESS", "COMPLETE")).toBe("COMPLETED_TODAY");
    expect(nextDailyPlanItemStatus("IN_PROGRESS", "CARRY_FORWARD")).toBe("CARRIED_FORWARD");
  });

  it("terminal statuses accept no further transitions", () => {
    for (const status of ["COMPLETED_TODAY", "CARRIED_FORWARD", "MOVED_TO_BACKLOG", "DROPPED_FOR_TODAY"] as const) {
      expect(canTransitionDailyPlanItem(status, "START")).toBe(false);
      expect(canTransitionDailyPlanItem(status, "COMPLETE")).toBe(false);
      expect(canTransitionDailyPlanItem(status, "CARRY_FORWARD")).toBe(false);
      expect(isTerminalDailyPlanItemStatus(status)).toBe(true);
    }
  });

  it("PLANNED/IN_PROGRESS are not terminal", () => {
    expect(isTerminalDailyPlanItemStatus("PLANNED")).toBe(false);
    expect(isTerminalDailyPlanItemStatus("IN_PROGRESS")).toBe(false);
  });

  it("an invalid transition throws a typed error", () => {
    expect(() => nextDailyPlanItemStatus("COMPLETED_TODAY", "START")).toThrow(InvalidDailyPlanItemTransitionError);
  });

  describe("canDeleteDailyPlanItem", () => {
    it("allows deletion while PLANNED and never started", () => {
      expect(canDeleteDailyPlanItem("PLANNED", null)).toBe(true);
    });
    it("forbids deletion once started, even if still PLANNED-shaped in status", () => {
      expect(canDeleteDailyPlanItem("PLANNED", new Date())).toBe(false);
    });
    it("forbids deletion once IN_PROGRESS", () => {
      expect(canDeleteDailyPlanItem("IN_PROGRESS", new Date())).toBe(false);
    });
    it("forbids deletion of any terminal status", () => {
      expect(canDeleteDailyPlanItem("COMPLETED_TODAY", null)).toBe(false);
    });
  });
});
