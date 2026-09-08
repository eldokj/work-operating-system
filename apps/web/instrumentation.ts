// Phase 6 — docs/architecture/24-phase6-notifications-scheduler-architecture-report.md
// §7/§11. Next.js's own documented "run code once when the server process starts" hook
// (stable since Next 14, no experimental flag needed at 15.5.25 — see next.config.js).
// This is the entire live-deployment execution model for the scheduler: no custom server,
// no separate worker process, no external queue — a single setInterval in the same
// process apps/web already runs in, matching the confirmed single-process deployment
// reality (doc §11's condition for why this minimal design is correct today).
export async function register() {
  // The Edge runtime also calls register() and would otherwise start a second, redundant
  // timer alongside the Node.js one — this guard is the documented way to run
  // Node-only setup exactly once per server process.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { db } = await import("@/lib/db");
  const { runScheduledChecks, SCHEDULER_TICK_INTERVAL_MS } = await import("@ai-task-manager/domain");

  const tick = () => {
    runScheduledChecks(db, new Date())
      .then(({ deadlineApproaching, overdue, meetingStartingSoon }) => {
        // doc §12 SHOULD HAVE — minimal observability, not a full logging/metrics stack.
        if (deadlineApproaching > 0 || overdue > 0 || meetingStartingSoon > 0) {
          console.log(
            `[scheduler] tick: deadlineApproaching=${deadlineApproaching} overdue=${overdue} meetingStartingSoon=${meetingStartingSoon}`
          );
        }
      })
      .catch((err) => {
        // A failed tick must never crash the server process — the next tick simply tries
        // again 15 minutes later against the same still-unclaimed candidates.
        console.error("[scheduler] tick failed:", err);
      });
  };

  setInterval(tick, SCHEDULER_TICK_INTERVAL_MS);
}
