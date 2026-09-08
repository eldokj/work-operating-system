# Phase 4 Management Visibility & Work Graph Reporting Architecture

**Base commit:** `aeb569d` (branch `master`, `origin/master` synchronized). **Status:**
architecture only — no code, schema, migration, API, UI, or test exists yet for anything
in this document. Follows the same process as docs 17/19: investigation → proposal →
explicit approval required before any implementation.

---

## 1. Executive Summary

The Work Graph — `Task`, `TaskAssignment`, `Project`, `Conversation`, `Workday`,
`DailyPlanItem`, `AuditLog` — already contains every fact a manager needs. What's missing
is not data, it's **exposure**: `ReportingService`
(`packages/domain/src/services/reporting.service.ts`, 187 lines, 3 methods) has zero
references to `Conversation`, `TaskAttachment`, `Workday`, or `DailyPlanItem` (grep-
confirmed this session) — it was written before Phases 2A–3 existed and has never been
extended. This report designs the extension: new **query methods** on the existing
`ReportingService`, new **response fields** on the existing team/org dashboard routes,
and additive **UI sections** on the existing dashboard pages — **zero new tables, zero new
permissions, zero new authorization primitive.**

The permission model already has exactly the six role categories this phase needs
(`SUPER_ADMIN`, `ORG_ADMIN`, `DEPARTMENT_HEAD`, `TEAM_HEAD`, `MANAGER`, `MEMBER`, plus
`INDIVIDUAL_USER_PERMISSIONS` for personal workspaces) seeded today in
`packages/shared/src/permissions/permissions.catalog.ts` — this report maps visibility
onto them, it does not invent new ones. The central design discipline, stated once here
and enforced throughout: **reporting visibility is a projection of the Work Graph, never
a second source of truth, and never a backdoor into conversation/file access a role
doesn't independently hold.**

---

## 2. Current Reporting Capability

Verified directly against `reporting.service.ts` and its two consuming routes.

**`getPersonalDashboard(actorId, workspaceId)`** — composes `TaskService.listTasks(view:
MY_TASKS)`, buckets by due date using `localDayBounds` (Phase 3's timezone fix, correctly
reused here), adds `pendingAcceptance`/`waitingForReview` for org workspaces, and
`myProjects` via `ProjectService.listProjectsForUser`. Self-scoped only — no management
data.

**`getTeamDashboard(actorId, organizationId, teamId)`** — `GET
/api/v1/organizations/:orgId/reports/team/:teamId`
(`apps/web/app/api/v1/organizations/[orgId]/reports/team/[teamId]/route.ts`). Access:
team member OR `REPORTS_VIEW` at team/department scope (line 104-110). Returns
`unassigned`/`assigned`/`inProgress`/`overdue` task buckets (all in-memory `.filter()`
over one `listTasks(view: TEAM_TASKS)` call) and a `workload` array — **task count only**,
per member, computed by filtering the already-loaded task list per member id (line
127-136). Rendered at `apps/web/app/(app)/organizations/[orgId]/teams/[teamId]/page.tsx`
(not re-read in full this session; route confirmed wired from doc 18's investigation and
unchanged since).

**`getOrganizationDashboard(actorId, organizationId)`** — `GET
/api/v1/organizations/:orgId/reports/overview`. Access: org member + `REPORTS_VIEW`
(unscoped → org-wide). Returns total/overdue/pendingReview/completed counts, plus
`departmentPerformance`/`teamPerformance` — both computed by loading **every task in the
org** (`listTasks(view: ALL)`) into memory once, then `.filter()`-ing it once per
department and once per team (lines 153-175). Rendered at
`apps/web/app/(app)/organizations/[orgId]/page.tsx`'s `OverviewTab` — 4 stat cards + 2
plain tables, no drill-down links from the tables themselves.

**What is completely absent from all three methods, confirmed by direct inspection, not
inference:** any query touching `TaskAssignment.status = PENDING_ACKNOWLEDGEMENT` and its
age; any query touching `Workday`/`DailyPlanItem` at all; any query walking
`DailyPlanItem.carriedFromItemId`; any minutes-based (vs. count-based) capacity
aggregation; any per-person cross-team workload view; any `AuditLog` consumption for
trend/history (the org dashboard's `completionTrend` field is a same-instant ratio, not a
time series — `{ completedCount, totalCount }`, not a series of any kind).

---

## 3. Problem Definition

A Team Head, Department Head, or Org Admin opening the existing dashboards today can see
*what exists* (counts) but not *where attention is needed* (signal). The specific,
evidence-backed gap: Phase 3 committed exactly the data that would answer "who's
overloaded," "what's stuck," "what keeps slipping" — and none of it is read by anything
except the individual who wrote it (`daily-work.service.ts` is never imported by
`reporting.service.ts` or any report route — grep-confirmed). This phase closes that gap
by extending, not replacing, the existing reporting surface.

---

## 4. Management Questions

Restating the brief's three tiers, each now mapped to a concrete data source verified to
exist (✓) or confirmed absent and requiring a new query, never new storage (→):

**Team level**
1. What work is active? ✓ `getTeamDashboard`'s `inProgress`/`assigned` buckets exist today.
2. What is overdue? ✓ exists today (`overdue` bucket).
3. What is awaiting acknowledgement? → `TaskAssignment` where `isCurrent=true,
   status=PENDING_ACKNOWLEDGEMENT` for the team's tasks — new query, existing table.
4. What is blocked/stuck? → **partially answerable only as "stuck in acknowledgement" and
   "repeatedly carried forward"** (§6) — `TaskDependency`-based "blocked" is out of scope
   (§21; the model is unused, §7 of doc 20, unchanged).
5. Who currently owns the work? ✓ `TaskAssignment.isCurrent` join, same attribution rule
   already implemented in `DailyWorkService.isCurrentOwner` (§7 of this report).
6. What workload is assigned to each person? → exists as a **count** today; extending to
   minutes (`DailyPlanItem.plannedDurationMinutes`/`Task.estimatedDurationMinutes`) is new
   query composition over existing columns.
7. What is planned for today? → `DailyPlanItem` for each member's current-day `Workday` —
   new query, existing table (Phase 3).
