# 19 — Phase 3: Daily Work Cycle — Architecture Report

**Base commit:** `d4d3b8b`. **Status:** architecture only — no code, schema, or migration
exists yet. This report follows the same process as doc 17 (Phase 2C): investigation →
proposal → explicit approval required before any implementation.

---

## 1. Executive Summary

The existing system is a complete, well-tested **work graph**: who owns what task, who
assigned it to whom, whether they accepted it, and what state it's in. It answers "what
exists and who's accountable for it." It does not yet answer "what should I actually do
*today*, in what order, and what happened to the things I didn't finish" — that's a
different, orthogonal dimension (a calendar/planning dimension layered *on top of* the
work graph, not a replacement for any part of it), and it's what Phase 3 adds.

The proposed design adds exactly **two new tables** (`Workday`, `DailyPlanItem`), **one new
enum**, **one additive JSON column on `User`**, and **one additive nullable column on
`AuditLog`** (the fourth use of the pattern doc 15/17 already established twice). Nothing
in `Task`, `TaskAssignment`, `Conversation`, `TaskAttachment`, or `Project` changes. Daily
planning is modeled as a thin, personal, reference-only layer that points at existing
Tasks — never a copy of one. Authorization is radically simple by construction: every
route operates on the caller's own data with no target-user parameter anywhere in the API
surface, eliminating an entire class of cross-user IDOR risk before it can exist.

The cycle itself (START → PLAN → EXECUTE → CLOSE → TOMORROW READY) is **not** implemented
as a rigid, gated state machine. Only two moments are real, persisted state: a day opens
(`startedAt` set, lazily, on first touch) and a day closes (`closedAt` set, by one
explicit, validated action that forces every unfinished item to get an intentional
disposition — never silently rolled to tomorrow). Everything between those two moments —
planning, executing, replanning, adding unplanned work — is free-form, because the brief
explicitly (and correctly) demands the workflow not fight how people actually work.

**Recommendation: READY FOR IMPLEMENTATION** (full reasoning in §37).

---

## 2. Current Architecture Relevant to Phase 3

Verified directly against the code at `d4d3b8b` (not assumed from earlier docs):

- **Task** (`packages/db/prisma/schema.prisma`): `dueDate DateTime?` (has a time
  component, not just a date), `startDate DateTime? @db.Date`, `estimatedDurationMinutes
  Int?` (set once at creation, never compared against anything — confirmed unused for any
  comparison anywhere in the codebase), `priority`, `status` (the full lifecycle state
  machine), `projectId String?`, `workspaceId String!`. This remains the sole source of
  truth for "what is the work" — Phase 3 never duplicates any of these fields.
- **TaskAssignment**: `isCurrent`, `status` (`PENDING_ACKNOWLEDGEMENT|ACCEPTED|DECLINED|SUPERSEDED`),
  `assigneeType`/`assigneeUserId`/`assigneeTeamId`. "My Tasks" (`TaskService.listTasks`,
  view `MY_TASKS`) is already defined as *the current, accepted, individual assignment* —
  this is the exact, correct definition of "work I actually own" that Phase 3's Inbox
  reuses verbatim.
- **User**: has `defaultTimezone String @default("UTC")` — **confirmed by repo-wide grep
  that this field is stored and returned to the client but never used to compute anything**
  (see §31, a debt item Phase 3 both depends on and fixes).
- **Dashboard** (`ReportingService.getPersonalDashboard` / `bucketByDueDate`): already
  buckets a user's tasks into Due Today / Upcoming / Overdue / Completed using
  `startOfDay(now)`/`endOfDay(now)` — **computed from `new Date()`, i.e., the server's
  clock, not the user's local calendar day**. This is the exact bug the brief's §11
  warned against, already present in shipped code. Phase 3 must not repeat it, and should
  fix the existing instance while building the correct utility (§31).
- **Audit log / Activity feed**: `AuditLog.taskId`/`.projectId` (nullable, additive,
  indexed) is the established "one more optional FK, one more indexed query" pattern —
  Phase 3's `.workdayId` is the third instance of literally the same pattern, not a new
  idea.
- **State machines**: `task-status.machine.ts` and `assignment-status.machine.ts` are
  pure, DB-free, table-driven `Record<State, Partial<Record<Event, State>>>` modules with
  a `canTransition`/`next*` pair and a typed error — this is the established pattern any
  new state logic should follow (§22).
- **API conventions**: `withAuth` wrapper (session → handler → `{data,error}` envelope),
  Zod-validated bodies/queries, cursor pagination shaped `{items, nextCursor}` on some
  endpoints (messages, notifications, activity) but **not consistently** on others
  (comments, updates, project members — a pre-existing inconsistency, not one Phase 3
  should add to).
- **Flat item-route convention**: `/messages/:id`, `/project-dates/:id`,
  `/attachments/:id` all resolve their own parent server-side rather than nesting under
  it — the right template for `/workday-items/:id` (§20).
- **Authorization pattern**: every resource type gets its own `assertCanX`/`canX`
  predicate composed from `PermissionService` primitives, never a hardcoded role check.
  Personal-workspace and project-membership both proved this composes cleanly; Phase 3's
  authorization (§27) is actually *simpler* than either, since there is no "other user"
  case in scope at all.
- **Testing convention**: `packages/domain/src/**/*.test.ts` for pure logic (state
  machines, predicates) + one large narrative E2E file
  (`tests/e2e/abc-college.e2e.test.ts`, 84 passing scenarios today) driven through the
  real HTTP API against real Postgres. Phase 3 extends both, per the existing house style.

**Nothing above needs to change for Phase 3 to be buildable.** The one thing that *should*
change alongside it is wiring `User.defaultTimezone` into a shared day-boundary utility
and reusing it in the existing dashboard code (§31) — genuinely in scope, small, and
directly prevents the two features from disagreeing about what "today" means.

---

## 3. Product Goal

Answer, for one person, on one day: **what should I work on, when, what actually
happened, and what happens to what I didn't finish** — without inventing a second task
system, a second assignment system, or a second calendar system. Daily planning is a
*view and a decision layer* on top of the existing work graph, not a parallel one.

---

## 4. Daily Work Cycle Model

```
 (no Workday row yet)
        │
        ▼
      START  ─────────────────────────────┐
        │  (situational awareness only)    │ free movement in
        ▼                                  │ either direction,
      PLAN   ◄──────────────┐              │ any number of times,
        │                   │              │ for the whole day
        ▼                   │              │
     EXECUTE ────────────────┘              │
        │  (Start/Complete individual       │
        │   items, add unplanned work)      │
        ▼                                  │
      CLOSE  ◄────────────────────────────┘
        │  (one explicit, validated action:
        │   every unfinished item gets a
        │   disposition)
        ▼
  TOMORROW READY
        │
        ▼
      START (next calendar day)
```

**This is not a five-state gated machine.** Only `Workday.startedAt` (set) and
`Workday.closedAt` (set) are real, persisted transitions. PLAN and EXECUTE are UI *views*
over the same underlying `DailyPlanItem` rows, not separate stored states — a user can
plan one item, execute it, plan another, execute that, replan, all within the same open
day, in any order, with no validation in between. The only enforced rule in the entire
cycle is at CLOSE (§8/§22).

---

## 5. START

**Purpose:** situational awareness only — reduce "what's going on" anxiety before any
planning decision is asked for. Read-only.

**Shown (MVP):**
- Today's date (user-local, per §11's timezone fix)
- Yesterday's `Workday`, if it exists and was never closed — surfaced as "yesterday wasn't
  closed" with its unresolved items, rather than silently vanishing
- Overdue tasks (existing `isOverdue()`, reused unchanged)
- Pending Acceptance (existing dashboard bucket, reused unchanged)
- New assignments since the user's last visit (derivable from `AuditLog` /
  `Notification`, no new storage)
- Today's `DailyPlanItem`s if a plan already exists (e.g., user closed yesterday and
  carried items forward — today already has content before they've "done" anything)
- Unread notification count (existing)

**Deferred until Calendar exists:** meetings/events, anything requiring an external
calendar connection. START must degrade gracefully with zero calendar data — it already
has enough from the existing work graph to be useful without it.

