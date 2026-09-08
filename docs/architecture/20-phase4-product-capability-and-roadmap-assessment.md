# Phase 4 Product Capability & Roadmap Assessment

**Base commit:** `aeb569d` (branch `master`, `origin/master` synchronized). **Method:**
every claim below was re-verified directly against the repository at this commit — schema,
migrations, domain services, API routes, UI, shared package, and tests — not assumed from
`docs/architecture/*`'s own claims about itself, and not assumed from the prior assessment
(`docs/architecture/18-product-capability-and-roadmap-assessment.md`, written before Phase
3 existed). Where doc 18's conclusions still hold, they are re-cited with fresh evidence
rather than repeated on faith; where Phase 3 changed the picture, that is called out
explicitly. This is a read-only assessment — no code, schema, or test was modified.

---

## 1. Executive Summary

Phase 3 closed the single-user half of the Work OS loop: a person can now be assigned
work, acknowledge it, discuss it, attach files to it, **deliberately choose what to work on
today**, execute it, and **deliberately decide what happens to what's unfinished** — all
without leaving one connected data model. That loop is genuinely strong, tested (101 E2E
scenarios), and was verified live in a browser this session.

What is now the weakest link is not inside any one person's loop — it's **between**
people's loops. `Workday`/`DailyPlanItem` (Phase 3) generate exactly the signals a
Team Head or Org Admin needs — who's overloaded, what's stuck in acknowledgement, what's
being carried forward day after day, how much work is unplanned — and **none of it is
currently visible to anyone but the individual who owns it**. `ReportingService`
(`packages/domain/src/services/reporting.service.ts`, 187 lines) still only answers
2026-era-Phase-1-shaped questions (counts, overdue, completion) and has not been extended
to read any Phase 2A/2B/2C/3 data at all — confirmed by grep: zero references to
`Conversation`, `TaskAttachment`, `Workday`, or `DailyPlanItem` anywhere in that file.

**Recommendation: Phase 4 = Management Visibility & Work Graph Reporting** — a read-only
extension of the existing `ReportingService`/dashboards that surfaces acknowledgement-stuck
work, repeat carry-forwards, workload, and unplanned-work ratio at the team/org level,
using 100% existing data through 100% existing authorization (`REPORTS_VIEW`), with **zero
new tables**. Full reasoning in §22; alternatives in §21.

---

## 2. Current Product Capability

Verified end-to-end against the code, not the docs. 66 API route files under
`apps/web/app/api/v1/*`, 17 UI pages under `apps/web/app/(app|auth)/*`, 14 domain services
in `packages/domain/src/services/`, 39 Prisma models across 9 migrations.

The product today, in one paragraph: an organization (or a solo individual) can be
structured into departments and teams; a capability-based RBAC engine
(`packages/domain/src/services/permission.service.ts` +
`packages/domain/src/permission-engine/resolve-scope.ts`) governs every action; tasks flow
through a genuinely rigorous six-pattern assignment/acknowledgement chain
(`packages/domain/src/services/assignment.service.ts`) with immutable origin-tracking; each
task and each Project/Event carries its own threaded conversation and file library
(`conversation.service.ts`, `task-attachment.service.ts`, generalized in Phase 2C to serve
both); and — new in Phase 3 — each person can build and close out a genuine daily plan
(`daily-work.service.ts`) that references but never duplicates that task graph. Every
mutation is written to an append-only, DB-role-enforced-immutable audit log
(`audit.service.ts`, `packages/db/prisma/migrations/20260906072700_constraints_and_audit_immutability/migration.sql`).

---

## 3. Implemented vs Partial vs Missing

Classification legend: **IMPLEMENTED** / **PARTIAL** / **MISSING** / **DEAD-UNUSED** /
**DEFERRED** / **CONFLICTING**.

