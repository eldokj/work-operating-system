// Phase 6 — docs/architecture/24-phase6-notifications-scheduler-architecture-report.md
// §7/§11. Next.js's own documented "run code once when the server process starts" hook
// (stable since Next 14, no experimental flag needed at 15.5.25 — see next.config.js).
// This is the entire live-deployment execution model for the scheduler: no custom server,
// no separate worker process, no external queue — a single setInterval in the same
// process apps/web already runs in, matching the confirmed single-process deployment
// reality (doc §11's condition for why this minimal design is correct today).
//
// Deliberately does NOT import "@/lib/db" or the "@ai-task-manager/domain" package
// barrel anywhere in this file (not even a genuinely separate file dynamically imported
// from it — both were tried and both fail the same way): webpack statically bundles
// every import()/require() target reachable from this entry, against a target that,
// specifically for `next dev`'s instrumentation bundle, does not resolve "node:"-scheme
// OR bare Node builtin specifiers (fs/path/crypto) at all — confirmed empirically, not
// merely suspected. Importing "@/lib/db" or the domain barrel pulls those in transitively
// (AuthService/bcryptjs -> node:crypto; lib/db.ts's own Windows Prisma-engine-path fix ->
// fs/path) and 500s every route in dev mode. Confirmed unrelated to this feature's own
// correctness: `next build`/`next start` compile and run the equivalent code correctly
// (verified repeatedly during Phase 6/7's own build+E2E gates) — this is a `next
// dev`-only limitation, worked around here rather than "fixed" upstream.
export async function register() {
  // The Edge runtime also calls register() and would otherwise start a second, redundant
  // timer alongside the Node.js one — this guard is the documented way to run
  // Node-only setup exactly once per server process.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Scheduler module only, not the "@ai-task-manager/domain" barrel — its own import
  // graph (NotificationService) has no Node builtin usage, so this alone is safe.
  const { runScheduledChecks, SCHEDULER_TICK_INTERVAL_MS } = await import("@ai-task-manager/domain/src/services/scheduler.service");
  // "@ai-task-manager/db" package's own entry (not "@/lib/db") — it only re-exports
  // @prisma/client's surface with no extra top-level code of its own (see packages/db/
  // src/index.ts), so, unlike lib/db.ts, it has no Node builtin usage to pull in either.
  const { PrismaClient } = await import("@ai-task-manager/db");

  // A small, dedicated connection for the scheduler's own periodic queries — deliberately
  // separate from the API routes' shared "@/lib/db" client (a second small pool, not a
  // correctness concern for a documented single-instance deployment, doc 24 §11) rather
  // than reaching into that module's internals, which is exactly what this file must
  // avoid. Cached on its own global key so `next dev`'s hot-reload doesn't spin up a
  // fresh pool on every file save, mirroring lib/db.ts's own reasoning for the identical
  // pattern. On Windows, this client relies on PRISMA_QUERY_ENGINE_LIBRARY already being
  // set (via .env.local, gitignored, per-developer-machine — the same variable lib/db.ts
  // itself sets programmatically for the API routes' own client) rather than computing it
  // here, since doing that computation needs fs/path, which (per the note above) this
  // specific bundle cannot resolve at all, in any form.
  const globalForScheduler = globalThis as typeof globalThis & { __schedulerPrisma?: InstanceType<typeof PrismaClient> };
  const db =
    globalForScheduler.__schedulerPrisma ??
    new PrismaClient({ datasources: { db: { url: process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL } } });
  if (process.env.NODE_ENV !== "production") globalForScheduler.__schedulerPrisma = db;

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