8. What remains unfinished? → `DailyPlanItem.status IN (PLANNED, IN_PROGRESS)` for a past,
   closed `Workday` — new query, existing table.
9. What is repeatedly carried forward? → walk `DailyPlanItem.carriedFromItemId` — new
   query, existing table, currently never read (§2).
10. How much work is unplanned? → `DailyPlanItem.isUnplanned` count/ratio — new query,
    existing column.

**Department level**
1-6 — all are the team-level metrics rolled up one level, using the exact same
`Department.id` → `Team[]` relation `getOrganizationDashboard` already traverses (line
164, `db.team.findMany({ where: { organizationId } })`, filterable by `departmentId`).

**Organization level** — per the brief's explicit instruction to include only reliably
computable metrics: org-wide totals of every team/department metric above. **No vanity
metrics** (§8 states exactly which are excluded and why).

---

## 5. Work Graph Data Sources

Every metric in this report is sourced from one of these six existing structures — no
seventh is proposed.

| Source | Fields used | Existing indexes |
|---|---|---|
| `Task` | `status`, `dueDate`, `originDepartmentId`, `originTeamId`, `estimatedDurationMinutes` | `@@index([workspaceId])`, `@@index([projectId])`, `@@index([status])`, `@@index([originOrganizationId])` |
| `TaskAssignment` | `isCurrent`, `status`, `assigneeType`, `assigneeUserId`, `assigneeTeamId`, `createdAt` | `@@index([taskId])`, `@@index([assigneeUserId])`, `@@index([assigneeTeamId])`, `@@index([taskId, isCurrent])` |
| `Workday` | `userId`, `workDate`, `closedAt` | `@@unique([userId, workDate])` |
| `DailyPlanItem` | `workdayId`, `status`, `isUnplanned`, `plannedDurationMinutes`, `carriedFromItemId` | `@@unique([workdayId, taskId])`, `@@index([workdayId, position])`, `@@index([taskId])`, `@@index([carriedFromItemId])` |
| `TeamMember` | `teamId`, `userId`, `isHead` | `@@unique([teamId, userId])`, `@@index([teamId])`, `@@index([userId])` |
| `AuditLog` | `action`, `taskId`/`workdayId`, `createdAt` | `@@index([taskId, createdAt])`, `@@index([workdayId, createdAt])`, `@@index([organizationId])` |

`Conversation`/`TaskAttachment` are **deliberately not** data sources for any metric in
this report — per §9, reporting must never expose conversation/file content or even
existence-of-content, only work-state metadata already visible through `Task`/
`TaskAssignment`.

---

## 6. Metric Definitions

Each metric: meaning, source, scope, permission boundary, timezone note, edge cases,
real-time vs. snapshot. All are **real-time** (§10) — none require a cache or a snapshot
table.

### Workload
**Meaning:** the set of tasks for which a person is the *current* accountable individual
assignee, plus (new) the sum of `plannedDurationMinutes`/`estimatedDurationMinutes` for
their currently-open `Workday`. **Source:** `TaskAssignment` where `isCurrent=true,
assigneeType=USER, assigneeUserId=X, status=ACCEPTED` (exactly `isCurrentOwner`'s existing
rule, `daily-work.service.ts` line ~262) joined with today's `DailyPlanItem`s for capacity.
**Scope:** team/department/org, always resolved to individual people within that scope.
**Permission boundary:** §9. **Timezone:** the *viewing* manager sees "today" in each
*subject* person's own local day (§10 — not the manager's), matching Phase 3's existing
principle that a day belongs to the person living it. **Edge cases:** a person who is a
member of multiple teams appears once per team in team-scoped views (a real cross-team
reality, not a bug) but exactly once in an org-wide workload view (deduplicated by
`userId`). **Not counted:** `PENDING_ACKNOWLEDGEMENT` assignments — those are "awaiting
acknowledgement" (a separate metric), not yet workload.

### Active Work
**Meaning:** tasks whose `status` is one of `ASSIGNED, IN_PROGRESS, SUBMITTED,
UNDER_REVIEW, CHANGES_REQUESTED` — i.e., everything except the terminal states
(`COMPLETED`, `CANCELLED`) and the not-yet-started state (`UNASSIGNED`, `DRAFT`). This is
identical to the state set doc 05's own lifecycle diagram treats as "in flight" and
requires no new definition — it is `TaskStatus` minus its own documented terminal/initial
states.

### Overdue
**Meaning:** `isOverdue(task.status, task.dueDate, now)` — the existing, unchanged
function in `packages/domain/src/state-machines/task-status.machine.ts` (`dueDate <
now`, excluding `COMPLETED`/`CANCELLED`). **Timezone:** `dueDate` is a `DateTime` (an
instant, not a date-only field, unlike `startDate`), so "overdue" is timezone-*neutral* by
construction — a deadline instant either has or hasn't passed, regardless of whose clock
is asked. No new timezone logic needed here; the only place timezone matters for this
metric is deciding what counts as "due **today**" (§9).