| # | Capability | Status | Evidence |
|---|---|---|---|
| A | Identity & Authentication | IMPLEMENTED (local, not the originally-designed Supabase Auth) | `packages/domain/src/services/auth.service.ts` (bcrypt), `apps/web/lib/session.ts` (jose-signed JWT cookie). Doc 14 §1 self-discloses the deviation. |
| B | Organizations / Workspaces | IMPLEMENTED | `organization.service.ts`; `Workspace` model with `PERSONAL`/`ORGANIZATION` types, `workspaces_owner_xor_org_check` CHECK constraint. |
| C | Departments | IMPLEMENTED (CRUD + hierarchy), no dedicated management UI page | `Department` model with `parentDepartmentId` self-relation; `getDepartmentPath` in `permission.service.ts`; created via `/organizations/:id/departments` — no `apps/web/app/(app)/organizations/[orgId]/departments` page exists. |
| D | Teams | IMPLEMENTED, has UI | `apps/web/app/(app)/organizations/[orgId]/teams/*`. |
| E | Roles / Permissions | IMPLEMENTED | `packages/shared/src/permissions/permissions.catalog.ts` (32 permission keys, 4 system role templates), `resolve-scope.ts` (unit-tested). |
| F | Users / Membership | IMPLEMENTED | `OrganizationMember`, `TeamMember`. |
| G | Tasks | IMPLEMENTED | `task.service.ts` — full CRUD, checklist, priority, due date. |
| H | Subtasks | PARTIAL — schema only | `Task.parentTaskId` exists and is settable at creation (`createTaskSchema.parentTaskId`), but no service method reads a task's subtask list, and no UI renders a subtask tree. |
| I | Task Assignment | IMPLEMENTED, strongest part of the product | `assignment.service.ts` — all 6 brief patterns, unit- and E2E-tested. |
| J | Assignment Acknowledgement | IMPLEMENTED | `assignment-status.machine.ts`, accept/decline flow. |
| K | Task Lifecycle | IMPLEMENTED | `task-status.machine.ts` — full DRAFT→…→COMPLETED/CANCELLED. |
| L | Reassignment | IMPLEMENTED | `AssignmentService.assign` (full reassignment) + `.reassignInternal` (team-head distribution). |
| M | Notifications | PARTIAL — in-app, event-driven only | See §9. |
| N | Task Conversation | IMPLEMENTED | `Conversation`/`TaskMessage` (Phase 2A), generalized in Phase 2C. |
| O | Messages / Replies | IMPLEMENTED | `TaskMessage.parentMessageId`. |
| P | Mentions / Reactions | IMPLEMENTED | `TaskMessageMention`, `TaskMessageReaction`. |
| Q | Files / Attachments | IMPLEMENTED (local disk only, not production storage) | `task-attachment.service.ts`; `LocalDiskStorageService` — no S3/object-storage adapter exists. |
| R | Projects / Events | IMPLEMENTED | `project.service.ts` (Phase 2C). |
| S | Project Membership | IMPLEMENTED | `ProjectMember`/`ProjectTeam`. |
| T | Project Conversation | IMPLEMENTED | Same `Conversation` model, `projectId` branch. |
| U | Project Dates | IMPLEMENTED (deliberately minimal, not a calendar) | `ProjectDate` — labeled date + notes, no recurrence/time. |
| V | Daily Work Cycle | IMPLEMENTED | `daily-work.service.ts` (Phase 3) — `Workday`/`DailyPlanItem`. |
| W | Inbox | IMPLEMENTED (derived, not stored) | `DailyWorkService.getInbox` — "My Tasks" minus today's active plan items. |
| X | Today Plan | IMPLEMENTED | `DailyWorkService.addItem`/`listItems`; `apps/web/app/(app)/today/page.tsx`. |
| Y | Execute / Work | IMPLEMENTED (start/complete only, no session tracking) | `startItem`/`completeItem` — deliberately no pause/resume persistence (doc 19 §17). |
| Z | Close / Carry Forward | IMPLEMENTED | `closeWorkday` — transactional, validated disposition requirement. |
| AA | Audit | IMPLEMENTED | `audit_logs` — 4 nullable context FKs now (`taskId`/`projectId`/`workdayId` + `organizationId`), DB-role-immutable. |
| AB | Reporting | PARTIAL — Phase-1-shaped only, not extended for Phase 2A-3 data | See §11. `reporting.service.ts` has zero references to `Conversation`, `TaskAttachment`, `Workday`, or `DailyPlanItem` (grep-confirmed). |
| AC | Search | MISSING — confirmed by repo-wide grep for `tsvector`/full-text/search routes | No route, no service, no UI entry point anywhere. |
| AD | Calendar | MISSING (deliberately deferred) | No `CalendarEvent`/meeting model. `Task.dueDate`, `ProjectDate`, and Phase 3's `DailyPlanItem.scheduledStart/scheduledEnd` are the only date-bearing surfaces; none render as a calendar grid. |
| AE | Time Tracking | PARTIAL — one coarse signal only, deliberately not built out | `DailyPlanItem.startedAt`/`completedAt` give a single elapsed-time datum; no session/pause-resume persistence (doc 19 §17, explicit design choice). |
| AF | Recurring Work | MISSING | No recurrence field on `Task`, `ProjectDate`, or `DailyPlanItem`; no scheduler to generate recurring instances. |
| AG | Automation | MISSING | No rules engine, no triggers-and-actions concept anywhere. |
| AH | AI | MISSING (by design, Phase 1-3 explicitly scoped it out) | `AiInteraction` model present, schema-only, zero code references. `AI_FEATURES_ENABLED` env flag exists, unused. |
| AI | Mobile readiness | PARTIAL | Uniform `{data,error}` envelope (`packages/shared/src/api-envelope.ts`) — good. Cookie-only session (no bearer/API-key mode) — gap. Inconsistent pagination (see §17). |
| AJ | API architecture | IMPLEMENTED, consistent | `apps/web/lib/api.ts` — one `withAuth` wrapper, one error-mapping function, used by all 66 routes. |
| AK | Security (app-layer authz) | IMPLEMENTED | Every route resolves identity from session, re-derives authorization per-request — see §18. |
| AL | Multi-tenancy | IMPLEMENTED (application-layer only) | Tenant isolation enforced per-service, extensively E2E-tested (cross-tenant scenarios in every phase's test block). |
| AM | PostgreSQL RLS | MISSING (explicitly deferred, doc 14 §4) | Zero `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` statements across all 9 migrations (grep-confirmed). |
| AN | Rate limiting | MISSING | No `middleware.ts` exists anywhere in `apps/web`. |
| AO | Background jobs | MISSING | No cron/queue package in any `package.json` (grep-confirmed: no `cron`, `bullmq`, `node-cron`, `agenda`). |
| AP | Deployment / CI/CD | MISSING | No `Dockerfile`, no `.github/` workflows, `docker-compose.yml` is Postgres-only. |
| AQ | Observability | MISSING | Only ad hoc `console.error` in the route error mapper; no structured logging, no APM/error-tracking integration. |
| AR | Billing / SaaS readiness | MISSING (not needed yet) | No plan/tier field on `Organization`, no payment provider integration. |

**Dead/unused, confirmed unchanged since doc 18** (re-grepped this session): `TaskDependency`,
`TaskTag`, `Tag` — zero references outside `schema.prisma`. `TaskComment` /
`/tasks/:id/comments` — API still live, zero UI consumer (`grep -rln` for
`/comments|addComment|listComments` across `apps/web/app`/`components` returns only the
route file itself). `DeliveryChannel.PUSH`/`.EMAIL`, `NotificationType.DEADLINE_APPROACHING`/
`.TASK_OVERDUE` — declared, never set/triggered by any code path (full detail §7).

---

## 4. Current End-to-End Work Loop

Walking the 13-step loop from the brief against actual code:

| Step | Status | Evidence |
|---|---|---|
| 1. Work arrives | **Strong** | `TaskService.createTask`, direct or via assignment. |
| 2. User understands what it is | **Strong** | Task detail page, conversation thread, project context. |
| 3. Work is assigned | **Strong** | `AssignmentService.assign` — the best-tested part of the system. |
| 4. Recipient acknowledges | **Strong** | Accept/decline, mandatory reason on decline. |
| 5. People communicate around the work | **Strong** | `Conversation`/`TaskMessage`, mentions, reactions. |
| 6. Relevant files are attached | **Strong** | `TaskAttachment`, linked to messages or standalone. |
| 7. Work is planned | **Strong (new)** | `DailyWorkService.addItem` — Phase 3. |
| 8. Work is executed | **Moderate — fragmented** | Two overlapping progress surfaces exist and are not reconciled: `TaskUpdate` (`percentage`/`note`, Phase 1, `POST /tasks/:id/updates`) and `DailyPlanItem` start/complete (Phase 3, `POST /workday-items/:id/complete`). Completing a plan item for *today* does not post a `TaskUpdate`, and posting a `TaskUpdate` does not touch the plan item. A reviewer looking at task-level progress and a person looking at their daily plan can see two different, uncorrelated pictures of the same task's state. |
| 9. Progress is visible | **Weak at the aggregate level** | Visible per-task (updates, comments) and per-day (Today screen) — **not** visible per-person-across-their-work or per-team. No query anywhere answers "what did Rahul actually get done this week." |
| 10. Work is reviewed | **Strong** | Submit → review → approve/changes-requested, unchanged since Phase 1. |
| 11. Work is completed | **Strong** | `TaskStatus.COMPLETED`, terminal, audited. |
| 12. Unfinished work is deliberately carried forward | **Strong data, invisible insight** | `DailyPlanItem.carriedFromItemId` chain is captured correctly (doc 19 §19) but **nothing ever reads it** — no query walks the chain to answer "has this been carried forward repeatedly," confirmed by grep: zero references to `carriedFromItemId` outside `daily-work.service.ts` itself. |
| 13. Next day starts with awareness of what changed | **Moderate, pull-only** | Today's START section surfaces yesterday's unclosed day and new assignments (`apps/web/app/(app)/today/page.tsx`) — but only if the user opens the app. Nothing pushes this awareness to them (no email/push, no scheduler — §9). |

**Where the loop is genuinely broken, not just weak:** nowhere at the individual level.
**Where it's structurally missing:** at the multi-person / management level — steps 9, 12,
and 13 all degrade from "strong per-person" to "invisible in aggregate" the moment more
than one person's work needs to be seen together. That is the gap this report recommends
closing next.

---

## 5. Biggest Product Gaps

Ranked by the brief's stated criteria (user value, frequency, strategic importance,
differentiation, architectural leverage, complexity, security risk, dependency depth,
revenue potential, loop-strengthening) — **not** by ease of implementation. Score 1–10.