**Persisted:** nothing new is written by viewing START. The very first read of START (or
PLAN, or any workday endpoint) for a given local day **lazily creates** the `Workday` row
if one doesn't exist yet and sets `startedAt = now()` — "starting the day" is an implicit
side effect of engaging with the app that day, not a separate button the user must
remember to press. (A user who skips straight to adding a task to today's plan still gets
a `Workday` row created transparently underneath them.)

---

## 6. PLAN

**Purpose:** decide what today actually contains.

**Capabilities:**
- Select tasks for today from Inbox (§10) — creates a `DailyPlanItem`
- Reorder (`position`, a plain integer, reassigned via a reorder endpoint — drag-and-drop
  is a UI concern over this same field, not a new data need)
- Set a per-day duration estimate (`plannedDurationMinutes`) — deliberately separate from
  `Task.estimatedDurationMinutes` (§13): the task's own estimate is a general default; a
  day's plan may reasonably re-estimate ("today I'll only get 30 minutes into this")
- Optionally set `scheduledStart`/`scheduledEnd` — a lightweight "I intend to do this from
  X to Y" without any conflict-detection or calendar-grid UI (§16/§23)
- Move an item to another day (rewrite `workdayId` to a different date's `Workday`, or —
  cleaner and consistent with Close's carry-forward mechanism (§19) — delete-and-recreate
  via the same carry-link so history is preserved either way)
- Carry forward unfinished items from a previous open (unclosed) day directly into today,
  without going through Close first — the same operation Close performs, available early
- Add a quick/unplanned task inline (this is the one place PLAN and EXECUTE overlap in
  practice — a task added "during planning but not part of the original list" is still
  `isUnplanned = true` if the user marks it so, or simply added like any other item if not
  — the flag is user-declared, never clock-inferred, keeping the rule simple and honest)
- See total planned minutes vs capacity (§16) as a simple running total, not a hard block

