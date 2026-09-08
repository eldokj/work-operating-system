# Phase 6 Notification Completion & Minimal Scheduler Architecture

**Base commit:** `9860875` (branch `master`, `origin/master` synchronized). **Status:**
architecture only — no code, schema, migration, API, UI, or test exists yet for anything
in this document. Follows the same process as docs 17/19/21: investigation → proposal →
explicit approval required before any implementation. Builds directly on the approved
scope in [doc 23](23-phase6-product-capability-and-roadmap-assessment.md) §17/§28.

---

## 1. Executive Summary

Doc 23 established that the system is entirely pull-based and recommended closing the
Awareness gap with two pieces built together: (a) fixing dead `NotificationType` values in
the existing, already-correct `NotificationService`, and (b) a minimal in-process scheduler
for time-based checks. This report designs both precisely, and the fresh inspection done
for this report **narrows the scope further than doc 23 assumed**, in two concrete ways:

1. **The Notification Center UI needs zero changes.** `apps/web/app/(app)/notifications/page.tsx`
   already renders the full list with read/unread state and mark-all-read, and
   `apps/web/lib/notification-copy.ts` **already has display copy for all 14
   `NotificationType` values, including all 4 currently-dead ones.** The UI was built
   ahead of the backend triggers that would feed it. This closes doc 23's Open Question #2
   outright — no UI work is in scope.
2. **`TASK_REASSIGNED` was misdiagnosed in doc 23.** Doc 23 pointed at `reassignInternal`
   (team → individual distribution) as the fix site. Direct inspection this session shows
   `reassignInternal` is a **first assignment from that individual's perspective** — the
   task is moving from team-level acceptance to a specific person who has never held it —
   so `TASK_ASSIGNED` there is already correct and should not change. The real "task was
   reassigned" case lives in `AssignmentService.assign()` (the shared entry point for both
   first assignment and mid-flight reassignment, doc 06 §6.3), which **already computes
   the exact signal needed** — `previousCurrent` (line 108) and the state-machine `event`
   variable (line 91, `"REASSIGNED"` vs `"ASSIGN"`, derived from `task-status.machine.ts`)
   — to distinguish the two cases, at zero additional query cost.