| Gap | Loop-strengthening | Differentiation | Architectural leverage | Complexity (lower = easier) | Net verdict |
|---|---|---|---|---|---|
| 1. **No management/team visibility into acknowledgement-stuck, overloaded, or repeatedly-carried-forward work** | 9 | 8 | 9 | 3 (read-only, no schema) | **Phase 4 pick** |
| 2. No search across tasks/projects/messages/files/people | 4 | 3 | 6 | 2 | Strong Phase 5 |
| 3. No proactive/scheduled notifications (deadline, overdue, stuck) | 7 | 5 | 8 | 6 (needs a scheduler — first real new infra) | Phase 6, after signals from #1 exist to notify about |
| 4. Progress-visibility fragmentation (`TaskUpdate` vs `DailyPlanItem`) | 6 | 2 | 4 | 2 | Small, worth folding into #1's implementation, not its own phase |
| 5. No object storage (local disk only) | 2 (not loop-facing) | 0 | 3 | 4 | Production-readiness track, not a product phase |
| 6. No individual cross-workspace workload view | 6 | 4 | 5 | 3 | Subsumed by #1 |
| 7. No calendar (even MVP read-only) | 3 | 2 | 4 | 3 | Correctly deferred (§10) |
| 8. TaskComment/TaskDependency/TaskTag dead code | 1 | 0 | 1 | 1 | Cleanup, not a phase |
| 9. No RLS (single-layer tenant isolation) | 1 (not loop-facing) | 0 | 2 | 5 | Before multi-tenant scale, not now |
| 10. No AI of any kind | 5 | 6 (once built well) | 7 (as a consumer of #1/#2) | 8 (needs deterministic foundations first) | Correctly sequenced after #1/#2/#3 |

Gap #1 wins on every criterion that matters most per the brief's own weighting
(loop-strengthening, differentiation, architectural leverage) while being **among the
lowest** in implementation complexity and security risk — a genuinely rare combination,
and the reason it is the recommendation in §22.

---

## 6. Architectural Leverage Points

Ranked by how many future capabilities each one unlocks:

1. **A work-graph reporting/insight layer** (this report's Phase 4 pick) — unlocks: AI
   bottleneck detection, AI workload analysis (doc 18 §6 capabilities #14/#15), executive
   summaries, future notification content ("you have 3 items stuck in acknowledgement"),
   and is itself the deterministic foundation the AI Strategy Principle (§16/prompt §14)
   requires before any "why am I overloaded"-style AI feature is trustworthy.
2. **A scheduler/background-job system** — unlocks: proactive notifications, recurring
   work, future SLA/escalation logic, AI daily briefings (doc 18 §6 #6/#7). Zero
   infrastructure of this kind exists yet anywhere in the stack (§AO) — this is the first
   phase that will require genuinely new infrastructure, not just new domain code.
3. **A search index** — unlocks: normal search, a future command palette, AI natural-
   language search (doc 18 §6 #19), and indirectly strengthens reporting/navigation.
4. **Object storage swap** — unlocks: production deployment, multi-instance scaling,
   eventually signed-URL-based direct client uploads.

The reporting/insight layer is ranked first specifically because — uniquely among these
four — it requires **no new infrastructure at all**: every signal it needs already exists
in `Task`, `TaskAssignment`, `DailyPlanItem`, and `AuditLog`. It is pure query composition
over data Phase 1 through 3 already committed to disk, which is exactly the same
"extend, don't duplicate" leverage that made Phases 2B/2C/3 cheap to build.

---

## 7. Dead / Legacy / Duplicated Areas

Re-verified this session (all previously flagged in doc 18 §13, confirmed unchanged):

| Item | Evidence | Removal risk | Before or after Phase 4 |
|---|---|---|---|
| `TaskComment` + `/tasks/:id/comments` | Route file exists (`apps/web/app/api/v1/tasks/[taskId]/comments/route.ts`); zero UI references (`grep -rln` confirmed) | Low — genuinely orphaned, but has live rows in the DB from real usage before Phase 2A shipped; deleting the *table* would be destructive, deleting the *route* would not | After — unrelated to Phase 4, small, no rush |
| `TaskDependency`/`TaskTag`/`Tag` | Zero references anywhere outside `schema.prisma` (grep-confirmed this session) | Low to remove the routes/schema (never wired); if kept, should eventually back a real feature (§15 blocker discussion) instead of sitting dead | After |
| `DeliveryChannel.PUSH`/`.EMAIL`; `NotificationType.DEADLINE_APPROACHING`/`.TASK_OVERDUE` | Declared, never set/triggered (grep-confirmed this session, unchanged since doc 18) | None — will become live the moment Phase 6 (notifications/scheduler) ships | These become *used*, not dead, once Phase 6 lands — no cleanup needed |
| `test:integration` npm script | References `vitest.integration.config.ts`, which has never existed in `git log` history | None to fix (delete the script or write the config) | Anytime, trivial |
| Progress-fragmentation between `TaskUpdate` and `DailyPlanItem` (new finding, §4) | Two independent "how's this going" surfaces with no reconciliation | Not dead code exactly, but a design seam worth tightening | Should be addressed *as part of* Phase 4's implementation (a single "activity/progress" query naturally wants to read both) rather than deferred further |

**No new dead code was introduced by Phase 3** — every new model, service method, and
route added this phase is reachable and exercised by the E2E suite.

---

## 8. Search Assessment

**Can a user currently find tasks/projects/conversations/messages/files/people/teams
efficiently?** No. Confirmed by repo-wide grep for `tsvector`, "search", and any
`/search` route — none exist. The only way to locate something today is to already know
which task/project/workspace it lives under and browse to it via `/tasks`, `/projects`, or
a specific detail page's tabs.

**Should this be Phase 4?** No — see §5/§22. It is real, valuable, low-complexity, and
should be the very next phase after this one, but it does not close any step of the
13-step loop; it is a navigation accelerant, not a loop-strengthener. Per the brief's own
instruction not to rank by ease, and to weigh loop-strengthening and differentiation
highest, it loses to Gap #1.

**When it is built:** Postgres native full-text (`tsvector`/GIN) over task title/
description, project name/description, and message body is sufficient at this scale — no
external search service needed. The one hard rule, worth stating now so it isn't
forgotten later: results must be filtered through the **exact same** access predicates
every other read path already uses (`TaskService.canViewTask`, the project-access
predicate, etc.) — never a parallel index that could leak content a searcher couldn't
otherwise see.

**Replaced by another navigation model instead?** Partially, already: the new Today/Inbox
view (Phase 3) and the recommended Phase 4 reporting views both reduce how often a user
*needs* to search by surfacing relevant work proactively — but neither replaces the
"I remember a task about X, where is it" use case search alone answers.

---

## 9. Notification Assessment

**What actually exists:** `packages/domain/src/services/notification.service.ts` — a
`Notification` model (`userId`, `type`, `payload` JSON, `relatedTaskId`, `isRead`,
`deliveryChannel`), an in-app bell (`apps/web/components/NotificationBell.tsx`, 30-second
poll) and a full list page (`apps/web/app/(app)/notifications/page.tsx`).

**Triggers that exist (event-driven, fire-on-mutation):** `TASK_ASSIGNED`,
`TASK_ASSIGNED_TO_TEAM`, `ASSIGNMENT_ACCEPTED`, `ASSIGNMENT_DECLINED`, `TASK_REASSIGNED`,
`COMMENT_ADDED`, `REVIEW_REQUESTED`, `REVIEW_COMPLETED`, `CHANGES_REQUESTED`,
`TASK_COMPLETED`, `MESSAGE_ADDED`, `MENTIONED_IN_TASK` — all called directly from the
service method that performs the corresponding mutation (`assignment.service.ts`,
`task.service.ts`, `conversation.service.ts`). **Phase 3 added zero new notification
triggers** — no notification fires on plan-item add/start/complete/carry-forward or
workday close (confirmed: `daily-work.service.ts` has no `NotificationService` import at
all).

**Triggers that are declared but never fire (time-based/proactive):**
`DEADLINE_APPROACHING`, `TASK_OVERDUE` — both exist in the `NotificationType` const,
neither is ever passed to `notify`/`notifyMany` anywhere (grep-confirmed, unchanged since
doc 18). This is structurally impossible to fix without a scheduler — there is no code
path in this application that runs without an incoming HTTP request to trigger it (§AO).

**Distinguishing the two classes explicitly, per the brief's request:**
- *Event-driven* — fully implemented, fires synchronously inside the same transaction/
  request as the state change that caused it. Reliable, tested indirectly via the E2E
  suite's assertions on downstream state.
- *Time-based/proactive* — **entirely absent**. Nothing in this codebase runs on a clock.
  "It's now overdue" and "this is due tomorrow" are computed reactively, only when a page
  is loaded (`isOverdue()` in `task-status.machine.ts`, called from
  `ReportingService`/`TaskService.listTasks`), never pushed to anyone.

**Preferences:** none exist — no per-user mute/digest/channel-choice setting anywhere.

**What's needed for the Work OS experience:** a scheduler (even the simplest form — one
cron-hit HTTP endpoint an external scheduler calls) is the hard prerequisite for anything
proactive. This is real, new infrastructure this codebase has never needed before — which
is exactly why it's sequenced *after* Phase 4 in this report's roadmap (§24), so its
content (what's worth proactively notifying someone about) is defined by the reporting
layer first, rather than guessed at in isolation.

---

## 10. Calendar Assessment

Doc 03/doc 13/doc 19 all deliberately deferred a full calendar. Re-confirmed this session:
no `CalendarEvent`/`Meeting` model, no calendar grid UI, no external-calendar OAuth
anywhere in the codebase.

**Does Phase 4 need it?** No. None of the gaps ranked in §5 require a calendar to close.
`Task.dueDate` (deadline awareness) and `ProjectDate` (project milestones) already flow
into the Today screen and dashboards without any calendar UI — the *data* calendar would
eventually visualize already exists and is already surfaced elsewhere.

**Minimum capability that would eventually strengthen the Work OS, when its turn comes:**
a **read-only aggregation view** (a week/month grid plotting `Task.dueDate` +
`ProjectDate` + `DailyPlanItem.scheduledStart/scheduledEnd`) needs **zero new write
model** — every field it would render already exists (doc 19 §23 designed exactly this
hook in advance). This remains correctly deferred; building anything beyond that
read-only aggregation (meeting booking, external sync, recurrence) would be solving a
problem no current user has expressed, and is explicitly guarded against (prompt §21).

---

## 11. Reporting & Management Visibility

This is the section that drives the Phase 4 recommendation, so it is treated in full
depth.

**What a manager/team head/org admin can answer today**, verified against
`reporting.service.ts`'s three methods (`getPersonalDashboard`, `getTeamDashboard`,
`getOrganizationDashboard`) and their UI consumers
(`apps/web/app/(app)/organizations/[orgId]/page.tsx`,
`apps/web/app/(app)/organizations/[orgId]/teams/[teamId]/page.tsx`):

| Question | Answerable today? | Evidence |
|---|---|---|
| What is being worked on? | Yes | `getTeamDashboard`'s `teamTasks`/`inProgress` buckets. |
| Who is overloaded? | Partial | `workload` array in `getTeamDashboard` gives active-task **count** per member — no notion of *planned minutes* vs *capacity* (Phase 3 concepts), no cross-team rollup. |
| What is overdue? | Yes | `overdue` bucket, all three dashboard levels. |
| What is blocked? | **No** | `TaskDependency` exists in schema, is completely unused (§15) — there is no "blocked" concept anywhere in the running system. |
| What is stuck in acknowledgement? | **No** | No query anywhere filters `TaskAssignment` by `PENDING_ACKNOWLEDGEMENT` age. The data exists (`createdAt` on `TaskAssignment`); nothing reads it this way. |
| What is repeatedly carried forward? | **No** | `DailyPlanItem.carriedFromItemId` chain is written correctly, never read outside the write path itself (§4/§7). |
| Which teams have bottlenecks? | Partial | `teamPerformance` in `getOrganizationDashboard` gives total/completed/overdue per team — a snapshot, not a trend, and has no acknowledgement-stuck or carry-forward signal. |
| What work is unplanned? | **No** | `DailyPlanItem.isUnplanned` exists (Phase 3), zero aggregate query reads it. |
| What work is completed? | Yes | `completed` bucket at all three levels. |
| Where does work originate? | Yes, per-task | `Task.originDepartmentId`/`originTeamId` — used in `departmentPerformance`/`teamPerformance`, but only as a *filter* dimension, never surfaced as its own "where is work coming from" view. |
| Who is accountable now? | Yes, per-task | `TaskAssignment.isCurrent` — visible on the task detail page, never aggregated ("show me everything Rahul is currently accountable for, across every team"). |

**Should management visibility come before AI?** Yes, unambiguously, for the reason
stated in the AI Strategy Principle (prompt §14, reaffirmed in §16 of this report): AI
bottleneck-detection and workload-analysis features (doc 18 §6 #14/#15) are only as
trustworthy as the deterministic aggregation underneath them. Building an AI feature that
says "Rahul looks overloaded" without first having a deterministic, testable
`getWorkload()` query to ground it in would make the AI feature itself the source of
truth — exactly what the AI Strategy Principle forbids.

**Scope discipline (per the brief's own warning not to build a BI platform):** this phase
should add new **queries**, not new **storage** — no event-sourcing table, no
time-series/history table, no charting library. Every signal listed above is computable
from `Task`, `TaskAssignment`, `DailyPlanItem`, and `AuditLog` as they exist today.

---

## 12. Capacity / Time / Scheduling

**What Phase 3 actually implemented**, verified against `daily-work.service.ts`:
`computeCapacityMinutes(workingHours, workDate)` — a pure function reading
`User.workingHours` (nullable `Json`, default-applied-in-code as Mon–Fri 09:00–17:00 when
null) and returning a per-weekday minute count; `plannedMinutes` is the sum of each
`DailyPlanItem.plannedDurationMinutes` (falling back to `Task.estimatedDurationMinutes`)
for that day's active items. Both are surfaced together in one `GET /me/workday` response
and rendered as a progress bar on the Today screen.

**What is explicitly NOT implemented, by design (doc 19 §17, reaffirmed unchanged this
session):** any persisted work-session/pause-resume history; any planned-vs-actual
reconciliation report; any team-level capacity aggregation (the `workload` count in
`getTeamDashboard` is task-count-based, not minutes-based — the two capacity concepts,
Phase 1's and Phase 3's, do not currently talk to each other).

**Does the next phase need any of this?** No new time-tracking work is warranted (per the
brief's explicit "do not automatically build time tracking"). What *is* immediately
actionable without any new infrastructure: **team-level capacity aggregation** — summing
each member's `plannedMinutes`/`capacityMinutes` for `getTeamDashboard`'s `workload` array
— is a natural, cheap addition that belongs inside the recommended Phase 4 (§23), since
the underlying per-person numbers already exist; only the aggregation query is missing.

**No profile-editing UI exists to set `User.workingHours`** (doc 18 flagged this gap,
still true) — every user is currently on the default 8h/weekday policy in practice. Not a
blocker for Phase 4 (the default is a reasonable, working assumption), but worth naming as
a small, separate gap for whenever profile management gets built.

---

## 13. Recurring Work

**Foundational or can wait?** Can wait — confirmed by inspecting every candidate use case
the brief names (daily routines, weekly reports, monthly administrative work,
institutional processes, repeated approvals, recurring maintenance) against the current
loop: none of them are blocked by the *absence* of recurrence; a user can already
re-create a similar task manually, and nothing in Phases 1–3 assumed recurrence would
exist. No recurrence field exists on `Task`, `ProjectDate`, or `DailyPlanItem` — adding one
now, before the reporting/notification layers that would make recurring work *useful*
(e.g., "this recurring task is now overdue for the third time") exist, would be building
ahead of its own payoff. Correctly deferred (§24 roadmap places it after Phase 6).

---

## 14. Workflow / Review / Approval

The `ASSIGNMENT → ACKNOWLEDGEMENT → EXECUTION → SUBMISSION → REVIEW → COMPLETION` chain
(doc 05/06, `assignment.service.ts` + `task.service.ts`'s `submitTask`/`reviewTask`) is
**complete and sufficient** for the scenarios this product targets — verified by the fact
that all 101 E2E scenarios, including every multi-hop cross-team/cross-department pattern,
pass against exactly this chain with no gaps found.

**Missing workflow capabilities, named without recommending ERP/BPM scope:**
- **Multi-step/parallel review** (today: exactly one designated reviewer, the assignor) —
  not needed yet; no evidence any current scenario requires more than one approver.
- **Delegation of review authority** — a reviewer who is unavailable has no way to
  delegate; a real but narrow gap, not urgent.
- **SLA/escalation on a stuck review** — directly related to the "stuck in
  acknowledgement" reporting gap (§11) and should be considered together with it once
  Phase 6 (notifications) exists to act on it, not built as a new workflow primitive now.

None of these rise to Phase 4 priority; they are correctly smaller than the visibility gap
this report recommends addressing first.

---

## 15. Dependency / Blocker Assessment

`TaskDependency` (`taskId`, `dependsOnTaskId`, `type: BLOCKS | RELATES_TO`) — **confirmed
dead**: zero references anywhere outside `schema.prisma` (re-grepped this session,
identical finding to doc 18). No route creates one, no service reads one, no UI shows a
"blocked by" indicator anywhere, including on the task detail page.

**Functional? No. Sufficient? No — it doesn't function at all today.
Architecturally incomplete? Yes** — the model captures only a pairwise relationship with
no traversal/cycle-detection logic, no query for "what am I blocked on," and no
interaction with the task lifecycle (a task with an unresolved `BLOCKS` dependency can
still be started/submitted/completed with no warning).

**Should blocking relationships become visible in the daily workflow?** Not in Phase 4.
This is a real, coherent future feature (a "blocked" badge on Today/Inbox items, a
disallow-start-if-blocked rule) — but it requires building the traversal/query logic this
model has never had, and doesn't rank above the management-visibility gap on any of the
brief's weighted criteria. Recommendation: leave `TaskDependency` dormant until a specific
scenario needs it, rather than either building on it now or removing it — removing it
would be a needless destructive migration for a model that costs nothing sitting unused.

---

## 16. AI Readiness & AI Strategy

Re-affirms and sharpens doc 18 §6's findings now that Phase 3 exists.

**Directly answering the brief's question: "Should AI be the next major phase, or should
infrastructure/product capabilities come first?"** Infrastructure/product capabilities
first — specifically, the two things this report identifies as missing
(management-visibility aggregation, §11; a scheduler, §9) are named as explicit
prerequisites by the AI Strategy Principle itself: "AI should sit ON TOP OF a reliable
Work Graph" and must never become "a second source of truth." Two of the highest-value AI
capabilities from doc 18's list — workload analysis (#11) and bottleneck detection (#12) —
are **only as good as the deterministic query underneath them**, which does not exist yet
(§11's table shows every one of those questions is currently "No" or "Partial").

**What Phase 4 (Reporting) unlocks for AI, concretely, once built:** a deterministic
`getWorkload()`/`getStuckWork()`/`getCarryForwardRepeat()` query becomes the exact
function an AI feature would call to ground any "why am I overloaded" or "what's at risk"
answer — never inventing the number itself. This is a direct, mechanical instance of the
AI Strategy Principle's requirement that "AI recommendations must ultimately operate
through existing domain services."

**Already schema-ready, unchanged from doc 18** (re-confirmed): NL task creation, task
parsing, checklist generation, conversation summarization, project summarization — all
map directly onto existing, already-Zod-validated input contracts
(`createTaskSchema`, `addDailyPlanItemSchema`, etc.), requiring no new domain work, only
an AI-produced payload validated through the identical schema a human's UI submits.

**Still genuinely infrastructure-blocked, unchanged:** deadline intelligence and risk
prediction (no historical estimate-vs-actual data exists at any real volume yet — a data
problem, not a schema problem); daily-planning assistant and morning/end-of-day AI
assistants (need the `DailyPlanItem` model, which now exists as of Phase 3, **and** would
most naturally also read the Phase 4 reporting layer once it exists, for anything beyond
one person's own day).

**Never**, per the explicit guardrail (reaffirmed, not weakened by anything found this
session): AI must not invent users/teams, silently reassign work, silently change
deadlines, silently modify task lifecycle, bypass permissions, or touch the database
directly. Every service audited this session (`daily-work.service.ts` included) enforces
authorization identically regardless of caller identity — an AI-driven caller would be
subject to the exact same `isCurrentOwner`/`canViewTask`/permission checks a human request
is, with no special-cased bypass anywhere. This property should be explicitly preserved,
not re-derived, whenever an AI feature is eventually built: it must call the same service
methods a human-driven route calls, never a parallel privileged path.

---

## 17. Mobile Readiness

Re-confirms doc 18 §7, with one Phase-3-specific note.

**Still true:** cookie-only session (`apps/web/lib/session.ts` — no bearer-token/API-key
mode); no push-notification plumbing (no device-token storage anywhere in the schema).

**Pagination — Phase 3 improved rather than worsened this**: `DailyWorkService.listHistory`
correctly uses the established `{items, nextCursor}` shape (matching
`AuditService`/`ConversationService`/`NotificationService`'s convention) — doc 19 §25
explicitly called this out as "corrects rather than repeats" the inconsistency. However,
the inconsistency itself is **not fixed**: `DailyWorkService.listItems` (deliberately, by
design — a day's plan is small) and `ProjectService.listMembers`/`.listTeams`/`.listDates`,
`TaskService.listComments`/`.listUpdates` still return bare arrays. Net: no regression, no
fix — same mixed state as doc 18 found.

**Not a Phase 4 concern** — these corrections belong to the "mobile readiness corrections"
phase already sequenced after Search/Reporting/Notifications in both doc 18 and this
report's roadmap (§24), specifically so they aren't fixed piecemeal per-phase but as one
deliberate pass right before a mobile client is actually built.

---

## 18. Security & Production Readiness

**MVP product gaps** (would affect a real pilot user today, distinct from infrastructure):
- No password-reset flow (self-serve signup without one is a support burden).
- Local-disk file storage — a genuine correctness risk (not just a performance one) the
  moment there is more than one running app instance; files uploaded via one instance are
  invisible to requests served by another.

**Production hardening gaps** (do not block continued development on a single instance,
but block a real launch):
- Postgres RLS — still a single application-layer enforcement path (§AM); every E2E
  cross-tenant scenario passes today, but there is no second, DB-level backstop.
- Rate limiting — zero, anywhere (§AN); login/signup can be hit at unlimited frequency.
- Observability — zero structured logging or error tracking (§AQ); a production incident
  today would be debugged blind.
- Backups — the Postgres data lives in a bare Docker named volume with no backup policy.
- No CI pipeline — every quality gate (typecheck/lint/test/E2E) has been run manually,
  disciplined so far specifically because each phase's own process has enforced it, which
  does not scale past a single contributor.

**Do these gaps disappear because tests pass?** No, and this report treats them as
unchanged, real gaps regardless of the fact that all 101 E2E scenarios (including
adversarial cross-tenant/IDOR-shaped ones) pass — test-passing proves the *application-
layer* authorization logic is correct; it says nothing about the *infrastructure* layer
(RLS, rate limiting, backups, observability) that a production deployment additionally
needs. **None of these are Phase 4** — Phase 4 as recommended in this report is a
read-only, additive-query feature with no new authorization surface, no new attack
surface, and no dependency on any of the above being fixed first.

---

## 19. UX Friction Analysis

Walking a real employee's day against the actual current UI:

- **Morning — "Where do I look first?"** Answered well: `/today` (Phase 3) is now the
  first nav item and gives a genuine "what's going on" view (yesterday-unclosed banner,
  Inbox, capacity). Low friction.
- **During work — "What should I work on now?"** Answered well: the Work tab's Now/Next/
  Later grouping. Low friction.
- **When interrupted — "What changed?"** Moderate friction: the notification bell exists
  and is accurate, but is poll-based (30s) and has no click-through to the relevant item
  from the dropdown itself (only the full `/notifications` page links out) — a small,
  previously-flagged (doc 18 §10) UX gap, still present, not urgent.
- **When someone assigns work — "What do I need to do?"** Answered well: notification +
  Pending Acceptance bucket on the dashboard + Inbox on Today.
- **When discussing work — "Where does the conversation live?"** Answered well and
  genuinely differentiated: exactly one conversation per task or per project, never
  ambiguous.
- **When files arrive — "Where are they?"** Answered well: Files tab, task or project
  scoped.
- **At deadline — "What is at risk?"** **High friction, this is the clearest UX symptom of
  the §11 gap**: an individual sees their own overdue items; a manager has no equivalent
  "what's at risk across my team" view stronger than raw counts.
- **End of day — "What remains?"** Answered well: the Close tab forces an honest
  accounting (doc 19's core design goal, verified working in this session's own browser
  walkthrough).
- **Next morning — "What changed overnight?"** Moderate friction: START shows carried-
  forward items and new assignments, but nothing summarizes *what happened* (who
  completed what, what got reassigned) — this is exactly the kind of digest a Phase 4
  reporting layer (read) plus a later Phase 6 notification (push) would jointly resolve.

---

## 20. Individual vs Organization Fit

**Does the current product work for a solo individual?** Yes, fully — personal workspace,
personal tasks, personal Today/Inbox/Close all function identically to the organizational
path minus assignment/acknowledgement (which personal tasks skip by design, doc 13 #11).

**Does it work for an institutional/organizational user (departments, teams, team heads,
cross-team assignment, approvals, projects/events)?** Yes, for the *individual contributor
and reviewer* roles — every scenario the E2E suite exercises (Management → Marketing Team
→ Team Head → internal distribution → accept → review → complete) works correctly. **No**,
for the *manager/team-head/org-admin* role specifically in one respect: they can see
individual task lists and snapshot counts, but cannot see the aggregate signals (stuck
work, overload, repeat carry-forward) that role most needs — this is precisely gap #1
(§5) and precisely why it is recommended now: **the roadmap has, so far, systematically
strengthened the individual-contributor experience (Phases 2A/2B/3) while leaving the
manager-facing side at its Phase-1 baseline.** Phase 4 corrects that imbalance rather than
adding a third individual-facing feature in a row.

---

## 21. Phase 4 Options

Five realistic candidates evaluated, each against the same template.

### Option A — Management Visibility / Work Graph Reporting *(recommended, see §22)*
- **Objective:** surface acknowledgement-stuck, overloaded, repeat-carry-forward, and
  unplanned-work signals at the team/org level.
- **User problem:** "I can't see what's actually happening across my team without
  clicking into every task."
- **Why now:** Phase 3 just generated the richest new signal set the product has ever
  had, and none of it is visible past the individual owner (§4/§11).
- **Capabilities:** extend `getTeamDashboard`/`getOrganizationDashboard` with new
  aggregate queries; no new UI *pages*, extend the existing team/org dashboard pages.
- **Dependencies:** none beyond existing data.
- **Architectural impact:** none — pure additive query methods on `ReportingService`.
- **Schema impact:** **zero new tables/columns.**
- **API impact:** the existing `/organizations/:id/reports/*` routes' response shapes
  extended (additive fields), no new routes strictly required (though a dedicated
  "stuck work" endpoint is reasonable — see §23).
- **UI impact:** additive sections on the existing team/org dashboard pages.
- **Security implications:** none new — reuses `REPORTS_VIEW` exactly as already scoped.
- **Testing impact:** new unit tests for the aggregation logic, new E2E scenarios
  verifying the numbers and that `REPORTS_VIEW` scoping still holds.
- **Implementation complexity:** S–M.
- **Future capabilities unlocked:** AI bottleneck/workload analysis, future proactive
  notification content, exec-level summaries.
- **Risks:** query performance at scale if not indexed carefully (§26); scope creep into
  a full BI platform if not deliberately bounded (§23 sets the boundary).
- **Deliberately excludes:** charts/trend-over-time storage, export, any new schema.

### Option B — Proactive Notifications / Work Reminders
- **Objective:** fire `DEADLINE_APPROACHING`/`TASK_OVERDUE` and similar time-based alerts.
- **Why not now:** requires a scheduler — the first genuinely new piece of infrastructure
  this codebase would need (§9/§AO) — and its most valuable content (what's actually
  worth alerting on) is better defined by Option A first.
- **Complexity:** M–L. **Risk:** Medium (new infra class).

### Option C — Calendar & Workday Integration
- **Objective:** a read-only week/month aggregation of dates.
- **Why not now:** §10 — no current gap requires it; the underlying data already surfaces
  elsewhere without a calendar UI.
- **Complexity:** S–M. **Risk:** Low, but zero urgency.

### Option D — Recurring Work
- **Objective:** recurring tasks/routines.
- **Why not now:** §13 — nothing in the current loop is blocked by its absence, and its
  payoff is much higher once Options A/B exist to make a recurring-and-overdue task
  actually visible/actionable.
- **Complexity:** M. **Risk:** Medium (touches task lifecycle generation logic).

### Option E — Production Infrastructure / Hardening
- **Objective:** object storage, backups, rate limiting, observability, deploy target.
- **Why not "Phase 4" specifically:** it is not a product-loop phase at all — it's a
  parallel, ongoing track (§18) that should start whenever there's a real launch target,
  independent of which product phase is "next." Framing it as competing with A–D would be
  a category error; it doesn't compete, it runs alongside.
- **Complexity:** M. **Risk:** Medium (external provider integration, not product logic).

---

## 22. Recommended Phase 4

**Option A — Management Visibility / Work Graph Reporting.**

**Why this?** It is the only option that scores highest on the brief's own explicitly-
weighted criteria (loop-strengthening, differentiation, architectural leverage) while
*also* being among the cheapest and lowest-risk to build — no new schema, no new
infrastructure class, no new authorization surface. That combination does not repeat for
any other candidate.

**Why now?** Phase 3 specifically created a body of data (planned/unplanned/carried-
forward/capacity) that is currently generated and then goes nowhere — every day, every
close, every carry-forward writes real signal that only the individual who created it will
ever see. Leaving that unexploited for another phase would mean shipping a fourth
individual-facing feature in a row (2A conversations, 2B files, 3 daily cycle) while the
manager-facing side of an explicitly institutional product (§20) stays frozen at its
Phase-1 shape.

**Why not the others?** Search (§8/Option-equivalent) is real and cheap but does not close
any loop step — it is correctly next, not first. Notifications (Option B) need
infrastructure this codebase has never built and are better-targeted once this phase
defines their content. Calendar (Option C) and Recurring Work (Option D) have no current
gap forcing them, per §10/§13. Production hardening (Option E) is not a competing
product-phase choice at all — it is a parallel track independent of this decision.

**What it unlocks:** the deterministic foundation the AI Strategy Principle requires
before workload-analysis/bottleneck-detection AI features can be trusted (§16); richer
future notification content (§9, Phase 6); and, per §20, restores parity between how well
the product currently serves an individual contributor versus a team head/org admin.

**How it strengthens "run your entire working day from one place":** today that promise
is fully true for one person's day. This phase makes it true for the person **responsible
for several other people's days** — a team head opening the app should be able to see, in
one place, exactly the same kind of "what's actually going on" clarity Phase 3 just gave
individuals, one level up.

---

## 23. Phase 4 Scope Boundary

**MUST HAVE**
- Team dashboard: acknowledgement-stuck count (`TaskAssignment` where
  `status=PENDING_ACKNOWLEDGEMENT` older than a configurable threshold), carry-forward-
  repeat count per person/task (walk `DailyPlanItem.carriedFromItemId`), unplanned-work
  ratio, all alongside the existing overdue/workload buckets.
- Organization dashboard: the same signals rolled up per department/team, alongside
  existing `departmentPerformance`/`teamPerformance`.
- Team-level capacity aggregation (sum of `plannedMinutes`/`capacityMinutes` per member,
  §12) added to the existing `workload` array.
- All read-only; reuses `REPORTS_VIEW` exactly as already scoped — no new permission key.

**SHOULD HAVE**
- A dedicated "stuck work" view (assignments pending acknowledgement past a threshold,
  tasks carried forward 2+ times) as its own small UI section, not just numbers.
- An individual's cross-workspace/cross-team workload view (doc 18's previously-flagged
  gap) — "everything Rahul is currently accountable for," not just per-team.

**COULD HAVE**
- CSV export of any of the above tables.
- An "origin of work" breakdown view (which department/team most often originates
  cross-team assignments) — data already exists (`originDepartmentId`/`originTeamId`),
  purely a new aggregation.

**EXPLICITLY DEFERRED**
- Search (§8) — real, valuable, next phase, not this one.
- Any trend-over-time/historical chart — would require new storage (a snapshot/history
  table); this phase is queries over current state only.
- Any notification triggered by these new signals — Phase 6's job, once a scheduler
  exists.
- Any AI-generated summary of these numbers — Phase 9's job, once this phase's
  deterministic queries exist to ground it.
- `TaskDependency`-based "blocked" visibility (§15) — a separate, smaller feature with no
  current forcing function.
- Any new database table, index beyond what the new queries themselves need, or schema
  change of any kind.

---

## 24. Future Roadmap

```
Phase 3 (done) — Daily Work Cycle
   ↓ generates signals nobody but the owner can see
Phase 4 — Management Visibility / Work Graph Reporting
   ↓ defines what's worth finding AND what's worth alerting on
Phase 5 — Search & Navigation
   ↓ (in parallel with 5) defines proactive-notification content
Phase 6 — Proactive Notifications + Scheduler
   ↓ enables recurring work to be usefully surfaced once it exists
Phase 7 — Recurring Work  (only once 6 exists to make it visible/actionable)
   ↓
Phase 8 — Mobile Readiness Corrections (bearer auth, pagination pass) → Mobile App
   ↓
Phase 9 — AI Layer (assistive-only), grounded in Phases 4 + 6's deterministic data
   ↓
Phase 10+ — Calendar MVP, custom-role UI, RLS (before multi-tenant scale),
            billing/SaaS readiness — each triggered by real demand, not built speculatively

Parallel, independent track (can start anytime, does not block or get blocked by the
above): Production Readiness Hardening — object storage, backups, rate limiting,
observability, CI/CD, deploy target.
```

This reorders doc 18's original guess (which had Search as Phase 4, written before Phase
3 existed) based on what Phase 3 actually changed: it created a body of currently-invisible
signal that makes Reporting the higher-leverage next step. Search remains exactly as
valuable as doc 18 found it — just second, not first.

---

## 25. Differentiation Analysis

**What is the unique product loop being built?** Not "tasks with chat bolted on"
(Asana/ClickUp/Monday's shape) and not "chat with tasks bolted on" (Slack/Teams' shape).
The loop this product actually has, verified end-to-end in §4, is: **rigorous
cross-team/cross-department assignment and acknowledgement → task-or-project-scoped
conversation and files → a genuine personal daily-planning ritual → an honest close-of-day
accounting.** No competitor named in the brief owns all four of those pieces as one
connected data model — Asana/ClickUp/Monday have assignment and comments but no
acknowledgement chain with this level of rigor and no daily-close ritual; Notion has
neither assignment rigor nor a daily cycle; Slack/Teams have communication but no task
structure underneath it; Todoist has a personal daily cycle but zero organizational
assignment depth.

**Does the recommended roadmap strengthen or weaken this?** Strengthens it directly.
Reporting-on-the-work-graph (Phase 4) is not a generic dashboard feature — it is
specifically the multi-person view of the *same* four-part loop above, using the *same*
underlying data, not a parallel analytics system. It protects, rather than dilutes, the
brief's explicit principle that **communication + work + daily execution should become
one connected system** — Phase 4 adds a fifth lens (visibility) onto that same connected
system rather than introducing a sixth, unrelated subsystem.

---

## 26. Architectural Risks

- **Query performance at scale for the new aggregate reports** — `getOrganizationDashboard`
  already loads "all tasks" for an org into memory and filters in JavaScript
  (`allTasks.filter(...)` repeated per department/team, `reporting.service.ts` lines
  148–175). This pattern will not scale gracefully to a large organization's full task
  history. Phase 4's implementation should move these aggregations into `groupBy`/`count`
  Prisma queries rather than adding more in-memory filters on top of an already-loaded
  full task list — a real design decision to make deliberately during Phase 4's own
  architecture step, not an afterthought.
- **Scope creep into a BI platform** — explicitly guarded against in §23's deferred list;
  the discipline that made Phases 2B/2C/3 cheap (extend existing services, add zero new
  tables where possible) is the same discipline that keeps this phase small.
- **Carry-forward chain walking cost** — `carriedFromItemId` is a linked list, not a
  materialized depth; computing "carried forward N times" requires walking the chain per
  task. At current and near-term scale this is trivial; if it ever becomes a hot path, a
  denormalized `carryForwardCount` on `DailyPlanItem` would be the natural future
  optimization — not needed for Phase 4's MVP.

---

## 27. Open Questions

- What acknowledgement-pending age threshold counts as "stuck" (1 day? 3 days?) — a
  product decision, not an architectural one; should default to something configurable
  per organization rather than hardcoded, if it ends up mattering enough to expose.
- Should the "stuck work"/"repeat carry-forward" views be visible to the Team Head only,
  or also to the individual whose work is flagged (a transparency vs. surveillance
  question, worth a deliberate product decision before UI copy is written).
- Whether `User.workingHours` should get a settings UI in this phase or remain
  deferred (§12) — leaning deferred, since the default policy is working fine for
  Phase 3's own MVP and no user has hit its absence as a real limitation yet.

---

## 28. Final Recommendation

Phase 4 should be **Management Visibility & Work Graph Reporting** — a read-only,
zero-new-schema extension of the existing `ReportingService` and team/org dashboards that
finally surfaces the signals Phase 3 has been generating all along (stuck acknowledgement,
repeat carry-forward, unplanned-work ratio, per-person capacity) to the people who are
actually accountable for seeing them across a team. It is the highest-leverage, most
differentiating, lowest-risk option evaluated, and it is the correct deterministic
foundation to build before any AI-assisted insight feature, per the AI Strategy Principle.

This is an assessment and recommendation only. Implementation should not begin until a
dedicated architecture report (mirroring docs 17/19's structure — schema-if-any, domain
service extensions, API contract, UI, authorization, testing, security review) is written
and explicitly approved, matching the process used for every phase so far.

READY FOR NEXT PHASE PLANNING
