// User-local calendar day resolution — docs/architecture/19-phase3-daily-work-cycle-
// architecture-report.md §12/§31. Uses the platform's built-in Intl.DateTimeFormat rather
// than a timezone library dependency: Node's ICU data already knows every IANA zone's
// offset (including DST) for any given instant, which is all this needs.
//
// This is the fix for a real, pre-existing bug: ReportingService's bucketByDueDate
// computed "today" from the server's own clock (`new Date()`), not the user's local
// calendar day (doc 19 §2/§31) — reused there too, not just for Workday.workDate, so the
// two features can never disagree about what "today" means for a given user.

const FALLBACK_TIMEZONE = "UTC";

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Resolves the calendar date (YYYY-MM-DD, no time component) `instant` falls on in
 * `timezone`. Falls back to UTC for a missing/invalid/corrupted timezone string rather
 * than throwing — a bad `User.defaultTimezone` value must never crash a request. */
export function resolveLocalDateString(instant: Date, timezone: string): string {
  const tz = timezone && isValidTimeZone(timezone) ? timezone : FALLBACK_TIMEZONE;
  // en-CA formats as YYYY-MM-DD, exactly the shape needed — no manual part-reassembly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Same as resolveLocalDateString, as a Date at UTC midnight for that calendar date — the
 * shape Prisma's `@db.Date` columns (e.g. Workday.workDate) expect. */
export function resolveLocalDate(instant: Date, timezone: string): Date {
  return new Date(`${resolveLocalDateString(instant, timezone)}T00:00:00.000Z`);
}

/** The timezone's UTC offset, in minutes, AT `instant` (so DST is correctly reflected for
 * that specific moment) — positive when local time is ahead of UTC. */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUTC - instant.getTime()) / 60_000;
}

/**
 * The UTC start/end instants of the user-local calendar day `instant` falls in, for
 * `timezone`. Replaces any server-clock-based `startOfDay`/`endOfDay` computation.
 *
 * Known limitation, accepted rather than solved with a full timezone library (matching
 * doc 19's "minimum correct model" principle): the offset used is the one in effect AT
 * `instant`, not re-evaluated at the computed local midnight — on the rare calendar day
 * where a DST transition happens between `instant`'s local time and that same day's local
 * midnight, the boundary can be off by the transition's delta (typically 1 hour). This
 * does not affect `resolveLocalDateString`/`resolveLocalDate` (which only need the
 * calendar date, not a precise instant) — only this function's exact start/end instants.
 */
export function localDayBounds(instant: Date, timezone: string): { start: Date; end: Date } {
  const tz = timezone && isValidTimeZone(timezone) ? timezone : FALLBACK_TIMEZONE;
  const dateStr = resolveLocalDateString(instant, tz);
  const offsetMinutes = offsetMinutesAt(instant, tz);
  const startUTC = new Date(`${dateStr}T00:00:00.000Z`).getTime() - offsetMinutes * 60_000;
  return { start: new Date(startUTC), end: new Date(startUTC + 24 * 60 * 60 * 1000 - 1) };
}