### Pending Acknowledgement
**Meaning:** `TaskAssignment` rows with `isCurrent=true, status=PENDING_ACKNOWLEDGEMENT`.
**"Stuck" (new, this phase's own addition):** the same set, filtered to `createdAt` older
than a threshold (§27 leaves the exact threshold an open, configurable-later question,
defaulting conceptually to something like 24-48h for the MVP). **Attribution:** for a
`TEAM`-type assignment, "stuck" attributes to the team (and, if useful, its Team Head);
for a `USER`-type assignment, to the individual.

### Carry Forward
**Meaning of "repeated":** a `DailyPlanItem` chain (walked via `carriedFromItemId`) with
length ≥ 2 — i.e., the same task has been pushed at least once already and is being
pushed again. **Source:** `DailyPlanItem` self-relation, walked per task, bounded by the
number of days that specific task has actually been planned (small in practice — a
person's daily plan is human-scale, doc 19 §29). **Scope:** always resolves to the
individual whose `Workday` the chain lives on; team/department/org views aggregate the
*count* of people/tasks with repeat chains, never the chain contents themselves (§8).

### Unplanned Work
**Meaning:** `DailyPlanItem.isUnplanned = true`, counted against total `DailyPlanItem`
count for the same day, per person — a ratio. **Source:** direct column read, Phase 3's
own field (doc 19 §18), user-declared, never inferred.

### Capacity
**Meaning:** identical formula to `daily-work.service.ts`'s existing
`computeCapacityMinutes` (advisory, `User.workingHours` with an 8h-Mon-Fri default) —
**this phase reuses that exact function, does not redefine it.** "Capacity pressure" (a
new, derived signal) = `plannedMinutes > capacityMinutes` for a person's current day,
aggregated as a count of over-capacity people per team.

### Completion
**Meaning:** `Task.status = COMPLETED` — the existing, single, unambiguous terminal
state (doc 05). No alternate definition is introduced (e.g., a `DailyPlanItem.status =
COMPLETED_TODAY` is explicitly **not** "task completion" — §7 draws this line precisely,
since a plan item can be marked done-for-today on a task that is still, correctly,
`IN_PROGRESS` at the task-lifecycle level).

---

## 7. Accountability Attribution

The brief's distinction — Creator / Assigner / Current Assignee / Assigned Team /
Executing User / Reviewer / Team Head / Task Owner — already exists structurally in
`Task`/`TaskAssignment` and is **already correctly used** by the one place in the
codebase that had to get this right before now: `DailyWorkService.isCurrentOwner`
(`daily-work.service.ts`), which defines "who may plan this task today" as *the current,
accepted, individual assignee* — never the creator, never the original assignor, never a
past assignee. **This report adopts that exact same rule as the sole definition of
"current accountable owner" for every workload/attribution metric.**

Concretely, from the existing schema:
- **Creator** — `Task.createdById` — used only for historical/origin reporting, never for
  current-workload attribution (per the brief's explicit instruction).
- **Original/Origin Assignor** — `Task.originAssignorId`/`originDepartmentId`/
  `originTeamId` — immutable once set (DB-trigger-enforced,
  `packages/db/prisma/migrations/20260906072700_.../migration.sql`), used for "where does
  work originate" reporting (§4 org-level), never for current ownership.
- **Current Assignee** — `TaskAssignment` where `isCurrent=true` — the sole source for
  "who owns this right now," exactly as `AssignmentService`/`TaskService.canViewTask`
  already treat it.
- **Assigned Team** — `TaskAssignment.assigneeType=TEAM, assigneeTeamId` when current —
  reported as team-level ownership until an individual has been distributed the work
  (`reassignInternal`), matching doc 06 §6.3's own distinction between team-level
  acceptance and individual execution.
- **Reviewer** — `TaskAssignment.assignedById` of the current assignment (the existing
  "designated reviewer" rule from `TaskService.isDesignatedReviewer`) — reused, not
  redefined, for a future "review load" metric (§22 SHOULD HAVE).
- **Team Head** — `TeamMember.isHead=true` — used to attribute team-level "stuck"
  assignments to a specific accountable person when useful (§6).

**Historical/lineage preservation:** `TaskAssignment.parentAssignmentId` already forms a
complete chain (doc 06 §6.2, `AssignmentService.getChain`) — this phase's origin-of-work
metric reads it read-only, never mutates or duplicates it.

---

## 8. Daily Work Cycle Integration

**Exactly which Phase 3 signals become visible to management, and which stay private** —
this is the most safety-critical design decision in this report.

**Visible as aggregate work metadata:**
- `DailyPlanItem` **count** per status, per person, per day (planned / in-progress /
  completed-today / carried-forward / dropped / backlog).
- `DailyPlanItem.plannedDurationMinutes` **sum**, and the derived capacity-pressure flag.
- `DailyPlanItem.isUnplanned` **count/ratio**.
- Carry-forward chain **length** (a number), not chain **contents**.
- `Workday.startedAt`/`closedAt` **presence** (did they start/close their day) — a
  process signal, not content.
- Which **task** (by id/title — already-permitted task metadata under §9's rule) is on a
  person's plan — this is task metadata the manager may already be entitled to see via
  the task graph itself, not new exposure.

**Explicitly private, never exposed through reporting:**
- `Workday.reflectionNote` — free-text, explicitly personal reflection (doc 19 §8
  describes it as "how did today go" — a journal entry, not a work-state fact). **No
  report at any scope ever reads this field.**
- Any derived "how did they feel about their day" signal — none exists, and none should
  be inferred from the reflection note even indirectly (e.g., sentiment analysis on it is
  explicitly out of scope, §22 DEFERRED).
- The *order* (`position`) a person chose to work through their day, and any
  `scheduledStart`/`scheduledEnd` they set for themselves — these are personal planning
  choices, not team-relevant facts, and are excluded from all management views.

**The line drawn, stated as a rule:** management visibility covers **what work exists and
what state it's in**, never **how a person is personally organizing or feeling about
their day**. This mirrors, at the Daily Work Cycle layer, the exact same
metadata-vs-content distinction §9 draws for conversations/files.

---

## 9. Permission & Visibility Model

**Core rule, stated once and enforced everywhere in this design: REPORTING VISIBILITY ≠
FULL TASK ACCESS.** A manager with `REPORTS_VIEW` at team scope sees aggregate/task-
metadata signals about that team's work; they do **not** automatically gain
`canAccessConversation`/`canViewTask`-level access to any individual task's conversation
or files. Those remain governed exclusively by `TaskService.canViewTask`
(`packages/domain/src/services/task.service.ts`) and
`conversation-access.ts`/`project-access.ts`, completely unchanged by this phase.

**Mapping the brief's role categories onto what's already seeded**
(`permissions.catalog.ts`'s `SYSTEM_ROLE_TEMPLATES`, verified this session — all six
categories the brief asks about already exist as system role templates, no new role is
needed):

| Role (existing template) | `REPORTS_VIEW`? | `AUDIT_VIEW`? | Visibility scope under this design |
|---|---|---|---|
| `SUPER_ADMIN` | Yes (all permissions) | Yes | Everything this phase defines, org-wide, for any org — reserved for platform operators, not typically granted per-org |
| `ORG_ADMIN` | Yes, unscoped (org-wide) | Yes | Full organization-level view: all departments, all teams, all people |
| `DEPARTMENT_HEAD` | Yes | **No** | Department-scoped: their department's teams and people, **not** the org-wide rollup, **not** the audit log |
| `TEAM_HEAD` | Yes | **No** | Team-scoped: their own team's people and work only |
| `MANAGER` | Yes | **No** | Scoped to wherever the grant places them (`UserRole.scopeType`/`scopeId` — could be a team or department, resolved by the existing `resolveEffectivePermissions` engine, not a new mechanism) |
| `MEMBER` | **No** | No | Self-scoped only — sees their own `getPersonalDashboard`, nothing about anyone else |
| `INDIVIDUAL_USER` (personal workspace) | N/A (`INDIVIDUAL_USER_PERMISSIONS` has no `REPORTS_VIEW`, and there is no "team" to report on) | N/A | Self only — this design does not apply to personal workspaces at all |

**How scope resolution actually works — reused, not reinvented:** every visibility check
in this phase calls `PermissionService.can(userId, organizationId, PERMISSIONS.REPORTS_VIEW,
{ teamId, departmentId })`, which delegates to `resolveEffectivePermissions`
(`resolve-scope.ts`) — the exact same department-path-inheritance-aware, team-exact-match
engine every other resource type in this codebase already uses. **No hardcoded role-name
check is introduced anywhere** (the brief's explicit requirement) — a `MANAGER`-template
grant scoped to Team X behaves identically to a custom, admin-defined role with the same
`REPORTS_VIEW` grant at the same scope; the engine doesn't know or care about role names,
only permission keys and scope.

**"What happens when a manager has permission to see team workload but does not have
access to the underlying task conversation or files?"** — the exact question the brief
asks to be explicitly analyzed: **that is the expected, correct, default state**, not an
edge case to work around. A `MANAGER`-scoped grant at Team X gives `REPORTS_VIEW` (this
phase's data) but says nothing about `TASK_COMMENT`/conversation access, which is
independently gated by `canAccessConversation` — itself governed by task-level
relationships (creator, assignor, current assignee, or `REPORTS_VIEW`-with-matching-scope,
per `conversation-access.ts`'s existing rule, unchanged). **Concretely:** a Team Head with
`REPORTS_VIEW` at their own team's scope *does* incidentally also satisfy
`canAccessConversation`'s existing `REPORTS_VIEW`-based fallback clause for tasks
originating in their team — this is pre-existing behavior from Phase 2A
(`conversation-access.ts`), not something this phase changes or should change. What this
phase must **not** do is let a *report view itself* render conversation excerpts, message
counts framed as "activity," or file lists — only work-state metadata (§8's rule),
regardless of whether the viewer happens to also qualify for conversation access via the
pre-existing path.

**Tenant isolation:** every new query in this phase is written the same way every existing
one is — scoped by `organizationId` derived from the authenticated session's own
membership, never from a client-supplied parameter taken at face value (matching
`getOrganizationDashboard`'s existing `assertOrgMember` + `assertCan` pattern, reused
verbatim).

---

## 10. Timezone Model

Phase 3 established: a day belongs to the person living it, computed via
`resolveLocalDate(instant, user.defaultTimezone)`/`localDayBounds` in
`packages/domain/src/local-day.ts`. Management reporting introduces exactly the
complication the brief anticipates — multiple people, potentially different timezones,
one viewer.

**Deterministic policy adopted, stated explicitly rather than left implicit:**

1. **"Today" for a given subject person's Daily Work Cycle data (planned/unplanned/
   capacity/carry-forward) is always computed in *that person's own* `defaultTimezone`** —
   never the viewing manager's, never the organization's, never server UTC. This is a
   direct, mechanical extension of Phase 3's own principle (doc 19 §12/§31): a person's
   workday boundary doesn't change depending on who's looking at it.
2. **"Overdue" is timezone-neutral** (§6) — `Task.dueDate` is an instant; no per-viewer or
   per-subject timezone decision is needed for this specific metric.
3. **A team/department/org rollup ("how many people are over capacity today") necessarily
   mixes people whose local "today" may span two different UTC calendar dates at the
   moment of viewing** (e.g., one member's day has just started while another's is
   ending) — this is accepted as correct, not a bug to resolve: each person's own
   "today" bucket is queried independently via their own `Workday` row for their own
   local date, then the counts are summed. There is no single "the org's today."
4. **No organization-level or team-level timezone field is introduced.** The brief asks
   whether one is needed ("organization timezone... team timezone if any") — evidence
   says no: nothing in the current schema or this phase's metrics requires a org/team-wide
   clock; every date-sensitive computation already resolves to an individual `User`.
5. **The viewing manager's own timezone is irrelevant to how the data is computed** — it
   only affects how any date literal in the UI (e.g., a report's "as of" timestamp, if
   shown) is *displayed*, a client-side concern, not a query concern.

This is a deliberate, minimal policy — it introduces no new timezone storage, reuses the
one utility Phase 3 already built and tested (`local-day.test.ts`, 7 passing cases
including a non-UTC and a DST-boundary case), and never falls back to silent server UTC.

---

## 11. Reporting Architecture

**Does Phase 4 need new tables, materialized views, DB views, a query/aggregation
service, caching, or background jobs?**

- **New tables:** No. Every metric in §6 is computable from the six existing structures
  in §5.
- **Materialized views / DB views:** No. Query volume at the current and realistically
  near-term scale (an institution with departments/teams/members in the hundreds, not
  millions) does not justify the operational cost of a materialized view (refresh
  scheduling, staleness semantics) when a real-time query is fast enough (§18's specific
  analysis).
- **A new "aggregation service":** Yes, but not a new *architectural layer* — the existing
  `ReportingService` **is** that service; this phase adds methods to it, following the
  exact pattern `getTeamDashboard`/`getOrganizationDashboard` already establish. No
  parallel `AnalyticsService` or `MetricsService` is introduced.
- **Cached metrics:** No, per §10's explicit instruction to prefer real-time queries
  absent a demonstrated performance reason, and §18 finds none at current scale.
- **Background jobs:** No. Every metric in this report is a request-time query; none
  requires a scheduled computation (proactive *notifications* about these metrics would,
  but that's explicitly Phase 6's job, §17, not built here).

**Why zero-schema-extension is genuinely sufficient (the brief's explicit ask if the
answer is no new schema):** the entire Daily Work Cycle (Phase 3) was itself designed
specifically so that every signal — planned, unplanned, carried-forward, capacity — is a
first-class column or derivable relationship, not something that needs post-hoc
instrumentation (doc 19 §26 named these exact signals as "future reporting signals" in
advance). This phase is that future arriving on schedule, not a surprise requiring new
plumbing.

---

## 12. Dashboard / UX Architecture

Per the brief: **Management Overview → attention required → workload → overdue →
acknowledgement → blocked/stuck → team comparison → individual workload**, then drill-down
**Organization → Department → Team → Person → Work**, with drill-down into any individual
task still enforcing normal task authorization (§9).

**Concrete placement, extending existing pages rather than adding new top-level routes:**

- **`apps/web/app/(app)/organizations/[orgId]/page.tsx`'s existing `OverviewTab`** gains
  a new "Attention Required" section above the existing 4 stat cards — a small,
  scannable list: stuck-in-acknowledgement count, over-capacity people count,
  repeat-carry-forward count, each linking to a filtered view (§13) rather than a new
  page.
- **`departmentPerformance`/`teamPerformance` tables** (already rendered) gain new
  columns for the new counts, each row still linking to the existing team dashboard page
  (already the case for teams; departments currently have no drill-down target — adding
  one is in scope only if a department detail page exists, which per doc 18 §2 it does
  not yet — **this phase does not add a new department page**; department-level numbers
  stay as table rows, not a drill-down destination, until that page exists on its own
  merits).
- **`apps/web/app/(app)/organizations/[orgId]/teams/[teamId]/page.tsx`'s team dashboard**
  gains: per-member capacity (planned/capacity minutes, not just task count), a
  "stuck acknowledgement" list, a "carried forward repeatedly" list — each individual row
  linking to the existing task detail page (`/tasks/:id`), which independently
  re-enforces `canViewTask` exactly as it always has (§9 — drill-down never bypasses
  task-level authorization).
- **Individual/person-level view (new, small):** a lightweight "workload" panel — either
  a section of the team dashboard (listing each member) or, if useful, a dedicated
  read-only view reached by clicking a person's name — showing that person's active
  tasks, today's capacity, and carry-forward count. This is explicitly **not** a new
  "profile" page with editable settings — purely a reporting view, gated by the same
  `REPORTS_VIEW` check.

**Explicitly not built:** a generic BI dashboard, a custom-widget/report-builder UI, or
any charting library beyond simple counts/tables/progress-bar-style visuals already used
elsewhere in the app (the Today screen's capacity bar, `apps/web/app/(app)/today/page.tsx`,
is the existing visual precedent to reuse, not a new charting dependency).

---

## 13. Filtering Model

**The boundary between report filtering and global search, stated precisely per the
brief's explicit request:** report filtering **narrows a scope the viewer is already
authorized to see** (person, team, department, project, status, date range, priority) —
it never searches free text, never crosses into content the viewer isn't independently
authorized for, and never returns results outside the report's own defined scope (a
department head filtering "by team" only ever sees teams within their own department;
they cannot filter their way into a different department's data — the filter narrows,
it never widens beyond the base `REPORTS_VIEW` scope check in §9).

**Global search (Phase 5, per doc 20 §5/§21), by contrast:** free-text, cross-entity
(tasks, projects, messages, files, people), scoped by the searcher's own *task-level*
access (`canViewTask` etc.), not by a management role. The two systems answer different
questions — "show me my team's overdue work" (filtering, this phase) vs. "find that thing
someone mentioned last week" (search, Phase 5) — and should remain architecturally
separate: this phase must not grow a text-search box, and Phase 5 must not grow
role-scoped aggregation.

**Concrete filters implemented as query parameters on the existing report routes**
(additive, not new routes): `teamId`, `departmentId`, `personId`/`userId`, `projectId`,
`status`, `priority`, `dateFrom`/`dateTo` — each one a `WHERE` clause narrowing, never
widening, what `REPORTS_VIEW`'s own scope check already permits.

---

## 14. Actionability

**What can a manager safely do from a report, per the brief's explicit caution list?**

- **Safe, and in scope:** open a task (navigates to the existing, unchanged task detail
  page, which re-derives authorization independently — §12); open a project; open a
  team's page; follow up (this means "navigate to the relevant conversation," not
  "trigger a message from the report" — see below).
- **Explicitly NOT introduced by this phase, per the brief's warning against hidden
  mutations:** no reassignment button, no deadline-change control, no complete/cancel
  action, and no "send a nudge" messaging action lives inside any report view. If any of
  these become desirable later, they must be **the exact existing domain-service call**
  (`AssignmentService.assign`, `TaskService.cancelTask`, etc.) reached by navigating to
  the task's own detail page and using its own, already-authorized controls — never a new
  write path that originates from a report screen. This is not a hypothetical
  precaution: it directly prevents reporting visibility from quietly becoming a second,
  less-audited way to mutate the Work Graph, which would violate this report's own core
  principle (§1).

---

## 15. AI Compatibility

Directly extends doc 20 §16 and the prompt's own AI Strategy Principle. Once built, this
phase's query methods (`getStuckAcknowledgement()`, `getRepeatCarryForward()`,
`getTeamCapacityPressure()`, etc. — §22's proposed shape) become **exactly the functions**
a future AI feature would call to ground any "who's overloaded"/"what's at risk" answer —
never a function the AI re-derives itself from raw rows, and never a parallel path that
bypasses the `REPORTS_VIEW` scope check this report establishes. Concretely: an AI
"summarize my team's status" feature would call `ReportingService.getTeamDashboard`
(extended) with the **same actorId and the same authorization check** a human's dashboard
request uses — the AI is a different *caller* of the same deterministic, permission-
checked service method, never a different *source of truth*. No AI is implemented in this
phase; this section exists solely to confirm the design in §6/§9 is sufficient for that
future without modification — it is, because every metric is already exposed as a
plain, typed, authorization-checked function return value, not a raw query result an AI
model would have to interpret unsupervised.

---

## 16. Search Boundary

Restated precisely from §13 for the required section: this phase adds **scoped filtering
over already-permitted data**, never free-text/cross-entity search. Phase 5 (Search, per
doc 20) remains the sole owner of "find anything by keyword." No search index, no
`tsvector` column, and no search route are introduced here.

---

## 17. Notification Boundary

No scheduler, no background job, and no new `NotificationType` value is introduced in
this phase (per the brief's explicit instruction). **What this phase does do:** define,
precisely, which of its own signals are the natural future notification triggers, so
Phase 6 doesn't have to re-derive them from scratch:

- Overdue-count crossing a threshold for a team → a future `TEAM_OVERDUE_THRESHOLD`
  notification.
- An assignment stuck in `PENDING_ACKNOWLEDGEMENT` past its age threshold → a future
  `ACKNOWLEDGEMENT_STUCK` notification (directly reuses the exact query from §6).
- A person crossing into capacity-pressure (`plannedMinutes > capacityMinutes`) → a
  future `WORKLOAD_PRESSURE` notification.
- A task's carry-forward chain reaching length ≥ 3 (or whatever threshold is chosen) →
  a future `REPEATED_CARRY_FORWARD` notification.

These are named here as **signal definitions**, not built as triggers — Phase 6 decides
delivery (in-app/email/push), cadence, and preferences, entirely independent of this
phase's read-only query layer.

---

## 18. Performance & Indexing

**Expected query volume:** one dashboard load per manager per visit — human-scale, not a
hot path (unlike, say, a per-message conversation read). The existing
`getOrganizationDashboard`'s current N+1-adjacent pattern (load *all* org tasks into
memory once, `.filter()` repeatedly in JavaScript per department/team — lines 148-175,
already flagged as a risk in doc 20 §26) is the **one real performance risk this phase
inherits and must not compound.**

**Specific risks identified:**
- **In-memory filtering over a fully-loaded task list** does not scale gracefully as an
  organization's total task history grows — re-flagged from doc 20, now with a concrete
  fix direction: this phase's new aggregate queries (stuck-acknowledgement, capacity,
  carry-forward) should be written as **`groupBy`/`count`/`aggregate` Prisma queries
  scoped by the relevant `WHERE`**, not as additional `.filter()` passes over an
  already-materialized array. This is a genuine architectural decision this phase's
  implementation must make deliberately (§23 step 3), not inherit passively from the
  existing pattern.
- **`TaskAssignment` lookups filtered by `assigneeUserId IN (many ids) AND isCurrent =
  true`** (needed for a team-wide "who owns what" query) — the existing
  `@@index([assigneeUserId])` and `@@index([taskId, isCurrent])` do not form a single
  composite covering this exact predicate. At current scale (a team's member count is
  small, tens not thousands) this is not yet a real bottleneck; **documented here as a
  future index, `@@index([assigneeUserId, isCurrent])` on `TaskAssignment`, to add only
  if/when a real organization's query plan shows it's needed — not implemented now**, per
  the brief's explicit instruction to document without implementing.
- **`DailyPlanItem` team-wide lookups** (all plan items for N team members on one day) —
  already efficient: `Workday` is looked up via its `@@unique([userId, workDate])` index
  per member (a small, bounded `IN` list), then `DailyPlanItem` via the existing
  `@@index([workdayId, position])` — no new index is needed here.
- **Carry-forward chain walking** — bounded by how many times one specific task has
  actually been re-planned (small, human-scale, doc 19 §29's own reasoning applies
  identically here) — not a performance risk at any realistic scale.
- **Pagination:** the new drill-down list views (stuck-acknowledgement list, repeat-
  carry-forward list) should use the same `{items, nextCursor}` cursor shape every other
  list endpoint in this codebase already uses (`AuditService`/`ConversationService`/
  `NotificationService`/Phase 3's own `listHistory`) — not the un-paginated array shape
  `getTeamDashboard`/`getOrganizationDashboard` currently return for their (small,
  bounded-by-team-or-department-size) buckets. The distinction: a per-team bucket is
  naturally small and stays unpaginated; a cross-org "everyone who's stuck" list is not
  naturally bounded and must paginate.

**Can the existing schema support Phase 4 queries?** Yes, without any schema change, for
every metric this report defines — the one identified future index (above) is an
optimization for scale this product has not reached yet, not a blocker for building the
feature correctly today.

---

## 19. Security Threat Model

| Threat | Mitigation, reusing existing mechanisms |
|---|---|
| IDOR on a report route (guessing a `teamId`/`departmentId`) | Every route re-derives `organizationId` membership + `REPORTS_VIEW` scope from the session, exactly as `getTeamDashboard`/`getOrganizationDashboard` already do (§2) — a guessed id that doesn't match the caller's own scope 403s, never 200s with data. |
| Cross-tenant reporting (org A's manager viewing org B's data) | `assertOrgMember` is the first check on every existing report method, unconditionally re-derived per request — no caching, no trust of a client-supplied org id beyond what membership independently confirms. |
| Department boundary leakage | `resolveEffectivePermissions`'s department-path scoping (§9) — a `DEPARTMENT_HEAD` grant at Department X's `scopeId` only ever matches resource contexts whose `departmentPathIds` includes X; a sibling department is structurally invisible, not just hidden in the UI. |
| Team boundary leakage | Same engine, exact-match team scoping — no inheritance across sibling teams. |
| Unauthorized person-level workload (seeing an individual outside the viewer's scope) | Person-level rows in any new view are always derived from a team/department query already scoped by §9 — there is no "look up any user's workload by id" endpoint; a person only appears because they're a member of a team/department the viewer is authorized over. |
| Aggregation leakage (inferring private detail from a count) | The metrics in §6/§8 are coarse (counts, sums, ratios, boolean flags) by design — none of them, individually or combined, reconstructs conversation/file content or the private `reflectionNote`. Reviewed specifically: even "carry-forward chain length" and "capacity pressure" reveal only work-state facts a manager scoped over that person's team would reasonably already infer from watching their task list over time. |
| Task metadata leakage beyond what the viewer's existing task-level access would show | Reports show task title/status/priority/dueDate — the exact same fields already visible on any task list the viewer could otherwise construct via `REPORTS_VIEW`-gated `listTasks(view: ALL)` (already the case in `getOrganizationDashboard` today) — no new field is exposed. |
| Conversation/file leakage | Structurally impossible by construction — no report query in this design ever touches `Conversation`/`TaskMessage`/`TaskAttachment` (§8's rule, §5's data-source table excludes them entirely). |
| Private Daily Work information leakage | `Workday.reflectionNote` and any personal-ordering signal are excluded by name in §8 — no query in this report's design selects that column. |
| Malicious query parameters (e.g., a crafted `dateFrom`/`teamId` designed to force a full-table scan or leak via timing) | Every filter parameter is Zod-validated (matching every existing route's convention) and applied as an additional `WHERE` narrowing an already-scope-checked query — never as the sole scope check itself. |

**Tests required to prove isolation** (designed, not written, per §20): a dedicated E2E
block mirroring every prior phase's pattern — a `DEPARTMENT_HEAD` of Department X
attempting to read Department Y's report data (403); a `TEAM_HEAD` of Team A attempting
to read Team B's workload (403); a `MEMBER` (no `REPORTS_VIEW`) attempting any report
route (403); an outsider from a different organization entirely attempting any report
route for this org (403, indistinguishable from not-found); confirmation that a report
response never contains a `reflectionNote` field or any conversation/message content,
even for a viewer who happens to also hold task-level conversation access via the
pre-existing `REPORTS_VIEW` fallback (§9).

---

## 20. Testing Strategy

**Unit tests** (mirroring existing `packages/domain/src/**/*.test.ts` style, pure-logic
where possible):
- Each metric definition (§6) as a pure function over fixture data — carry-forward chain
  length calculation, capacity-pressure boolean, unplanned ratio — independent of
  Prisma, matching how `resolve-scope.test.ts` and `daily-plan-item.machine.test.ts`
  already test pure logic without a database.
- Permission-scope resolution for the new report queries — confirming a
  `DEPARTMENT_HEAD`/`TEAM_HEAD`/`MANAGER` grant at various scopes produces the expected
  visible-team/department set, reusing `resolve-scope.test.ts`'s existing fixture style.
- Timezone-boundary cases for "today" resolution per subject person (§10), extending
  `local-day.test.ts`'s existing non-UTC/DST fixtures to a multi-person scenario.
- Assignment-attribution correctness (§7) — confirming workload attributes to the
  current accepted individual assignee, never the creator/original assignor, mirroring
  `assignment-authorization.test.ts`'s existing style.

**E2E scenarios** (extending `tests/e2e/abc-college.e2e.test.ts` in its established
narrative style, per the brief's explicit list):
1. Org Admin sees full organization-wide visibility (all departments, all teams).
2. Department Head sees their own department's teams/people, not a sibling department's.
3. Team Head sees their own team only, not a sibling team's.
4. A `MANAGER`-template grant scoped to a specific team behaves identically to a
   `TEAM_HEAD` grant at that scope (proving the engine is genuinely capability-based, not
   role-name-based).
5. A `MEMBER` (no `REPORTS_VIEW`) is denied every report route (403).
6. Cross-team isolation: Team A's viewer cannot see Team B's stuck-acknowledgement/
   workload/carry-forward data.
7. Cross-department isolation: same, one level up.
8. Cross-tenant isolation: an outsider from a different organization is denied (403),
   indistinguishable from not-found.
9. Current-owner attribution updates immediately after a reassignment — workload moves
   from the old assignee to the new one on the very next report read (no caching lag).
10. A `TEAM`-type pending assignment shows correctly as team-level "awaiting
    acknowledgement," not attributed to any individual until distributed.
11. Overdue tasks appear correctly and consistently between the existing dashboard and
    any new "attention required" section (no double-counting, no drift).
12. Carry-forward: a task carried forward twice shows a chain length of 2 in the report,
    and the underlying `reflectionNote` from either day never appears in the response.
13. Unplanned work ratio reflects `isUnplanned` accurately across a mixed day.
14. Daily capacity: a report correctly sums `plannedMinutes` across team members and
    flags over-capacity people, using the same formula as the individual Today screen
    (no drift between the two).
15. Full regression: the entire existing E2E suite (101 scenarios through Phase 3) reruns
    unmodified and green — the same non-negotiable bar every prior phase has met.

---

## 21. Schema Impact

**Does Phase 4 require schema changes? No.** Every metric, every permission check, and
every filter defined in this report is computable from the schema exactly as it exists
at `aeb569d` — six existing tables (§5), one existing permission engine (§9), one existing
timezone utility (§10). The one item flagged as a **future** (not now) optimization is a
single composite index, `@@index([assigneeUserId, isCurrent])` on `TaskAssignment` (§18)
— named, precisely located, and explicitly **not** proposed for this phase's own
migration; it would only become worth adding if a real organization's query plan shows it
is needed, which cannot be determined before this phase's queries actually run against
production-shaped data volume.

---

## 22. MUST / SHOULD / COULD / DEFERRED

**MUST HAVE**
- Team-level: acknowledgement-stuck count + list, carry-forward-repeat count + list,
  unplanned-work ratio, capacity pressure (over-capacity member count), alongside the
  existing overdue/active/workload buckets.
- Department/organization-level: the same signals rolled up, alongside existing
  `departmentPerformance`/`teamPerformance`.
- Per-person workload extended from task-count to minutes-based capacity.
- All read-only; reuses `REPORTS_VIEW` and the existing scope-resolution engine exactly —
  no new permission key, no hardcoded role check.

**SHOULD HAVE**
- A dedicated, paginated "stuck work" drill-down view (not just a count) for both
  acknowledgement-stuck and repeat-carry-forward items.
- A cross-team individual workload view ("everything this person is currently
  accountable for, across every team they're on") — the gap doc 18/20 both independently
  flagged as missing.

**COULD HAVE**
- CSV export of any table this phase produces.
- An "origin of work" breakdown (which department/team most often originates cross-team
  assignments) — data already exists (`originDepartmentId`/`originTeamId`), purely a new
  aggregation, no urgency.

**EXPLICITLY DEFERRED** (per the brief's own list, each confirmed by this session's
evidence to have no forcing function in the current repository):
- AI of any kind (§15 — this phase is the foundation, not the feature).
- Global/free-text search (§16 — Phase 5's job).
- Calendar (no current gap requires it, doc 20 §10, unchanged).
- Recurring tasks (no current gap requires it, doc 20 §13, unchanged).
- Proactive/scheduled notifications (§17 — signals defined here, delivery is Phase 6).
- Time tracking beyond Phase 3's existing coarse `startedAt`/`completedAt` signal (doc 19
  §17's own explicit deferral, unchanged).
- Forecasting / predictive analytics (would require historical volume this product
  doesn't have yet — a data-availability problem, not an architecture one).
- Any BI/export platform or custom report builder — this phase ships fixed, well-defined
  views, not a query-building UI.
- `TaskDependency`-based "blocked" visibility (doc 20 §15 — the model is unused and would
  need its own traversal/query logic built from scratch first; not this phase's job).

---

## 23. Phase 4 Implementation Sequence

Adjusted from the brief's example to match this phase's actual shape — no schema step is
needed (§21), so the sequence starts one step later than a typical schema-bearing phase
(compare doc 17/19's Step 1 "database foundation," absent here by design):

1. **Reporting domain architecture** — design the exact new method signatures on
   `ReportingService` (or, if warranted for size, a sibling class it composes — a
   decision to make during this step, not before) and the exact shape of each new
   aggregate query, per §6/§18's performance guidance (`groupBy`/`aggregate`, not
   in-memory `.filter()` chains).
2. **Authorization/scoping** — verify every new method's first two calls are
   `assertOrgMember` + the appropriate `REPORTS_VIEW` scope check, mirroring
   `getTeamDashboard`/`getOrganizationDashboard`'s existing pattern exactly; write the
   unit tests for scope resolution (§20) before or alongside this step.
3. **Metric/query layer** — implement each §6 metric as its own composable query method,
   unit-tested against fixture data independent of the API layer.
4. **API** — extend the two existing report routes' response shapes (additive fields) and
   add the new paginated drill-down routes (§18's `{items, nextCursor}` convention) for
   the SHOULD-HAVE stuck-work/carry-forward lists.
5. **Management UI** — extend `OverviewTab` and the team dashboard page per §12; no new
   top-level nav entry needed (these live inside pages that already exist).
6. **Filters/drill-down** — wire the query-parameter filtering (§13) and confirm every
   drill-down link into a task/project/person still re-enforces its own independent
   authorization (§9/§12's non-negotiable rule).
7. **Tests** — the full unit + E2E matrix from §20, including the explicit cross-team/
   cross-department/cross-tenant isolation scenarios and the reflection-note-never-leaks
   assertion.
8. **Performance validation** — confirm the new aggregate queries do not repeat the
   existing `getOrganizationDashboard`'s in-memory-filter-over-everything pattern (§18);
   spot-check query plans against a realistically-sized seeded dataset if one is
   available.
9. **Security audit** — a dedicated self-review pass against §19's threat table, matching
   the process every prior phase (2C's notification-payload catch, 3's concurrency-race
   catch) has used before commit.
10. **Production build** — full monorepo typecheck/lint/build, matching every prior
    phase's gate.
11. **E2E** — full suite rerun, including the pre-existing ~101 scenarios unmodified.
12. **Final diff audit** — confirm no unintended file changed, matching every prior
    phase's commit-audit discipline.
13. **Commit** — only after explicit user approval, never automatic.
14. **Push** — only when separately requested, matching this project's established
    pattern across every phase so far.

---

## 24. Future Phase Dependencies

```
Phase 3 (done) — Daily Work Cycle
   ↓ generates signals nobody but the owner can see
Phase 4 (this report) — Management Visibility & Work Graph Reporting
   ↓ defines what's worth finding (informs filters) AND worth alerting on (informs triggers)
Phase 5 — Search & Navigation
   ↓
Phase 6 — Proactive Notifications + Scheduler
   (consumes §17's named signal definitions directly)
   ↓
Phase 7 — Recurring Work (only once 6 exists to make it visible/actionable)
   ↓
Phase 8 — Mobile Readiness Corrections → Mobile App
   ↓
Phase 9 — AI Layer (assistive-only), grounded in Phase 4's deterministic queries (§15)
```

Unchanged from doc 20 §24 except this report now exists as the fully-specified Phase 4 —
nothing about the ordering of Phases 5-9 changes as a result of this deeper design pass.

---

## 25. Open Questions

- Exact "stuck" threshold for pending acknowledgement (24h? 48h? configurable per org?) —
  a product decision, not architectural; §6 leaves it a named parameter, not a hardcoded
  constant, so the eventual answer doesn't require a schema change either way.
- Exact carry-forward "repeated" threshold (2 pushes? 3?) — same category of decision.
- Whether the "stuck work"/"repeat carry-forward" person-level views should be visible to
  the flagged individual themselves (transparency) or management-only (unchanged from
  doc 20 §27, still open, still a product decision to make deliberately before UI copy is
  written).
- Whether `ReportingService` should be split into a dedicated class once this phase's
  methods land (it will grow meaningfully beyond 187 lines) — an implementation-step
  decision (§23 step 1), not one this architecture report needs to resolve in advance.

---

## 26. Final Recommendation

The design in this report adds a read-only projection layer over the existing Work
Graph — new query methods on the existing `ReportingService`, new response fields on the
existing report routes, new sections on the existing dashboard pages — with **zero new
tables, zero new permissions, and zero new authorization primitive**. It reuses Phase 3's
timezone utility, Phase 3's capacity formula, the pre-existing `REPORTS_VIEW`/scope-
resolution engine, and the exact current-owner attribution rule
`DailyWorkService.isCurrentOwner` already established — extending, never duplicating, at
every point, matching the discipline that made every prior phase in this project cheap
and safe to build. The one deliberate new architectural decision (§18) — writing the new
aggregate queries as proper `groupBy`/`aggregate` calls rather than repeating
`getOrganizationDashboard`'s existing in-memory-filter pattern — is named explicitly so it
is made on purpose during implementation, not inherited by accident.

This is an assessment and architecture design only. Implementation should not begin until
this report is explicitly approved, matching the process used for every phase so far.

READY FOR IMPLEMENTATION
