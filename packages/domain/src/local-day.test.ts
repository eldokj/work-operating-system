import { describe, expect, it } from "vitest";
import { localDayBounds, resolveLocalDate, resolveLocalDateString } from "./local-day";

// docs/architecture/19-phase3-daily-work-cycle-architecture-report.md §30 #9 — the single
// most important test in the whole Phase 3 suite: a user-local "day" must not accidentally
// depend on server UTC date.
describe("resolveLocalDateString", () => {
  it("resolves the correct calendar date in a timezone ahead of UTC, near UTC midnight", () => {
    // 2026-03-15 23:30 UTC is already 2026-03-16 05:00 in Asia/Kolkata (UTC+5:30, no DST)
    // — a naive UTC-based "today" would say the 15th; the correct local day is the 16th.
    const instant = new Date("2026-03-15T23:30:00.000Z");
    expect(resolveLocalDateString(instant, "Asia/Kolkata")).toBe("2026-03-16");
  });

  it("resolves the correct calendar date in a timezone behind UTC, near UTC midnight", () => {
    // 2026-03-16T02:00:00Z is still 2026-03-15 in America/Los_Angeles (UTC-7/-8) — a naive
    // UTC-based "today" would say the 16th; the correct local day is the 15th.
    const instant = new Date("2026-03-16T02:00:00.000Z");
    expect(resolveLocalDateString(instant, "America/Los_Angeles")).toBe("2026-03-15");
  });

  it("falls back to UTC for an invalid/corrupted timezone string rather than throwing", () => {
    const instant = new Date("2026-03-15T12:00:00.000Z");
    expect(resolveLocalDateString(instant, "Not/A_Real_Zone")).toBe("2026-03-15");
    expect(resolveLocalDateString(instant, "")).toBe("2026-03-15");
  });

  it("agrees with the plain UTC date for the UTC timezone itself", () => {
    const instant = new Date("2026-06-01T10:00:00.000Z");
    expect(resolveLocalDateString(instant, "UTC")).toBe("2026-06-01");
  });
});

describe("resolveLocalDate", () => {
  it("returns a Date at UTC midnight for the resolved local calendar date", () => {
    const instant = new Date("2026-03-15T23:30:00.000Z");
    const result = resolveLocalDate(instant, "Asia/Kolkata");
    expect(result.toISOString()).toBe("2026-03-16T00:00:00.000Z");
  });
});

describe("localDayBounds", () => {
  it("computes correct UTC start/end instants for a non-UTC, non-DST timezone", () => {
    // Asia/Kolkata is a fixed UTC+5:30 offset year-round (no DST) — local midnight on
    // 2026-03-16 is 2026-03-15T18:30:00.000Z.
    const instant = new Date("2026-03-15T23:30:00.000Z"); // local 2026-03-16 05:00 IST
    const { start, end } = localDayBounds(instant, "Asia/Kolkata");
    expect(start.toISOString()).toBe("2026-03-15T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-03-16T18:29:59.999Z");
    expect(instant.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(instant.getTime()).toBeLessThanOrEqual(end.getTime());
  });

  it("computes a 24-hour span for a DST-observing timezone on a non-transition day", () => {
    const instant = new Date("2026-07-15T16:00:00.000Z"); // mid-July, well clear of any DST edge
    const { start, end } = localDayBounds(instant, "America/New_York");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });
});