A third finding changes doc 23's recommendation outright: **`REVIEW_COMPLETED` should be
removed, not wired up.** The review flow is a clean two-party loop — `submitTask` notifies
the reviewer (`REVIEW_REQUESTED`), `reviewTask`'s decision notifies the assignee
(`TASK_COMPLETED`/`CHANGES_REQUESTED`) — and no third party exists in the current
authorization model for a `REVIEW_COMPLETED` event to inform. Keeping a permanently-dead
enum value is worse than removing it (doc 23's own "do not rebuild/keep something that
doesn't earn its place" discipline applies to cleanup, not just new features).

**Net effect: this phase's Notification-side work is smaller than doc 23 estimated** — one
targeted branch in `assign()`, one enum-cleanup removal, zero UI changes. The
scheduler remains the phase's real engineering surface, designed in §7-§11 below.

---

## 2. Current State (Verified This Session)

**Backend — `packages/domain/src/services/notification.service.ts`** (86 lines, unchanged
since Phase 1/2A): `NotificationType` (14 string-literal values), `NotificationService`
class (`notify`, `notifyMany`, `listForUser` with cursor pagination, `markRead`,
`markAllRead`). `Notification` model (`packages/db/prisma/schema.prisma:715-730`):
`userId`, `type` (plain `String`, not a DB enum — `NotificationType` is TypeScript-only),
`payload` (`Json`), `relatedTaskId`, `isRead`, `deliveryChannel` (DB enum
`DeliveryChannel { IN_APP, PUSH, EMAIL }` — `PUSH`/`EMAIL` declared, never set;
`notify`/`notifyMany` never accept a channel argument, always default to `IN_APP`),
`createdAt`. One index: `@@index([userId, isRead])`.

**API** — three routes, all thin wrappers over `NotificationService`, no changes needed:
`GET /api/v1/notifications` (`listForUser`), `POST /api/v1/notifications/:id/read`
(`markRead`), `POST /api/v1/notifications/mark-all-read` (`markAllRead`).

**UI** — `apps/web/app/(app)/notifications/page.tsx`: full list, unread highlighting,
mark-all-read button, click-to-navigate (task or, for project-scoped conversation
notifications per doc 17 §11, project) with read-on-click. `apps/web/lib/notification-copy.ts`:
a `switch` over all 14 type strings with human-readable copy for every one, **including
`task.reassigned`, `deadline.approaching`, `task.overdue`, `review.completed`** — the four
currently-dead types. This is decisive: the UI layer was over-built relative to the
backend in Phase 1/2A, and this phase's job on the notification side is purely to make the
backend produce what the UI already knows how to show.

**Trigger inventory** (10 live / 4 dead, re-verified this session with exact call sites):

| Type | Status | Call site |
|---|---|---|
| `TASK_ASSIGNED` | live | `assignment.service.ts:161-166` (first/general assign), `:370-375` (`reassignInternal`) |
| `TASK_ASSIGNED_TO_TEAM` | live | `assignment.service.ts:169-174` |
| `ASSIGNMENT_ACCEPTED` | live | `assignment.service.ts:~236-243` |
| `ASSIGNMENT_DECLINED` | live | `assignment.service.ts:~298-305` |
| `TASK_REASSIGNED` | **dead** | none — `assign()` always fires `TASK_ASSIGNED`, even when `previousCurrent` (line 108) proves it's a reassignment |
| `COMMENT_ADDED` | live | `task.service.ts:517-521` |
| `DEADLINE_APPROACHING` | **dead** | none — no time-based evaluation exists anywhere |
| `TASK_OVERDUE` | **dead** | none — same reason |
| `REVIEW_REQUESTED` | live | `task.service.ts:607-613` (`submitTask`) |
| `REVIEW_COMPLETED` | **dead** | none — `reviewTask` (`task.service.ts:669-676`) only ever fires `TASK_COMPLETED`/`CHANGES_REQUESTED` |
| `CHANGES_REQUESTED` | live | `task.service.ts:672` (decision branch) |
| `TASK_COMPLETED` | live | `task.service.ts:672` (decision branch) |
| `MESSAGE_ADDED` | live | conversation message creation path |
| `MENTIONED_IN_TASK` | live | mention-parsing path |

**Scheduler/background execution** — confirmed absent, again, this session: no
cron/queue/worker library in any of the five `package.json` files; no `Dockerfile`; no CI
workflow; no `middleware.ts`; no health-check route; `docker-compose.yml` defines Postgres
only. Next.js is `15.5.25` (`apps/web/package.json`), started via plain `next dev`/`next
start` (no custom server). Next 15 ships a **stable** `instrumentation.ts` hook
(`register()`, invoked once when the server process starts, no experimental flag needed at
this version) — this is the framework's own supported extension point for "run code once
at boot," and neither `apps/web/next.config.js` nor the app directory currently uses it
(confirmed: no `instrumentation.ts` file exists).

**`isOverdue`** (`packages/domain/src/state-machines/task-status.machine.ts:68-72`)
already exists, reused unchanged: `dueDate < now`, excluding `COMPLETED`/`CANCELLED`. No
"approaching" equivalent exists yet — this phase must define one (§5).

---

## 3. Problem Definition

Doc 23 §4 established the vision-arc gap (Awareness). This report narrows it to two
concrete, evidence-backed defects plus one concrete gap:

1. **Defect**: a task reassignment away from its current holder is indistinguishable, in
   the recipient's notification feed, from a brand-new assignment — the UI already has the
   correct copy (`"A task was reassigned"`) ready to use; only the trigger is missing.
2. **Dead code**: `REVIEW_COMPLETED` and (pending §1's fix) no longer any other
   permanently-unreachable `NotificationType` value.
3. **Gap**: no user is ever told a deadline is near or has passed unless they open the app
   and read `dueDate` themselves — despite `isOverdue` already existing as exactly the
   check that's missing a caller.

---

## 4. Notification Fixes — Design

### 4.1 `TASK_REASSIGNED` (in `AssignmentService.assign()`)

Branch on the already-computed `previousCurrent` (line 108) at the existing notify call
site (lines 160-175): if `previousCurrent` is non-null **and** the new assignee is a
different person/team than before, fire `TASK_REASSIGNED` instead of `TASK_ASSIGNED`
(individual case) or a symmetrically-named team case if `TASK_ASSIGNED_TO_TEAM` needs the
same distinction — to decide precisely during implementation, defaulting to: only the
`USER`-targeted branch needs the distinction, since the doc-17-established pattern already
routes team-targeted assignment through `TASK_ASSIGNED_TO_TEAM` regardless of history, and
doc 23/this report found no evidence a "team reassignment" notification copy or product
need exists beyond what's already covered. Payload gains one field,
`previousAssigneeId` (or team id), giving the notification-copy layer room to say "This
task was reassigned to you" vs. "You were assigned" without a UI change being required for
v1 (the existing generic `task.reassigned` copy already covers it; a richer message using
the new field is a COULD HAVE, §12). **No new query** — `previousCurrent` is already
fetched for the supersede logic immediately above.

`reassignInternal` is explicitly **not** changed — confirmed correct as-is (§1).

### 4.2 `REVIEW_COMPLETED` — remove, do not wire up

Recommendation: delete the `REVIEW_COMPLETED` value from `NotificationType` and its dead
`case` in `notification-copy.ts`, rather than inventing a recipient for it. The review loop
is fully covered today (submit → reviewer notified; decision → assignee notified) and no
third party exists in the current authorization model to receive a distinct "review
completed" signal. This is flagged as an **open product question** (§13), not a unilateral
deletion in this document — a future product decision (e.g., notifying the task creator
when they are neither the reviewer nor the assignee) could resurrect a
purpose-built version of this type, but that is a new, deliberately-scoped feature, not a
dead-code fix.

### 4.3 `DEADLINE_APPROACHING` / `TASK_OVERDUE` — the scheduler's two consumers

Both are produced by the scheduler tick (§7-§9), not by any request-time code path — this
is the one pair of notification types that genuinely requires the new execution model.

---

## 5. "Deadline Approaching" Definition

No existing definition exists; this report proposes one, precisely, per doc 23 §17's
caution against over-engineering v1:

- **Approaching window**: a task is "approaching" if `dueDate` is in the future, within a
  fixed lookahead window (proposed default: **24 hours** — a single, simple constant, not
  a per-org/per-user configurable setting for v1, matching doc 21 §25's precedent of
  leaving exact thresholds as named-but-unconfigured constants until a real product need
  for configurability appears), and `status` is not terminal (`COMPLETED`/`CANCELLED`,
  same exclusion as `isOverdue`).
- **Fire-once, not every tick**: without a "was this already notified" check, a task
  sitting in the approaching window across multiple ticks would notify repeatedly. §8
  addresses this precisely (the idempotency mechanism is the same one that solves the
  overdue case).
- **Recipient**: the current individual assignee only (`TaskAssignment.isCurrent=true,
  assigneeType=USER`) — exactly the same "current accountable owner" rule doc 21 §7
  established and this codebase uses everywhere; a team-assigned, not-yet-distributed task
  has no individual to notify and is silently skipped (matching how `getTeamSignals`
  already treats undistributed team assignments).

---

## 6. "Overdue" Trigger Definition

Reuses `isOverdue` unchanged. Same recipient rule as §5. Same fire-once requirement as §5
(a task overdue for five days must not produce five `TASK_OVERDUE` notifications) —
addressed by §8.

---

## 7. Scheduler — Execution Model

**Design goal, stated directly from doc 23 §18/§9's conclusion**: the smallest execution
model that correctly serves exactly these two checks, not a general-purpose job system.

- **Shape**: one plain, exported, testable function — `runScheduledChecks(db: PrismaClient,
  now: Date): Promise<{ approaching: number; overdue: number }>` (return shape illustrative,
  finalized at implementation) — living in `packages/domain/src/services/` alongside the
  services it composes (`NotificationService`, a task query). It performs one "tick":
  query tasks matching §5/§6's conditions, apply the idempotency check (§8), call
  `NotificationService.notify` for each qualifying task's current assignee, return a
  summary for logging.
- **Invocation, live deployment**: a new `apps/web/instrumentation.ts` implementing
  Next.js's `register()` hook, which — **only when running in the Node.js runtime** (guard
  via `process.env.NEXT_RUNTIME === "nodejs"`, the documented way to avoid double-running
  in the Edge runtime) — starts a `setInterval` calling `runScheduledChecks(db, new
  Date())` on a fixed period (proposed default: **every 15 minutes** — frequent enough for
  a 24h approaching-window to give meaningful lead time, infrequent enough to be
  negligible load, both revisitable constants, not something this report hardcodes as
  unchangeable).
- **Invocation, tests**: `runScheduledChecks` called directly with an injected `now` and
  the test's own Prisma client — no timer, no `instrumentation.ts` involvement, mirroring
  exactly how `local-day.ts`'s functions are unit-tested today.
- **Explicitly not built**: a job-definition DSL, a persistent job-queue table, retry/backoff
  logic, or any multi-instance coordination (locking, leader election) — all premature
  given the confirmed single-process deployment reality (§8 covers correctness in that
  reality; §13 flags what changes if that reality changes).

---

## 8. Idempotency & Correctness

The one genuine correctness risk in a periodic-recompute design: notifying the same task
for the same condition on every tick. Two options were weighed:

- **Option A (chosen): a `sentDeadlineApproachingAt`/`sentOverdueAt` marker.** Cheapest
  correct design: two new nullable `DateTime` columns directly on `Task`
  (`deadlineApproachingNotifiedAt`, `overdueNotifiedAt`), set when the corresponding
  notification fires, checked (`IS NULL`) as part of the tick's own query predicate — so a
  task already notified is excluded from the next tick's candidate set at the SQL level,
  not filtered in application code. This is the **only schema change this report
  proposes** (§14) — two columns, additive, nullable, no new table.
- **Option B (rejected): derive "already notified" by querying `Notification` for an
  existing row of that type/task/user.** Rejected because it requires a second query per
  candidate (reintroducing the exact N+1-shaped risk doc 21 §18 flagged and this project
  has consistently avoided) and because `Notification` is meant to be a delivery record,
  not a dedup index — overloading it that way is exactly the kind of second-source-of-truth
  risk doc 21 §1's "reporting is a projection, never a second source of truth" principle
  warns against, generalized to this phase's own data.

**Multi-instance safety (addressed, not deferred, per doc 23 §18's explicit instruction not
to design an imaginary scheduler)**: Option A is also what makes this design safe if the
deployment ever becomes multi-instance without any code change — two instances ticking
concurrently might both select the same not-yet-notified task, but the `SET
...NotifiedAt = now() WHERE id = ? AND ...NotifiedAt IS NULL` update (a conditional write,
not a blind write) means only one instance's update actually matches a row still `NULL`;
the loser's own notify call should be made conditional on that update actually affecting a
row (Prisma's `updateMany` returns a count) before calling `NotificationService.notify` —
producing an at-most-once guarantee without any lock, queue, or leader-election
infrastructure. This is deliberately not a distributed-job system; it's a plain
conditional-write race resolved the same way `Workday`'s own upsert race was resolved in
Phase 3 (P2002/conditional-update recovery) — the same pattern, not a new one.

---

## 9. Security — Applying "A Notification Is a Disclosure" (Doc 23 §16/§19)

Concretely verified against this phase's two new checks:

- **Recipient derivation is authorization-safe by construction.** Both `§5` and `§6`
  notify only `TaskAssignment.isCurrent=true, assigneeType=USER, assigneeUserId=X` — the
  same "current accountable owner" whom `canViewTask` already permits to see the full task
  by definition of being its assignee. There is no scenario where the scheduler notifies
  someone who could not already open that task and see the same `dueDate` themselves.
- **No new payload field beyond what the assignee already sees.** The notification payload
  carries `taskId`/`taskTitle`/`dueDate` — all fields the assignee's own task view already
  renders. No cross-workspace or cross-tenant data path is introduced; the scheduler's
  query is written the same way every other tenant-scoped query in this codebase is,
  filtered through the task's own `workspaceId`/organization membership implicitly via the
  assignee relationship (an assignee is, by construction, already a member of the task's
  workspace — assignment cannot happen otherwise, per `AssignmentService.assign`'s own
  `assertOrgMember`/membership checks at assignment time).
- **No manager/observer digest is introduced in this phase** (deferred per doc 23 §17/§26)
  — this is the one extension doc 23 explicitly flagged as the real future risk ("a
  manager digest... must re-run the same `canViewTask`-equivalent check"); this phase does
  not build it, so that risk is not yet live.
- **`TASK_REASSIGNED`** (§4.1): recipient is the new current assignee, same rule as every
  existing `TASK_ASSIGNED` call site — no change in authorization shape, only in which
  enum value is chosen.

---

## 10. Performance

- The tick's query for §5/§6 is a single, indexed, bounded scan:
  `WHERE dueDate IS NOT NULL AND status NOT IN (COMPLETED, CANCELLED) AND
  (deadlineApproachingNotifiedAt IS NULL OR overdueNotifiedAt IS NULL)`, narrowed further
  by the two date conditions. `Task.dueDate` has no existing index (confirmed via schema
  grep) — this report proposes adding `@@index([dueDate])` on `Task` alongside the two new
  columns (§14), since every tick will filter on it. At current and realistically
  near-term scale (doc 21 §18's same reasoning: an institution's total open-task count is
  in the hundreds/low-thousands, not millions) this is a fast, bounded query even before
  the index, but the index costs nothing to add now and removes any future doubt.
- 15-minute tick frequency against a bounded, indexed query is negligible load — no
  batching/pagination is needed inside a single tick (the candidate set per tick is small
  by construction: only tasks newly crossing a threshold since the last tick).

---

## 11. Deployment Implications — the Open Question Doc 23 Deferred

Doc 23 §27 flagged deployment target as a question this assessment could not answer. This
report's design (§7) is **explicitly conditioned** on the current, confirmed reality: one
Next.js server process, no separate worker, no evidence of a serverless/edge target
(`serverExternalPackages: ["@prisma/client"]` in `next.config.js` implies a Node.js
server runtime is already assumed for Prisma to work at all — an edge/serverless-only
deployment would already be incompatible with the app as it exists today, independent of
this phase). Given that, an `instrumentation.ts`-based in-process timer is the correct,
minimal design **for the deployment model the app already requires**.

**What would change this design, stated explicitly rather than left implicit:** if the
product is later deployed across multiple concurrent server instances (horizontal scaling
behind a load balancer), §8's conditional-write design remains correct without
modification (each instance's tick is independently safe), but running N instances each
firing a tick every 15 minutes is wasted duplicate work, not a correctness problem — at
that point, moving the tick to a single dedicated process (still no external queue
needed) would be a reasonable, purely-operational follow-up, not a redesign.

---

## 12. MUST / SHOULD / COULD / DEFERRED

**MUST HAVE**
- `TASK_REASSIGNED` fires correctly from `AssignmentService.assign()` (§4.1).
- Scheduler tick function, directly testable, producing `DEADLINE_APPROACHING` and
  `TASK_OVERDUE` notifications exactly once per task per condition (§5-§8).
- `instrumentation.ts` wiring for live deployment (§7).
- Two new nullable `Task` columns + one new index (§8/§14) — the only schema change.

**SHOULD HAVE**
- A one-line log per tick (`{approaching, overdue}` counts) for basic observability, per
  doc 23 §24's mitigation for "silent scheduler failure" — not a full observability stack.

**COULD HAVE**
- Richer `task.reassigned` copy using the new `previousAssigneeId` payload field.
- Configurable approaching-window/tick-frequency constants (env-driven) instead of
  hardcoded — only if a real need for per-deployment tuning appears.

**EXPLICITLY DEFERRED** (unchanged from doc 23 §17/§26, reconfirmed here):
- Push/email delivery channels.
- Notification preferences/mute/opt-out.
- Any manager/observer digest notification.
- Recurring work, calendar, time tracking, AI, RLS, broader production hardening — none
  touched by this phase.
- Multi-instance job coordination beyond the conditional-write guarantee already designed
  in (§8/§11) — no queue, no lock table, no leader election.

---

## 13. Open Questions Requiring Product Decision

1. **`REVIEW_COMPLETED` — remove or repurpose?** This report recommends removal (§4.2);
   final call is a product decision, not purely technical.
2. **Approaching-window value (24h proposed) and tick frequency (15min proposed)** — both
   named as revisitable constants (§5/§7), not hardcoded permanently; confirm the defaults
   are acceptable or specify different ones before implementation.
3. **Team-targeted reassignment**: does `TASK_ASSIGNED_TO_TEAM` also need a distinct
   "reassigned to your team" variant, or is the current single type sufficient? This
   report's default (§4.1) is "not needed," pending confirmation.
4. **Multi-instance deployment timeline**: if horizontal scaling is planned soon, note it
   now — it does not change this phase's design (§11) but affects how soon the "move the
   tick to one process" follow-up (§11) becomes worth doing.

---

## 14. Schema Impact

Two new nullable columns on `Task` — `deadlineApproachingNotifiedAt DateTime?`,
`overdueNotifiedAt DateTime?` — plus one new index, `@@index([dueDate])`. Both columns are
additive, nullable, backward-compatible, and require no data backfill (existing rows
default to `NULL`, meaning "not yet notified," which is correct for every existing task on
migration day — no task should be treated as already-notified for a check that has never
run before). No other schema change. No new table.

---

## 15. Testing Strategy

**Unit tests** (`packages/domain/src/**/*.test.ts`):
- `runScheduledChecks` against fixture data with an injected `now`: a task just crossing
  into the approaching window fires once; a task already past `overdueNotifiedAt` does not
  fire again; a task with no `dueDate` never fires; a `COMPLETED`/`CANCELLED` task never
  fires even with a past `dueDate`; a team-assigned (not yet distributed) task is skipped.
- `AssignmentService.assign()`: a first assignment fires `TASK_ASSIGNED`; a reassignment
  (task already has a `previousCurrent`) fires `TASK_REASSIGNED`; `reassignInternal` still
  fires `TASK_ASSIGNED` (regression guard for §4.1's "do not change this" finding).
- Idempotency race: two concurrent `updateMany` calls against the same task/condition
  result in exactly one notification (simulated, not requiring real concurrency).

**E2E** (extending `tests/e2e/abc-college.e2e.test.ts`):
1. A task reassigned from user A to user B produces `TASK_REASSIGNED` for B, not
   `TASK_ASSIGNED`.
2. A team-distribution assignment (`reassignInternal`) still produces `TASK_ASSIGNED`
   (unchanged behavior, explicit regression coverage).
3. A scheduler tick run directly (test-invoked, no timer) against a task due within the
   approaching window produces exactly one `DEADLINE_APPROACHING` notification for the
   current assignee.
4. A second tick run against the same task does not produce a duplicate.
5. A tick run against an overdue task produces `TASK_OVERDUE` for the current assignee
   only — confirmed absent for an unrelated user with no access to the task (authorization
   negative case, per doc 23 §16/§19).
6. Full regression: the existing ~122 E2E scenarios rerun unmodified and green.

---

## 16. Implementation Sequence

1. **Schema** — add the two `Task` columns + index (§14); additive migration, hand-written
   per this project's established pattern (`prisma migrate diff --script`).
2. **`AssignmentService.assign()` fix** — branch on `previousCurrent` for `TASK_REASSIGNED`
   (§4.1); unit + E2E coverage.
3. **`REVIEW_COMPLETED` cleanup** — pending §13 Q1's confirmation, remove the dead enum
   value and its copy-layer case.
4. **Scheduler domain function** — `runScheduledChecks` in `packages/domain`, unit-tested
   against fixtures per §15, independent of any timer.
5. **`instrumentation.ts`** — wire the live-deployment timer (§7), guarded for the Node.js
   runtime only.
6. **E2E** — the scenarios in §15, plus full-suite regression.
7. **Security review** — confirm §9's authorization-safety argument against the actual
   implemented query, not just the design.
8. **Production build** — full monorepo typecheck/lint/build.
9. **Final diff audit** — confirm no unintended file changed.
10. **Commit** — only after explicit user approval.
11. **Push** — only when separately requested.

---

## 17. Final Recommendation

This design closes the two dead-code defects and the one real gap doc 23 identified, using
one new domain function, one small edit to an existing method, one small deletion, and the
smallest schema change that makes periodic re-evaluation idempotent — two nullable columns
and one index, no new table. The scheduler itself is deliberately the least infrastructure
that correctly and safely (§8/§11) serves its two consumers, explicitly conditioned on the
deployment reality this session re-confirmed rather than an assumed one, per doc 23's own
instruction. The Notification Center UI requires no changes at all — it was already built
ahead of its backend.

This is an architecture design only. Implementation should not begin until this report is
explicitly approved, matching the process used for every phase so far.

READY FOR IMPLEMENTATION