**Explicitly preserved distinctions** (per the brief's §5 instruction):
- **Assigned ≠ Planned.** A task being the current accepted assignment does not put it on
  today's plan. It shows in **Inbox** until the user deliberately adds it.
- **Accepted ≠ Scheduled.** Accepting an assignment changes `Task`/`TaskAssignment`
  state; it never touches `DailyPlanItem`. Scheduling is `scheduledStart`/`scheduledEnd`
  on a `DailyPlanItem`, set only when the user explicitly sets it.

---

## 7. EXECUTE

**Purpose:** work the plan, and absorb what shows up mid-day.

**NOW / NEXT / LATER** are **not stored** — they're a client-side grouping over
`DailyPlanItem.status` + `position` (NOW = the one item with `status=IN_PROGRESS`, or the
top of the ordered list if none is active; NEXT = the next 1–3 `PLANNED` items in order;
LATER = the rest). No new field needed.

**Actions and their effect:**
| Action | Effect | Touches `Task`? |
|---|---|---|
| Start | `DailyPlanItem.startedAt = now()` (if unset), `status → IN_PROGRESS` | No |
| Pause | UI-only for MVP — simply stop treating it as NOW; no field changes (see §17 for why persisted pause/resume is deliberately deferred) | No |
| Resume | Re-select as NOW; no field changes | No |
| Complete | `DailyPlanItem.completedAt = now()`, `status → COMPLETED_TODAY` | No, by default — see below |
| Submit | A UI convenience that calls the **existing, unmodified** `POST /tasks/:id/submit` in addition to marking the plan item complete — reuses the real submit flow rather than inventing one | Yes, via the existing API, unchanged |
| Reschedule | Move to a different day (§6's "move" operation) | No |
| Add unplanned work | Same as Plan's "add a quick task," available mid-day | No |

**Critically:** "Start" and "Complete" on a `DailyPlanItem` are entirely local to the daily
plan layer and never call the task lifecycle. This directly satisfies the brief's explicit
warning ("starting work should NOT automatically mean completing a task") by construction
— there is no code path from EXECUTE that can change `Task.status` except the one
deliberate "Submit" convenience button, which calls the exact same, already-authorized,
already-tested `submitTask` API a user could call from the task detail page today. A
personal-workspace task's "Complete" button can additionally offer to call the existing
completion path (personal tasks reach `COMPLETED` differently — via review-approval on
self, per the existing state machine) as the same kind of convenience wiring, not new
domain logic.

---

## 8. CLOSE

**Purpose:** end the day honestly — no unfinished item disappears silently.

At close time, the system classifies every `DailyPlanItem` for the day:
- **Resolved automatically** (no disposition required): `status=COMPLETED_TODAY`, or the
  underlying `Task.status` is already `COMPLETED`/`CANCELLED` (the task resolved itself
  outside the daily-plan layer — nothing left to decide)
- **Requires disposition**: everything else (`PLANNED`, `IN_PROGRESS`)

`POST /me/workday/close` (§20) accepts one disposition per unresolved item:
- **Carry forward** → a new `DailyPlanItem` is created on the target date (default:
  tomorrow), linked via `carriedFromItemId`/`carriedToItemId`; the old item's status
  becomes `CARRIED_FORWARD`. History is preserved, never overwritten (§19).
- **Move to backlog/Inbox** → `status → MOVED_TO_BACKLOG`; the task simply reappears in
  Inbox with no future-day commitment.
- **Reschedule to a specific future date** → same mechanism as carry-forward, targeting
  an explicit date instead of "tomorrow."
- **Delegate/reassign** → not a new capability — if the user has `TASK_REASSIGN_INTERNAL`
  or equivalent, this is a UI shortcut into the **existing, unmodified** assignment API;
  the plan item itself becomes `MOVED_TO_BACKLOG` on this user's plan once it's no longer
  theirs.
- **Cancel** → same pattern: a shortcut into the existing `cancelTask`, if the user is
  authorized to cancel; plan item becomes `DROPPED_FOR_TODAY`.
- **Drop (keep the task, just not carrying today's plan forward)** → `status →
  DROPPED_FOR_TODAY`, no future placement — an honest "I'm not doing this, and I'm not
  promising to."

The request is validated **transactionally and completely**: if any unresolved item is
missing a disposition, the whole close is rejected (422) listing exactly which items are
still open — never a partial close. An optional `reflectionNote` (free text) is stored on
`Workday.reflectionNote`. `closedAt = now()` only on success.

---

## 9. Tomorrow Ready

Not a separate stored state — it's simply **what START shows the next calendar day**,
already populated by whatever Close (or an early carry-forward from Plan) placed there:
carried-forward items, anything already `scheduledStart`-dated for tomorrow, and
deadlines crossing into view. No recurring-task infrastructure is invoked (none exists,
and Phase 3 doesn't add any — §18/deferred scope, §34).

---

## 10. Inbox vs Today vs Scheduled vs Deadline

These are four genuinely different dimensions, deliberately not collapsed:

| Concept | What it means | Where it lives | Derived or stored? |
|---|---|---|---|
| **Inbox** | Work that's mine (current accepted individual assignment) but not yet placed on any open day's plan | `Task`/`TaskAssignment` (existing, unchanged) minus tasks with an active `DailyPlanItem` today | **Derived** — a query, not a table |
| **Today** | Work I intentionally selected for today | `DailyPlanItem` rows for today's `Workday` | **Stored** — this is the one genuine decision that cannot be reconstructed from anything else |
| **Scheduled** | A Today item with an intended time window | `DailyPlanItem.scheduledStart/scheduledEnd` (nullable) | **Stored**, but it's an *attribute* of a Today item, not a separate concept/table |
| **Deadline** | When the underlying work is actually due | `Task.dueDate` (existing, untouched) | **Stored on Task already** — Phase 3 only ever reads it |
| **In Progress** (ambiguous term, disambiguated here) | Two different things depending on layer: `Task.status=IN_PROGRESS` (lifecycle: assignment accepted, work has begun in the general sense) vs `DailyPlanItem.status=IN_PROGRESS` (today: actively the one being worked on right now) | Both, independently | Both stored, intentionally uncoupled |
| **Unplanned work** | A Today item added outside the original plan | `DailyPlanItem.isUnplanned=true` | **Stored**, boolean flag on the same row — not a separate table |
| **Carry forward** | Work intentionally moved from today to a future day | `DailyPlanItem.status=CARRIED_FORWARD` + link to the successor row | **Stored**, as a status + relation, not a new entity |

A task can be, simultaneously: `Task.status=IN_PROGRESS` (accepted, generally underway),
absent from today's Inbox-derived list (because it's *on* today's plan already), with
`DailyPlanItem.status=PLANNED` (not yet touched today) and no `scheduledStart` (not
time-boxed) — five independent facts, five independent, non-conflicting representations.

---

## 11. Daily Work Domain Model

| Entity | Purpose | Ownership | Persisted or derived | Why |
|---|---|---|---|---|
| **Workday** | Anchor for one user's one local calendar day — start/close timestamps, reflection | One row per `(userId, workDate)` | **Persisted** | `startedAt`/`closedAt`/`reflectionNote` are real facts about what happened, not reconstructable from `DailyPlanItem` rows alone (a day with zero planned items can still be legitimately started and closed) |
| **DailyPlanItem** | "This task is on my plan for this day," plus its local status/timing | One row per `(workdayId, taskId)` | **Persisted** | The single genuine decision of the whole model — nothing else knows a user chose to work on X today |
| **PlannedTask** (brief's term) | Same concept as `DailyPlanItem` | — | — | Not a separate entity — one name, one table, to avoid the "TaskComment vs Conversation" style duplication doc 18 flagged as debt |
| **TimeBlock** (brief's term) | "Scheduled" attribute | — | — | Not a separate entity — `scheduledStart`/`scheduledEnd` columns on `DailyPlanItem`, per §16/§23; a real `TimeBlock`/calendar-event model belongs to the future Calendar phase |
| **WorkSession** (brief's term) | Start/stop timing | — | — | Not a separate entity for MVP — `startedAt`/`completedAt` on `DailyPlanItem` give one coarse elapsed-time signal without building pause/resume session history (§17, alternatives in §36) |
| **UnplannedWork** (brief's term) | Mid-day addition | — | — | Not a separate entity — `DailyPlanItem.isUnplanned` boolean |
| **CarryForward** (brief's term) | Moved to a future day | — | — | Not a separate entity — a `DailyPlanItem.status` value + a self-referencing link, preserving full history without a dedicated table |
| **DailyReview** (brief's term) | End-of-day reflection | — | — | Not a separate entity — `Workday.reflectionNote` plus a derived read (aggregate counts computed at request time, never stored) |

**Net new tables: 2.** Everything else the brief lists as a "concept to consider" is
deliberately folded into those two, exactly matching the instruction "do NOT assume all
of these need separate database tables."

---

## 12. Database Schema

All changes are additive. No existing model's existing field changes. Written in the same
style as `schema.prisma`'s existing models.

### New enum
```prisma
enum DailyPlanItemStatus {
  PLANNED
  IN_PROGRESS
  COMPLETED_TODAY
  CARRIED_FORWARD
  MOVED_TO_BACKLOG
  DROPPED_FOR_TODAY
}
```
Mirrors the existing `TaskStatus`/`AssignmentStatus` enum style exactly.

### New model: `Workday`
| Field | Type | Nullable | Default | Index | Unique | FK | Why |
|---|---|---|---|---|---|---|---|
| `id` | String (uuid) | No | `uuid()` | — | PK | — | Standard convention throughout this schema |
| `userId` | String | No | — | — | part of compound unique | → `User.id`, `onDelete: Cascade` | A day belongs to exactly one user; if the user is ever deleted, their daily-plan history goes with them, same reasoning as `Workspace.ownerUserId`'s cascade |
| `workDate` | `DateTime @db.Date` | No | — | — | part of compound unique | — | The user's **local** calendar date, no time component — computed at write time from `User.defaultTimezone` (see §31), never from raw server `now()` alone |
| `startedAt` | DateTime | Yes | — | — | — | — | Set once, lazily, on first engagement with that day (§5) |
| `closedAt` | DateTime | Yes | — | — | — | — | Set once, only by a successful, fully-validated Close (§8) |
| `reflectionNote` | String | Yes | — | — | — | — | Optional free text captured at Close |
| `createdAt` | DateTime | No | `now()` | — | — | — | Standard convention |

`@@unique([userId, workDate])` — exactly one `Workday` per user per local day; this is
also the natural lookup index, so no separate `@@index` is needed.

### New model: `DailyPlanItem`
| Field | Type | Nullable | Default | Index | Unique | FK | Why |
|---|---|---|---|---|---|---|---|
| `id` | String (uuid) | No | `uuid()` | — | PK | — | — |
| `workdayId` | String | No | — | part of `@@index([workdayId, position])` | part of compound unique | → `Workday.id`, `onDelete: Cascade` | Deleting a `Workday` (never expected in practice, but structurally correct) removes its items |
| `taskId` | String | No | — | `@@index([taskId])` | part of compound unique | → `Task.id`, `onDelete: Cascade` | References the existing Task — never a copy of its data (§13) |
| `status` | `DailyPlanItemStatus` | No | `PLANNED` | — | — | — | The daily-plan-local status (§10) |
| `position` | Int | No | `0` | part of `@@index([workdayId, position])` | — | — | App-assigned ordering within the day; reordering is a normal update, no gap-management needed at this scale |
| `isUnplanned` | Boolean | No | `false` | — | — | — | User-declared, not clock-inferred (§18) |
| `plannedDurationMinutes` | Int | Yes | — | — | — | — | Day-specific estimate, distinct from `Task.estimatedDurationMinutes` (§13) |
| `scheduledStart` | DateTime | Yes | — | — | — | — | Optional intended time window (§16) |
| `scheduledEnd` | DateTime | Yes | — | — | — | — | Same |
| `startedAt` | DateTime | Yes | — | — | — | — | First "Start" press (§7/§17) |
| `completedAt` | DateTime | Yes | — | — | — | — | "Complete" press (§7/§17) |
| `carriedFromItemId` | String | Yes | — | — | — | → `DailyPlanItem.id` (self, `@relation("CarryForwardChain")`), `onDelete: SetNull` | Points at the prior day's item this one continues from (§19) |
| `carriedToItemId` | String | Yes | — | — | `@unique` | → `DailyPlanItem.id` (self, same relation), `onDelete: SetNull` | Points at the successor item created when this one was carried forward; unique because a row is carried forward at most once |
| `createdAt` | DateTime | No | `now()` | — | — | — | — |
| `updatedAt` | DateTime | No | `@updatedAt` | — | — | — | — |

`@@unique([workdayId, taskId])` — a task can appear **at most once per specific day's
plan** (prevents duplicate planning the same day) while remaining fully plannable again on
a **different** day, since `workdayId` differs (§12 of the brief's exact requirement).

### Additive column on `User`
| Field | Type | Nullable | Default | Why |
|---|---|---|---|---|
| `workingHours` | Json | Yes | — | Optional per-weekday `{start,end}` in `"HH:mm"`; `null` means "use the system default (Mon–Fri, 09:00–17:00)" applied in application code, never enforced as a hard boundary — advisory input to capacity math only (§16) |

A dedicated `UserWorkingHours` table was considered and rejected — see §36.

### Additive column on `AuditLog`
| Field | Type | Nullable | Default | Index | FK | Why |
|---|---|---|---|---|---|---|
| `workdayId` | String | Yes | — | `@@index([workdayId, createdAt])` | → `Workday.id`, `onDelete: SetNull` | Third use of the exact `taskId`/`projectId` pattern (doc 15, doc 17 §6.7) — a day's full activity history becomes one indexed query, never a parallel log |

**Total migration footprint:** 1 new enum, 2 new tables (4 new indexes/constraints
total, all covered above), 1 new nullable JSON column, 1 new nullable FK column. No
`ALTER ... DROP`, no data migration, no backfill required (every existing row is
unaffected — daily plans start empty for everyone).

---

## 13. Task Relationship

```
Task (existing, unchanged, sole source of truth)
   ↓  referenced by taskId (FK, never copied)
DailyPlanItem  — "this task is on my plan for this specific day"
```

**Never** `Task → Copied Daily Task`. `DailyPlanItem` carries zero duplicated task fields
(no title, no status, no priority copy) — every read joins back to the live `Task` row, so
a task's title/status/priority is always current, never stale.

**Relationship cardinality, explicitly per the brief's questions:**
- **One task planned on one day**: yes — enforced by `@@unique([workdayId, taskId])`.
- **Same task rescheduled across multiple days**: yes — a distinct `DailyPlanItem` row
  per `Workday`, linked in a chain via `carriedFromItemId`/`carriedToItemId` when moved by
  Close, or simply independently added again on another day if the user re-plans it
  without going through the carry-forward mechanism (e.g., replanned three weeks later,
  unrelated to any carry chain).
- **Multiple planning records / history preserved**: yes — old rows are never deleted or
  overwritten by a carry-forward; they transition to a terminal status
  (`CARRIED_FORWARD`/`MOVED_TO_BACKLOG`/`DROPPED_FOR_TODAY`/`COMPLETED_TODAY`) and stay
  exactly where they are, forming a readable history per task or per day.
- **Only one *active* plan entry** per task per day: yes, by the same unique constraint —
  but a task can have exactly one active (non-terminal) item on *today's* plan and,
  independently, one on a *future* day's plan (e.g., planned today and also pre-scheduled
  for a specific date next week) — the uniqueness is per-day, not per-task-globally.

`plannedDurationMinutes` on `DailyPlanItem` is deliberately separate from
`Task.estimatedDurationMinutes`: the task's field is a general, set-once default; the
plan item's field is "what I actually expect to spend on it *today*" and can legitimately
differ (e.g., a large task estimated at 8 hours might have `plannedDurationMinutes=60` for
today's slice of it).

---

## 14. Assignment Interaction

| Event | Effect on Inbox | Effect on Today/Plan | Effect on Carry-Forward |
|---|---|---|---|
| New task assigned to user | Appears in Inbox once accepted (unchanged `MY_TASKS` definition) | No automatic effect — must be deliberately added | N/A |
| Assignment accepted | Moves Task into the accepted-assignment set, i.e., Inbox-eligible | No automatic effect | N/A |
| Assignment declined | Leaves Inbox (no longer the user's current assignment) | Any existing `DailyPlanItem` for it becomes stale — flagged `ownershipLost` (derived, not stored) at read time, requiring resolution at next Close, same as any other unfinished item — never silently deleted | N/A |
| Task reassigned away mid-day | Same as decline — the user is no longer current assignee | Same `ownershipLost` flag | If it was mid-carry-chain, the chain simply stops (no successor is created for a task the user no longer owns) |
| Task completed (via the existing review flow) | N/A (no longer relevant) | `DailyPlanItem` for it, if any, is **auto-exempted** from requiring a Close disposition (§8) — the task's own resolution already answers the question | N/A |
| Task cancelled | Same as completed | Same auto-exemption | N/A |
| Task becomes overdue | No effect on Inbox membership | No automatic effect on any `DailyPlanItem` — overdue is a `Task.dueDate` fact, read (not written) by daily-plan views | N/A |

**`TaskAssignment` semantics are completely unchanged.** Daily planning only ever *reads*
assignment state to decide (a) what's eligible for Inbox and (b) whether an existing plan
item's ownership has silently shifted underneath it — it never writes to `TaskAssignment`
directly. The only writes into the assignment/task system from anywhere in Phase 3 are the
explicit, opt-in "Submit"/"Delegate"/"Cancel" convenience buttons in EXECUTE/CLOSE, and
those call the exact existing, unmodified APIs a human could call from the task detail
page today.

---

## 15. Project Interaction

A Project/Event remains purely **context**, exactly as doc 17 established. `DailyPlanItem`
has no `projectId` column — project context is always derived via
`DailyPlanItem.task.projectId → Project`. Today/Work screens show a task's project as a
small label/badge (name + kind), sourced from the same join every other task-listing
surface (dashboard, `/tasks`, project detail's Tasks tab) already performs. A task planned
today from a personal workspace, an organization workspace, or any project all flow
through the identical `DailyPlanItem` row shape — there is no special case for project
membership in the daily-plan layer, matching the brief's explicit instruction that daily
work should reference tasks "regardless of whether they belong to personal / organization
/ project / team."

---

## 16. Capacity Model

**Minimum abstraction, not a calendar:**

```
dailyCapacityMinutes(user, date) =
    workingMinutesForWeekday(user.workingHours, date.weekday())   // configurable, default 8h Mon–Fri
```

```
plannedMinutes(workday) =
    Σ (item.plannedDurationMinutes ?? item.task.estimatedDurationMinutes ?? 0)
      for every non-terminal item on that Workday
```

The PLAN screen shows `plannedMinutes` against `dailyCapacityMinutes` as a simple
over/under indicator — **advisory, never a hard block**. No breaks modeling, no meeting
subtraction (no calendar integration exists yet — §23), no multi-shift complexity.

**Explicitly avoiding the two named traps:**
- **Not hardcoding 9–5**: `User.workingHours` (nullable JSON, §12) lets a user configure
  per-weekday hours; the system default (used when `null`) is Mon–Fri 09:00–17:00, applied
  in application code, not baked into the schema or any constraint.
- **Timezone**: capacity math always resolves "what weekday is `date` in the user's own
  timezone," using `User.defaultTimezone` — the same utility used for `Workday.workDate`
  itself (§31), so the two can never disagree.

**Forward-compatible with Calendar (§23):** once real calendar events exist, capacity
becomes `workingMinutes - Σ(meeting durations)` — a pure addition to the same formula, no
schema change to `Workday`/`DailyPlanItem` required.

---

## 17. Time Tracking Model

**Deliberately minimal, matching doc 18's own recommendation to defer full time tracking.**

- `plannedDurationMinutes` (per `DailyPlanItem`) = the **estimate** for today's slice of
  work.
- `startedAt`/`completedAt` (per `DailyPlanItem`) = one coarse **actual** elapsed-time
  signal (`completedAt - startedAt`), sufficient for a future "estimated vs actual" report
  or AI signal (doc 18 §6, capability #4) without building session history.
- **No `WorkSession` table, no pause/resume persistence, no multi-session accumulation.**
  "Pause" is a UI-only concept in MVP (§7) — it does not stop or restart any stored clock.
  This means the actual-duration signal is honest but coarse: if a user starts a task,
  gets pulled away for two hours, and resumes, the recorded elapsed time includes the gap.
  This is an accepted, explicit tradeoff (§36) — accurate active-time tracking is real
  scope belonging to a dedicated Time Tracking phase, not Phase 3.

---

## 18. Unplanned Work

`DailyPlanItem.isUnplanned: Boolean`, set at creation time based on how the item was
added:
- Added during Plan, as part of the original set-up for the day → `false`
- Added any time via the "quick add" path (available in both Plan and Execute), where the
  user explicitly marks "this wasn't part of my plan" → `true`
- No clock-based inference (e.g., "added after 9am must be unplanned") — the flag is
  always a direct user declaration, kept deliberately simple.

This preserves exactly the distinction the brief calls out as important for future
AI/productivity analysis: **planned-vs-unplanned is a durable, queryable fact per item**,
not something reconstructed after the fact from timestamps.

**Acknowledgement interplay**: if the "urgent task from the manager" example in the brief
requires acceptance (it's a new `TaskAssignment`), the existing accept/decline flow runs
completely unchanged first; only *after* acceptance can it be added to today's plan as an
unplanned item — daily planning never bypasses or duplicates the acknowledgement gate.

---

## 19. Carry Forward

A **status transition plus a link**, not a new entity (§11):
1. At Close (or an early carry-forward from Plan), the user picks "carry forward" for an
   unresolved item, optionally choosing a target date (default: next calendar day).
2. A **new** `DailyPlanItem` is created on the target date's `Workday` (lazily created if
   it doesn't exist), referencing the **same `taskId`**, with `carriedFromItemId` pointing
   at the original.
3. The **original** item's `status` becomes `CARRIED_FORWARD` and its `carriedToItemId` is
   set to the new row's id.
4. Both rows persist forever — a task's full carry-forward chain is walkable via
   `carriedFromItemId`, which is exactly the "how many times has this been pushed" signal
   flagged as a useful future risk/reporting indicator (§26).

**Guarantee, per the brief's explicit requirement**: carry-forward is **only** ever the
result of a deliberate user action (Close's disposition, or Plan's early-carry action) —
there is no background job, cron, or automatic process in Phase 3 that moves anything
without the user having chosen it (the actual scheduler infrastructure for proactive
*reminders about* uncarried work is Phase 5's job, doc 18 §12, and remains a notification
suggestion, never an automatic data mutation).

---

## 20. API Architecture

Every route below follows existing conventions exactly: `withAuth`, Zod-validated
input, `{data,error}` envelope, `{items,nextCursor}` pagination where a list is unbounded.
**No route anywhere in this surface accepts a target user id** — every operation is
implicitly scoped to `getSessionUserId()`'s own data, eliminating the cross-user IDOR
class by construction (§27).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/me/workday?date=` | Read one day's `Workday` header (derived `NOT_STARTED`/`OPEN`/`CLOSED` status included), summary counts, and capacity. Defaults to today (user-local). Never creates a row. |
| POST | `/api/v1/me/workday/start?date=` | Idempotent: creates the `Workday` row if absent and sets `startedAt` if unset. Defaults to today. |
| GET | `/api/v1/me/workday/inbox` | Derived list: current accepted individual assignments minus tasks already on an open day's plan. Reuses `TaskService.listTasks(view: MY_TASKS)` under the hood. |
| GET | `/api/v1/me/workday/items?date=` | List `DailyPlanItem`s for a date, ordered by `position`, each joined with a lightweight Task summary (title, status, priority, dueDate, project). |
| POST | `/api/v1/me/workday/items` | Add a task to a day's plan. Body: `{taskId, date?, plannedDurationMinutes?, isUnplanned?}`. Lazily creates the `Workday`. Rejects (403) if the caller is not the task's current accepted individual assignee (§27). Rejects (409) if already planned that day (surfaces the unique-constraint violation as a clean error, not a raw DB error). |
| PATCH | `/api/v1/workday-items/:id` | Flat item route (matches `/project-dates/:id` convention) for non-transition edits: `position`, `plannedDurationMinutes`, `scheduledStart`/`scheduledEnd`. Resolves its own parent `Workday`/owner server-side; 403 if the caller doesn't own it. |
| POST | `/api/v1/workday-items/:id/start` | `status → IN_PROGRESS`, `startedAt = now()` if unset. |
| POST | `/api/v1/workday-items/:id/complete` | `status → COMPLETED_TODAY`, `completedAt = now()`. |
| DELETE | `/api/v1/workday-items/:id` | Un-plan — only permitted while `status=PLANNED` and `startedAt IS NULL` (i.e., before any execution began); otherwise 409, directing the caller to an explicit disposition instead (never a silent removal of touched work). |
| POST | `/api/v1/me/workday/close` | Body: `{dispositions: [{itemId, action: "CARRY_FORWARD"|"BACKLOG"|"DROP"|"COMPLETE", targetDate?}], reflectionNote?}`. Transactional; 422 with the exact list of unresolved items if any are missing a disposition. Sets `closedAt` only on full success. |
| GET | `/api/v1/me/workday/history?from=&to=` | Optional/MVP-adjacent (§33): a cursor-paginated browse of past `Workday`s, mostly future-reporting-facing; can ship in the same phase or slip to the first follow-up without blocking anything else. |

**Idempotency**: `start` and the item-transition endpoints (`start`/`complete`) are
naturally idempotent (re-POSTing after the state is already set is a harmless no-op, not
an error) — matching the existing codebase's general preference for idempotent-safe
mutations over strict single-fire semantics. `close` is **not** idempotent by design
(closing an already-closed day is a 409 — re-closing shouldn't silently re-apply
dispositions).

**Errors**: exactly the existing `ErrorCodes` set (`VALIDATION_ERROR`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, ...) — no new error taxonomy needed.

**Pagination**: `workday/items` for a single day is small enough to return unpaginated
(matches `project/:id/tasks`'s existing precedent); `workday/history` uses the standard
`{items,nextCursor}` shape, correcting rather than repeating the pagination inconsistency
doc 18 flagged (§31).

---

## 21. UI / Screen Map

New top-level nav entry: **Today** (placed first, ahead of Dashboard — it's the more
specific, more actionable version of "what should I do right now" that the Dashboard
currently answers only diffusely, per doc 18 §10). Dashboard, Tasks, Projects, Teams,
Organization, Notifications remain exactly as they are — Today is additive, not a
replacement screen.

| Screen | Answers | Contents |
|---|---|---|
| **Start** | "What's going on?" | Read-only situational summary (§5) — folds naturally into the top of the Today screen rather than requiring a fully separate route; a returning user mid-day sees Plan/Execute directly, a first-visit-of-the-day user sees Start's summary first |
| **Plan / Today** | "What am I doing today, and in what order?" | Inbox (left/side panel) + today's ordered `DailyPlanItem` list (main), add/reorder/estimate/schedule controls, capacity indicator |
| **Work / Execute** | "What should I be doing right this minute?" | NOW/NEXT/LATER grouping over the same item list, Start/Complete/Submit controls, quick-add for unplanned work |
| **Close / Review** | "What happened, and what happens to what's left?" | List of today's items pre-classified into resolved/unresolved, one disposition control per unresolved item, optional reflection note, a single Close action |

**Not a redesign of the whole app** — Today is one new screen (arguably one screen with
three scroll-sections/tabs: Plan, Work, Close, mirroring how the existing task detail page
uses tabs over one persistent header) plus a handful of small additions elsewhere (e.g., a
"+ Add to Today" affordance on `TaskCard`).

---

## 22. State Machine

As established in §4: the real, persisted state machine is small and honest.

```
Workday state (derived from two nullable timestamps, no stored enum needed):
  NOT_STARTED  (no Workday row exists yet for this user+date)
       │  any engagement with that date (lazy, implicit)
       ▼
  OPEN         (row exists, closedAt IS NULL)
       │  explicit, validated Close action
       ▼
  CLOSED       (closedAt IS NOT NULL)
```

`DailyPlanItem.status` (the `DailyPlanItemStatus` enum, §12) is the second, per-item state
machine, and **is** worth a small table-driven `canTransition`/`next*` module mirroring
`task-status.machine.ts`'s style:

```
PLANNED       → IN_PROGRESS (Start), MOVED_TO_BACKLOG/DROPPED_FOR_TODAY/CARRIED_FORWARD (Close disposition), [delete, only from here and only pre-start]
IN_PROGRESS   → COMPLETED_TODAY (Complete), MOVED_TO_BACKLOG/DROPPED_FOR_TODAY/CARRIED_FORWARD (Close disposition)
COMPLETED_TODAY, CARRIED_FORWARD, MOVED_TO_BACKLOG, DROPPED_FOR_TODAY → terminal, no further transitions
```

**Explicitly answering the brief's edge-case questions:**
- **Skip PLAN entirely, go straight to EXECUTE**: fully supported — adding a task via the
  "quick add" path from Execute lazily creates both the `Workday` and the item in one call;
  there is no gate requiring a "planning session" to have happened.
- **Start working immediately**: same as above — `Workday.startedAt` is set implicitly by
  the first touch of the day, whatever screen that happens on.
- **Work outside normal working hours**: fully supported — `workingHours` is advisory
  input to the capacity indicator only (§16), never an enforcement boundary; nothing
  blocks any action outside configured hours.
- **User does not close the day**: the `Workday` simply stays `OPEN` indefinitely. The
  next day's START (§5) surfaces it explicitly ("yesterday wasn't closed") rather than
  auto-closing it or losing it — the user remains in control, matching §9's "do not
  silently move" rule extended to the meta-level of the day itself.
- **Weekends/non-working days**: no special-cased "non-working day" flag anywhere — a
  `Workday` is created lazily only if the user actually engages that day; a weekend with
  zero engagement simply has no row, which is the correct, cost-free default. If a user
  *does* work on a Saturday, it behaves identically to any other day.

---

## 23. Calendar Compatibility

Phase 3 deliberately creates **no** `CalendarEvent`/`Meeting` model — that naming space is
reserved for the future Calendar phase, and this report explicitly avoids the kind of
naming collision doc 17 had to resolve for "Workspace" (`Project.kind=EVENT` already uses
"Event" for something unrelated — a one-off occasion project, not a calendar meeting;
Phase 3 and any future Calendar phase must keep these conceptually distinct in
documentation even though the words are similar).

What Phase 3 provides that Calendar can build on directly, with **no schema change**
required later:
- `DailyPlanItem.scheduledStart`/`scheduledEnd` — a real time-window Calendar can plot
  today's planned work against.
- `Workday.workDate` — a stable per-user local-day anchor Calendar's day/week grid can key
  off of.
- The capacity formula (§16) — designed to extend by simply subtracting meeting durations
  once meetings exist, with zero change to how `dailyCapacityMinutes` is computed for
  non-calendar callers.

---

## 24. AI Compatibility

Directly extends doc 18 §6's findings. Every future AI daily-planning capability listed
there — "Plan my day," "What's most important today," "Move my unfinished work to
tomorrow," "Why am I overloaded," "What should I work on next," "Summarize my day," "Which
work is at risk" — now has a concrete data home:

- **"Plan my day"** would read Inbox + capacity + deadlines and **write through the exact
  same `POST /me/workday/items` API a human uses**, validated by the same Zod schema —
  never a privileged AI-only write path, matching the established `createTaskSchema`
  precedent (doc 18 §6).
- **"Why am I overloaded"** reads `plannedMinutes` vs `dailyCapacityMinutes` (§16) —
  already computed, no new data needed.
- **"Which work is at risk"** reads the carry-forward chain depth per task
  (`carriedFromItemId` walk, §19) — a task carried forward three times running is a
  concrete, queryable signal, not something an AI would have to infer from scratch.
- **"Summarize my day"** reads today's `DailyPlanItem`s + their `startedAt`/`completedAt` +
  `AuditLog.workdayId` entries — everything already exists.
- **"Move my unfinished work to tomorrow"** is literally the Close disposition flow,
  callable by an AI assistant the same way a human triggers it from the Close screen.

**No AI is implemented in this phase.** This section exists solely to confirm the schema
in §12 is sufficient — it is, for every capability listed, without modification.

---

## 25. Mobile Compatibility

Directly corrects, rather than repeats, the two gaps doc 18 §7 flagged:
- **Pagination**: `workday/history` uses the standard `{items,nextCursor}` shape from day
  one (§20) — no new inconsistency added.
- **Auth**: Phase 3's API surface has no special auth requirement beyond what
  `withAuth` already provides — it will automatically benefit once doc 18's Phase 8
  (bearer-token support) lands, with zero Phase-3-specific rework needed.
- **Payload size**: `workday/items` for one day is inherently small (a person plans a
  handful of tasks, not hundreds) — no pagination needed there, keeping the mobile
  round-trip cheap by construction.
- **Offline**: explicitly not addressed (matches doc 18's explicit "don't over-build"
  guidance) — a thin online-only mobile client against this API is sufficient for a first
  release.

---

## 26. Reporting Compatibility

Signals this phase makes available for **future** reporting/BI (not built now, per the
brief's explicit instruction):
- Planned vs. completed-today counts, per user/day
- Unplanned-work ratio (count of `isUnplanned=true` items vs. total)
- Carry-forward count per task (chain depth) and per user/day (a stuck-work / overload
  signal)
- Estimated (`plannedDurationMinutes`) vs. actual (`completedAt - startedAt`) delta —
  coarse, but real
- Workday open-but-never-closed rate — a product-health signal (are people actually using
  Close)

All of these are simple aggregate queries over the two new tables — no new storage, no BI
system, no dashboard is being built in this phase.

---

## 27. Authorization

**The simplest authorization surface added by any phase so far**, because the scope is
deliberately narrow: **daily planning is personal by default, full stop, for Phase 3.**

- Every route in §20 resolves the acting user from the session (`getSessionUserId()`) and
  operates **exclusively** on that user's own `Workday`/`DailyPlanItem` rows. **No route
  accepts a target user id parameter anywhere.** There is structurally no way to construct
  a request that touches another user's daily plan — not a permission check that could
  have a bug, an absence of the capability entirely.
- Adding a task to a plan additionally requires the caller be that task's **current
  accepted individual assignee** — reusing `TaskService`'s existing assignment data, not a
  new predicate. This specifically prevents a manager who merely has view access (via
  `REPORTS_VIEW`) from adding a subordinate's task to their *own* plan as if it were their
  work.
- A manager's **future** ability to *view* (never modify) a team member's daily plan for
  reporting purposes is explicitly named as out of scope for Phase 3 (§34) and, when
  built, must be a read-only extension gated by the existing `REPORTS_VIEW` permission
  composed the same way team/org dashboards already are — never a default capability.
- Item-level routes (`/workday-items/:id`) resolve their owning `Workday`/user server-side
  from the item id and 403 if the caller isn't that `Workday`'s owner — exactly the same
  "resolve parent server-side, never trust a client-supplied ownership claim" discipline
  every existing flat item route (`/messages/:id`, `/project-dates/:id`) already follows.
- Deleted/reassigned-away tasks: covered in §14 (`ownershipLost` flag, never a silent
  removal or an authorization bypass).
- Timezone manipulation: `workDate` is always computed server-side from
  `User.defaultTimezone` (or a server-validated override, if ever exposed) — never taken
  as a raw client-supplied date string without going through that computation, preventing
  a client from claiming an arbitrary "today" to duplicate-plan across day boundaries.
- Duplicate planning: prevented at the database level (`@@unique([workdayId, taskId])`),
  not just in application logic — a genuine second layer of defense for this specific
  invariant.

---

## 28. Security Analysis

- **IDOR**: eliminated by construction for the cross-user case (no target-user parameter
  exists anywhere in the API); item-level routes re-derive ownership server-side, matching
  every existing flat-item-route precedent.
- **Tenant isolation**: inherited for free — a `DailyPlanItem` can only ever reference a
  task the caller is already the accepted assignee of, and task-level tenant isolation is
  already fully enforced and tested; Phase 3 adds no new tenant boundary to get wrong.
  Should a manager-reporting extension arrive later, it will need its own dedicated E2E
  coverage the same way every prior phase's reporting reused predicates got.
- **Cross-user planning attempts**: structurally impossible via the described API surface
  (no id param); explicitly worth one dedicated adversarial E2E test anyway (§30), since
  "the design prevents it" should always still be verified, not just asserted.
- **Deleted users**: `Workday.userId`'s `onDelete: Cascade` means a deleted user's daily
  plan data is removed with them — consistent with `Workspace.ownerUserId`'s existing
  cascade reasoning; no orphaned personal data survives a user's deletion.
- **Deleted tasks**: tasks are never hard-deleted in this codebase (only cancelled) — the
  `onDelete: Cascade` on `DailyPlanItem.taskId` is a structural safety net for an
  unreachable case today, not an active path (matches the existing codebase's own stated
  reasoning for similar theoretical-only cascades).
- **Unauthorized time records**: `startedAt`/`completedAt` are set only by the owning
  user's own action, through their own authenticated session — no endpoint accepts a
  caller-supplied timestamp for these fields (always `now()` server-side), preventing
  falsified time entries.
- **Duplicate planning**: DB-level unique constraint, not just application logic (defense
  in depth for this one specific, easy-to-get-subtly-wrong invariant).

**No new class of risk is introduced beyond what already exists in the codebase (the
already-documented absence of Postgres RLS, rate limiting, etc. — doc 18 §8) — Phase 3
does not make any existing gap worse, and its own attack surface is smaller than any prior
phase's because of the no-target-user design choice.**

---

## 29. Performance

- **Today screen** (`GET /me/workday` + `/items`): two queries — one `Workday` lookup by
  the `(userId, workDate)` unique index, one `DailyPlanItem.findMany` by the
  `(workdayId, position)` index with a `include: { task: { select: {...} } }` — a single
  join, not N+1, mirroring how `TASK_DETAIL_INCLUDE`-style single-query patterns are used
  everywhere else in this codebase. Row count per day is inherently small (a person's
  daily plan, not an unbounded list), so no pagination is needed on this specific
  endpoint.
- **Inbox**: reuses `TaskService.listTasks(view: MY_TASKS)` unchanged — already exercised
  in production-shaped E2E tests today, known-performant at current scale.
- **Close**: one transaction, bounded by the number of unresolved items in a single day
  (small, human-scale) — no risk of a large batch operation.
- **New indexes added**: `Workday(userId, workDate)` unique, `DailyPlanItem(workdayId,
  taskId)` unique, `DailyPlanItem(workdayId, position)`, `DailyPlanItem(taskId)`,
  `AuditLog(workdayId, createdAt)` — all directly serve the query patterns above, none
  speculative.
- **No N+1 risk identified** — every list read in this design is a single `findMany` with
  an `include`, not a loop issuing per-row queries.

---

## 30. Testing Strategy

**Unit** (mirroring `task-status.machine.test.ts`'s style): the new `DailyPlanItemStatus`
transition table (valid/invalid transitions), the day-boundary/timezone utility (a date
near midnight in various timezones resolves to the correct local day), the capacity
formula (default hours, configured hours, weekday variation), and the carry-forward chain
walk.

**E2E** (extending `tests/e2e/abc-college.e2e.test.ts` in the same narrative style),
specifically covering every case the brief calls out by name:
1. A task that's assigned and accepted does **not** appear on Today until explicitly added
   — Inbox vs Today distinction holds.
2. Adding a task to today's plan, then attempting to add the **same task on the same
   day** again → rejected (409), the unique constraint holds.
3. The **same task planned on two different days** → both succeed independently.
4. An unplanned task added mid-day is correctly flagged `isUnplanned=true` and shows
   distinctly from planned items.
5. Carry-forward at Close creates a correctly-linked successor item on the target day, and
   the original becomes `CARRIED_FORWARD` — history readable on both ends.
6. Attempting to Close a day with unresolved items and an **incomplete** dispositions list
   → rejected (422), naming exactly which items remain.
7. A task completed via the existing review flow **outside** the daily-plan layer is
   correctly auto-exempted from requiring a Close disposition.
8. A task reassigned away from the user mid-day: their existing `DailyPlanItem` for it is
   flagged `ownershipLost` on read, and still requires a disposition at Close (never
   silently vanishes).
9. **Timezone boundary**: a user with a non-UTC `defaultTimezone` gets the correct local
   `workDate` for an action taken near their local midnight, distinct from what a naive
   UTC computation would produce — this is the single most important test in the whole
   suite, directly verifying the brief's §11 warning is actually satisfied.
10. **Cross-user access attempt**: User B attempts to read or modify User A's `Workday`
    or `DailyPlanItem` (by guessing/enumerating an id) → 403/404, never 200, and never
    leaks the existence of A's plan contents.
11. A **project-scoped** task and a **personal-workspace** task both plan, execute, and
    close identically — no special-casing leaks through.
12. A **team-assigned** task that's still team-pending (not yet distributed to an
    individual) **cannot** be added to anyone's daily plan — only the eventual accepted
    individual assignee can, directly extending the exact "team-pending ≠ individually
    owned" principle Phase 2B/2C already established and tested at the conversation/file
    layer.
13. Un-planning (`DELETE /workday-items/:id`) succeeds while `status=PLANNED` and untouched,
    and correctly **fails (409)** once the item has been started, directing the caller to
    an explicit disposition instead.
14. Full Phase 1/2A/2B/2C regression — the entire existing 84-scenario suite reruns
    unmodified and green, proving Phase 3 changed nothing underneath it (matching every
    prior phase's own completion gate).

**Security-specific**: #6, #9, #10, #12 above are the dedicated adversarial/edge-case
tests, run explicitly, not just incidentally covered by the happy-path scenarios.

---

## 31. Architectural Debt

**MUST FIX BEFORE PHASE 3:** none. Phase 3 is fully buildable on the current foundation —
nothing existing structurally blocks it.

**SHOULD FIX DURING PHASE 3** (small, and directly relevant — building the correct
day-boundary utility for `Workday.workDate` and *not* also fixing the pre-existing bug it
sits right next to would leave two disagreeing definitions of "today" in the same
product):
- Wire `User.defaultTimezone` into a shared `resolveLocalDate(user, instant)` utility
  (new, small, in `packages/domain`) and use it both for `Workday.workDate` computation
  **and** to correct `ReportingService`'s existing `bucketByDueDate`
  (`startOfDay`/`endOfDay`, currently server-`now()`-based) — one utility, two call sites,
  eliminates a real, already-shipped inconsistency at essentially no extra cost.

**CAN DEFER** (unrelated to Phase 3, correctly out of scope here, already tracked in doc
18 §13): `TaskComment` cleanup, `TaskDependency`/`TaskTag` cleanup, the broken
`test:integration` script, pagination inconsistencies on *other* existing endpoints
(comments/updates/project members) — Phase 3 does not touch or worsen any of these, and
fixing them isn't a precondition for anything proposed here.

---

## 32. Implementation Sequence

Each step gates the next, matching the phase-2C precedent (schema → domain → API → UI →
tests → audit).

**Step 1 — Database foundation.** Scope: the enum, two tables, the `User.workingHours`
column, the `AuditLog.workdayId` column; one additive migration, verified against a copy
of production-shaped data for zero data loss (same discipline as every prior migration in
this repo). Dependencies: none. Tests: migration applies cleanly, existing row counts
unchanged. Security checks: confirm no RLS claim is implied (there is none anywhere yet —
consistent with the rest of the schema). Acceptance: `prisma migrate status` clean, no
existing test regresses.

**Step 2 — Domain services.** Scope: `resolveLocalDate` utility (§31), the
`DailyPlanItemStatus` transition table (mirroring `task-status.machine.ts`), a new
`DailyWorkService` (start/close/add-item/transition-item/inbox/capacity), reusing
`TaskService`/`PermissionService` exactly as `ProjectService` reused them in Phase 2C —
never re-deriving task visibility from scratch. Dependencies: Step 1. Tests: unit tests
for the utility and the transition table (§30). Security checks: confirm `DailyWorkService`
never accepts a target-user parameter anywhere in its public method signatures (the
authorization guarantee from §27 needs to hold at the service layer, not just be a
route-layer accident). Acceptance: `npm run test -w packages/domain` green, no regression.

**Step 3 — API routes.** Scope: the full route list in §20. Dependencies: Step 2. Tests:
route-level Zod validation smoke-checked. Security checks: re-verify every route resolves
`actorId` from the session and never from a request parameter/body. Acceptance: full
monorepo typecheck/lint/build green.

**Step 4 — START.** Scope: the read-only situational view (§5), folded into the top of
the new Today screen. Dependencies: Step 3. Tests: E2E scenario for a fresh day showing
overdue/pending/carried-in items correctly. Acceptance: manually verified against a
seeded multi-day scenario.

**Step 5 — PLAN.** Scope: Inbox + add/reorder/estimate/schedule UI. Dependencies: Step 4.
Tests: E2E #1–#4, #11–#12 from §30. Acceptance: a user can go from an empty day to a
populated, ordered plan entirely through the UI.

**Step 6 — EXECUTE.** Scope: NOW/NEXT/LATER, Start/Complete/Submit, quick-add. Dependencies:
Step 5. Tests: E2E for start/complete transitions, the Submit-calls-existing-API path.
Acceptance: completing an item never touches `Task.status` except via the explicit Submit
shortcut, verified directly.

**Step 7 — CLOSE + Tomorrow Ready.** Scope: the close flow, dispositions, reflection note,
next-day carry-forward visibility. Dependencies: Step 6. Tests: E2E #5–#8, #13 from §30.
Acceptance: an incomplete-disposition close is rejected; a complete one succeeds and the
next day's START correctly shows the carried items.

**Step 8 — Tests/security hardening pass.** Scope: the full §30 matrix run together,
including the full existing 84-scenario regression suite. Dependencies: Steps 1–7.
Acceptance: 100% pass, matching every prior phase's own gate.

**Step 9 — Production-shaped quality gate.** Scope: full monorepo typecheck/lint/build,
fresh-build E2E rerun, a dedicated self-audit pass (matching Phase 2C's own process —
including the notification-payload-style regression check: did anything reuse an existing
naming convention incorrectly). Acceptance: identical bar to every previous phase's commit
gate — nothing merges without it.

---

## 33. MVP Scope

- `Workday` + `DailyPlanItem` + the one new enum, exactly as in §12
- `User.workingHours` (nullable, with a code-level default)
- `AuditLog.workdayId`
- The full API surface in §20, **including** `workday/history` (cheap, and directly
  useful for START's "what happened recently" and for §26's future reporting — no reason
  to hold it back)
- Start / Plan / Work / Close screens as one cohesive Today experience
- The `resolveLocalDate` timezone fix, applied to both the new feature and the existing
  dashboard bucket logic (§31)

---

## 34. Deferred Scope

- `WorkSession`/pause-resume persistence and any real time-tracking reporting (§17) —
  belongs to a dedicated Time Tracking phase, per doc 18's own recommendation
- Any calendar event/meeting model, external calendar sync (§23)
- Manager/team read-only visibility into another user's daily plan (§27) — a genuine,
  reasonable future need, explicitly deferred as its own small, separately-reviewed
  extension once actually requested
- Recurring tasks/automation (not present anywhere in the codebase today; Phase 3 doesn't
  need or introduce them)
- Any AI feature (§24 is compatibility analysis only)
- Push/email delivery of any daily-work notification (§15's design-only reminders wait on
  doc 18's Phase 5 scheduler)

---

## 35. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Timezone utility has an off-by-one/DST edge case | Medium | Medium — wrong "today" boundary for affected users | Dedicated unit + E2E timezone-boundary tests (§30 #9) before this ships, not after |
| Users find the Close-disposition requirement annoying/rigid | Medium | Low-Medium — could suppress Close usage | The requirement is scoped tightly (only *unresolved* items need a disposition; completed/cancelled tasks are auto-exempted) and Close itself is optional to invoke at all — a day that's never closed simply carries forward as "still open," not blocked |
| Scope creep into a full time-tracking or calendar system during implementation | Medium | Medium — schedule risk | §17/§23/§34 explicitly bound scope; this report is the reference point to hold the line against during Step-by-step implementation |
| Capacity indicator is misread as a hard limit rather than advisory | Low | Low | UI copy/design concern, not an architecture one — flag for the implementation phase's UX pass |

---

## 36. Alternatives Considered

- **A separate `WorkSession` table with full pause/resume history**, considered and
  rejected for MVP: real value for accurate time analytics, but meaningful additional
  scope (session start/stop event log, aggregation logic) for a signal nobody has asked
  for yet — exactly the over-engineering trap doc 18 §14 warns against. `startedAt`/
  `completedAt` on `DailyPlanItem` gives 80% of the value at a fraction of the cost;
  revisit if/when a dedicated Time Tracking phase is actually justified by demand.
- **A dedicated `UserWorkingHours` table** (instead of a JSON column on `User`),
  considered and rejected: no product need for more than one active working-hours profile
  per user in MVP (no shift-scheduling, no multi-profile requirement anywhere in the
  brief) — a nullable JSON column is the minimum correct model; a real table becomes
  worth it only if/when per-team or per-role working-hours templates are needed.
- **A rigid, gated five-state `WorkdayStatus` state machine** (START must complete before
  PLAN unlocks, etc.), considered and explicitly rejected per the brief's own instruction
  ("avoid making the workflow unnecessarily rigid") — the two-timestamp
  (`startedAt`/`closedAt`) model in §22 achieves the same conceptual cycle without forcing
  a false linear order onto how people actually work.
- **Storing daily-plan "stage" as an explicit enum column on `Workday`** (`NOT_STARTED |
  PLANNING | EXECUTING | CLOSED`), considered and rejected in favor of deriving
  `NOT_STARTED`/`OPEN`/`CLOSED` from the two timestamps alone — PLAN vs EXECUTE was
  deliberately never made a stored distinction at all, since the brief itself treats them
  as views over the same underlying set of items, not separate real states; adding a
  column for it would create a value that could drift from the data it's supposedly
  describing.
- **Silently auto-carrying forward unfinished work** (no explicit Close action required),
  considered and firmly rejected — directly contradicts the brief's explicit "do NOT
  silently move unfinished tasks to tomorrow... the user should intentionally decide."
- **A `DailyPlanItem.organizationId` denormalized column** (matching `Conversation`'s
  denormalized `organizationId`), considered and deferred rather than added now: every
  Phase-3 query is already scoped by `workdayId → userId` (always the caller's own), so
  there's no current query pattern that needs it; add it if/when the deferred
  manager-visibility reporting extension (§34) is actually built and needs org-scoped
  aggregation.

---

## Final Product Decisions

1. **Smallest useful Phase 3**: `Workday` + `DailyPlanItem`, the four core screens
   (Start/Plan/Work/Close), and the timezone fix — exactly the MVP scope in §33. Nothing
   in that list is separable from "a working daily cycle"; everything not in it is
   genuinely deferrable.
2. **Should NOT be included**: real time-tracking sessions, any calendar/meeting model,
   manager visibility into others' plans, recurring work, any notification delivery
   beyond what already exists, any AI feature.
3. **Existing code reused, unchanged**: `TaskService` (visibility, `MY_TASKS`),
   `PermissionService`, `AuditService` (new optional column, same method signatures),
   the state-machine style/pattern, the `withAuth`/Zod/envelope API convention, the flat
   item-route convention, the existing task lifecycle and assignment engine in their
   entirety.
4. **New database entities genuinely required**: exactly two (`Workday`,
   `DailyPlanItem`) plus one enum — everything else in the brief's "concepts to consider"
   list folds into these two, as detailed in §11.
5. **New APIs genuinely required**: the eleven endpoints in §20 — no more, no fewer;
   `workday/history` is the only "nice to have" among them and is cheap enough to include
   rather than cut.
6. **New screens genuinely required**: one cohesive Today experience covering
   Start/Plan/Work/Close (§21) — not four separate top-level pages.
7. **Security risks introduced**: minimal by design — no cross-user write surface exists
   at all; the main real risk is the timezone-boundary correctness of a brand-new utility,
   directly mitigated by dedicated tests (§30/§35).
8. **Architecture debt that must be fixed first**: none blocking; one small "should fix
   during" item (wiring `defaultTimezone` into a shared utility and correcting the
   existing dashboard's day-boundary logic alongside it, §31).
9. **Enables for Calendar**: `scheduledStart`/`scheduledEnd` and `Workday.workDate` as
   ready-made hooks, with zero schema rework needed when Calendar actually arrives (§23).
10. **Enables for AI**: every capability doc 18 §6 flagged as needing "a `DailyPlan`
    concept first" (daily planning, daily summary, follow-up generation, risk/overload
    detection) now has a concrete, sufficient data model, with zero further schema work
    (§24).
11. **Enables for Mobile**: corrects rather than repeats the pagination inconsistency
    doc 18 flagged, and adds no new auth requirement beyond what mobile already needs
    fixed elsewhere (doc 18 Phase 8) — Phase 3's API is mobile-ready from day one (§25).
12. **Enables for future Reporting**: planned-vs-completed, unplanned ratio,
    carry-forward depth, and estimate-vs-actual delta — four concrete, ready-to-query
    signals with zero new storage beyond what §12 already proposes (§26).

---

## 37. Final Recommendation

The proposed design adds the minimum schema (two tables, one enum, two additive columns)
needed to support a genuine daily-work cycle, reuses every existing subsystem (tasks,
assignments, permissions, audit log, state-machine style, API conventions) without
duplicating or weakening any of them, and closes rather than repeats an already-shipped
timezone bug. Its authorization model is simpler and structurally safer than any prior
phase's because the scope is deliberately, correctly narrow (personal-only, no
cross-user write surface). Every entity proposed was tested against "must this be a
table" and reduced to the minimum that actually needs persistence. The implementation
sequence (§32) follows the exact same schema → domain → API → UI → tests → audit
discipline that has produced a 100%-passing, 84-scenario E2E suite across three prior
phases.

READY FOR IMPLEMENTATION
