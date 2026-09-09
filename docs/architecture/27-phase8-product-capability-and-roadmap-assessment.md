# 27 — Phase 8 Product Capability & Roadmap Assessment (Read-Only)

**Status:** Assessment only. No application code, schema, migration, API, UI, test, or dependency change was made while producing this document. Nothing was committed or pushed. **Base state:** `HEAD` = `origin/master` = `94f9d75614d04547c5cc0151052915a8efe197fd` — "feat: add calendar and meeting integration" (Phase 7, complete). One pre-existing uncommitted change from the prior session (`apps/web/instrumentation.ts`, a `next dev`-only bug fix) remains in the working tree, untouched by this assessment — see §12.

**Method:** Fresh repository inspection performed for this document — direct `grep`/`read` of `schema.prisma`, all 12 migrations' raw SQL, the permission catalog, `reporting.service.ts`, `daily-work.service.ts`, `scheduler.service.ts`, `notification.service.ts`, the Today page, the API route tree, and the full test suite — not a restatement of doc 25. Every claim is traceable to a specific grep/read from this session. Doc 25 (pre-Phase-7) is referenced only where independently re-confirmed here.

---

## 1. Executive Summary

Phase 7 closed the single biggest gap doc 25 identified: the Daily Work Cycle's START and PLAN stages no longer run on a fictional capacity number. Fresh inspection confirms this directly — `DailyWorkService.getWorkday()` now returns `meetingMinutes`/`availableMinutes` alongside the existing `capacityMinutes`/`plannedMinutes`, computed from real `CalendarEvent` data (`daily-work.service.ts`, `computeMeetingMinutes`), and the Today page renders a genuine merged timeline of meetings and scheduled task blocks (`DayTimelineCard`, `today/page.tsx`). EXECUTE and CLOSE remain the product's most mature stages, unchanged by Phase 7.

What's left unaddressed, confirmed fresh rather than assumed: `TaskDependency` (37 models total now, up from 35 pre-Phase-7) still has **zero** service, API, UI, or reporting logic anywhere in the codebase — a `grep` across `packages/domain/src`, `apps/web/app`, and `packages/shared/src` for `TaskDependency|taskDependency` returns nothing outside `schema.prisma` itself. Recurrence infrastructure remains **entirely absent** (only a doc-comment disclaiming it). `AiInteraction` and `AI_FEATURES_ENABLED` remain **completely unreferenced**. Zero `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` statements exist across all 12 migrations. Zero `TODO`/`FIXME`/`HACK` markers exist anywhere in the codebase — a genuinely clean, deliberate build, not one accumulating deferred debt.

A fresh 12-dimension weighted evaluation (§7, using the exact dimensions this assessment specifies, not doc 25's) produces a close but clear result: **Task Dependencies / Blocked Work Visibility (7.17/10)** narrowly leads **Recurring Work (6.93/10)**, both well ahead of **AI Work Assistant (5.82/10)**. Dependencies wins specifically on architecture-reuse, time-to-value, and AI-readiness grounds — it requires **zero schema migration** (the model has existed unused since Phase 1) — while Recurring Work still scores slightly higher on raw user value. This is a genuinely close call, resolved in §11.

**Recommended Phase 8: Task Dependencies / Blocked Work Visibility.** It is the cheapest-to-ship, fastest-to-value, most AI-relevant capability available, it activates dormant infrastructure rather than building new infrastructure, and it directly answers the brief's own "DEPENDENCIES" item in the product's stated understanding list — something nothing built through Phase 7 addresses at all.

---

## 2. Fresh Codebase Inspection — Current State

| Area | Status | Evidence (this session) |
|---|---|---|
| Schema | **37 models**, 12 migrations, all additive | `grep -c "^model " schema.prisma` = 37; `ls migrations` = 12 dirs |
| Permissions | **34 keys** | `grep -c "key:" permissions.catalog.ts` = 34 (33 pre-Phase-7 + `calendar_event.create`) |
| Notification types | **15 live values** | Full enumeration via grep of `notification.service.ts`; `REVIEW_COMPLETED` confirmed still absent (removed Phase 6) |
| Scheduler | **3 scheduled checks** | `tickDeadlineApproaching`, `tickOverdue`, `tickMeetingStartingSoon` — all present in `scheduler.service.ts` |
| API routes | **73 routes** | `find apps/web/app/api -name route.ts \| wc -l` |
| Tests | **12 domain test files**, **137 E2E scenarios** | Fresh count via grep |
| Calendar (Phase 7) | **IMPLEMENTED** | `CalendarEvent`/`CalendarEventParticipant` live, capacity formula extended, Today timeline merged |
| `TaskDependency` | **SCHEMA-READY, ZERO USAGE** | `schema.prisma:765-776`; zero hits for `TaskDependency\|taskDependency` anywhere else in the codebase |
| Recurrence | **ABSENT** | Only `ProjectDate`'s own "no recurrence" doc comment; no rule model, no generation logic |
| `AiInteraction` | **ABSENT (dormant schema only)** | `schema.prisma:896-911`; zero code references |
| `AI_FEATURES_ENABLED` | **ABSENT (dead flag)** | Zero references in any `.ts`/`.tsx` file |
| Actual time tracking | **ABSENT** | `DailyPlanItem.startedAt`/`completedAt` exist but are never subtracted/compared anywhere — confirmed via grep for `completedAt.*startedAt`/`actualDuration`/`elapsedMinutes`: zero hits |
| RLS | **ABSENT** | Zero `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` across all 12 migration files |
| Production infra | **ABSENT** | No `Dockerfile`, no `.github/workflows`, no `apps/web/middleware.ts` |
| Storage adapters | **ONE** (`LocalDiskStorageService`) | Interface documents an S3-swap point; nothing else implements it |
| `TODO`/`FIXME`/`HACK` | **ZERO anywhere** | Full-repo grep, zero matches |

---

## 3. Dormant / Hidden Capability Findings (Classified)

Classification key: **A** production-ready foundation · **B** partially implemented · **C** schema-ready but unused · **D** placeholder only · **E** not present.

| Capability | Class | Evidence |
|---|---|---|
| `TaskDependency` model + `DependencyType` enum (`BLOCKS`/`RELATES_TO`) | **C** | Full model with FKs, cascade rules, and a `@@unique([taskId, dependsOnTaskId])` constraint since Phase 1 — but **no index on `dependsOnTaskId` alone**, meaning a "what's blocking task X" reverse lookup has no supporting index today (a real, small implementation cost, not a blocker — see §9). Zero service/API/UI/reporting logic. |
| `AiInteraction` model | **D** | Fully-shaped table (`feature`, `input`, `output`, `model`, `tokensUsed`, `acceptedByUser`) — never written to, never read. |
| `AI_FEATURES_ENABLED` env flag | **D** | Declared in `.env`/`.env.example`, read by nothing. |
| `AuditSource.AI` enum value | **D** | Declared alongside `UI`/`API`/`SYSTEM`, never set by any code path (re-confirmed this session — same as doc 25's finding, unchanged). |
| **NEW this session:** `CalendarEvent.visibility` (`PRIVATE`/`ORGANIZATION_VISIBLE`) | **B** | Backend fully supports both values (schema, service, API, authorization logic per doc 26 §13) — but the Today page's event-creation form (`NewCalendarEventForm`) has **no visibility control at all**; every event created through the UI defaults to `PRIVATE`. `ORGANIZATION_VISIBLE` is reachable only via direct API calls. Confirmed via grep: zero mentions of "visibility" anywhere in `today/page.tsx`. |
| **NEW this session:** `CalendarEvent.externalProvider`/`externalEventId` | **D** | Reserved, unused columns — the same "named extension point" pattern as `DeliveryChannel.PUSH`/`.EMAIL`, explicitly for a future external-sync phase (doc 26 §11), never wired to anything. |
| `DailyPlanItem.startedAt`/`.completedAt` | **B** | Set correctly by the Start/Complete transition endpoints (doc 19 §28) — but never subtracted to produce an actual-elapsed-time figure anywhere. The raw signal exists; the derived metric does not. |
| `DeliveryChannel.PUSH`/`.EMAIL` | **D** | Unchanged since doc 25 — declared, never set; every notification is still `IN_APP` only. |
| PostgreSQL RLS / two-role DB pattern | **A** (for what it covers) / **E** (for tenant isolation) | The `app_runtime` least-privilege role with `audit_logs` UPDATE/DELETE revoked is real, production-grade defense-in-depth for audit immutability specifically — but zero row-level tenant-isolation policy exists; isolation is 100% application-layer. |
| `TODO`/`FIXME`/`HACK` markers | **E** | None exist — worth stating positively: this is not a codebase with silently-deferred technical debt. |

---

## 4. The Product As It Exists Now — Workflow Description

**START → PLAN → EXECUTE → CLOSE**, with the Work Graph connections the brief asks about, described from fresh reading:

- **Assignments → Acknowledgement:** `TaskAssignment`'s `PENDING_ACKNOWLEDGEMENT`/`ACCEPTED`/`DECLINED` lifecycle, individual or team, with full chain history via `parentAssignmentId` — unchanged, mature since Phase 1.
- **→ Tasks:** the `Task` state machine (`DRAFT`→...→`COMPLETED`/`CANCELLED`) — unchanged, mature.
- **→ Task conversations / Files:** one conversation per task/project, attachments with authorization-checked storage — unchanged since Phase 2.
- **→ Search:** cross-entity full-text search (tasks/projects/messages), re-authorized per candidate — unchanged since Phase 5.
- **→ Calendar:** **new since Phase 7** — meetings now sit alongside tasks in one timeline, with real capacity math.
- **→ Daily planning:** `Workday`/`DailyPlanItem`, now capacity-accurate (Phase 7's own contribution).
- **→ Notifications:** three scheduled checks (deadline approaching, overdue, meeting starting soon) plus event-triggered ones (assignment, review, mention, comment) — unchanged in kind since Phase 6, expanded in coverage by Phase 7.
- **→ Execution → Review → Reporting:** task progress updates, review approve/changes-requested, and team/department/org dashboards with attention-required signals — unchanged, mature since Phases 1/4.

**The biggest remaining gap, evidence-based, not assumed:** nothing in this chain understands **why** a task can't be started yet, or **that it will recur**. A task blocked by another task looks identical, in every screen, to a task that's simply not started — `reporting.service.ts` has zero awareness of dependencies (confirmed by grep this session), and the Today page's Plan tab will happily let a user schedule a task that's actually waiting on someone else's unfinished work. This is the concrete, current gap — not a restatement of doc 25's calendar finding, which Phase 7 already closed.

---

## 5. Daily Work Cycle Assessment (Post-Phase-7)

| Stage | Assessment | Weakest? |
|---|---|---|
| **START** | Strong. Merged timeline (meetings + scheduled tasks), notifications for anything urgent, real capacity number. | No |
| **PLAN** | Meaningfully improved by Phase 7 (real capacity), but still cannot answer "is this actually startable" or "will I need to redo this next week." | **Yes** |
| **EXECUTE** | The most mature stage in the product — full task lifecycle, assignment, conversation, review. Untouched and unweakened by anything since Phase 1. | No |
| **CLOSE** | Solid — carry-forward, disposition, reflection. No new gap surfaced by Calendar. | No |

**Weakest stage: PLAN**, narrowed specifically to two missing facts: *is this task actually blocked*, and *does this obligation repeat*. Both point directly at the two top-ranked candidates in §7.

---

## 6. Calendar Impact on Other Candidates (Rule 8)

Evaluated on evidence, not assumed:

- **Recurring Work:** Calendar makes this candidate **more valuable** (recurring meetings are now a felt gap — every standing meeting must be created one at a time) and **cheaper** (the scheduler pattern is now proven three times over, not once).
- **Dependencies:** Calendar has **no direct effect** on Dependencies' own cost or value — they are orthogonal Work Graph concerns. Dependencies remains exactly as cheap as it always was (zero schema change).
- **AI:** Calendar meaningfully **de-risks** a future AI layer's grounding (real time data now exists) but does **not** make AI ready today — dependency/blocking awareness and recurring-obligation awareness are still absent, and those are exactly the signals a genuine "what should I move" recommendation needs (§8).
- **Time Tracking:** **No effect.** Orthogonal.
- **Reporting:** Calendar creates one small, natural extension opportunity (team meeting-load visibility) but this is a minor addition to an existing feature, not a phase-level driver on its own.
- **Notifications:** Calendar proved the scheduler scales cheaply to new check types (three now, versus one designed at a time previously) — this **lowers the cost** of any future notification-adjacent work (including Recurring Work's own notification needs) but doesn't itself justify a new notifications-expansion phase.

**Conclusion, per Rule 8's explicit instruction not to auto-recommend Calendar expansion:** there is no fresh evidence justifying a Calendar-expansion phase. External sync is still blocked on the same missing OAuth/production infrastructure doc 25 identified (unchanged — still no `Dockerfile`, no CI, confirmed again this session). Calendar expansion is not recommended.

---

## 7. Weighted Candidate Scoring

**Weights** (12 dimensions specified by this assessment, summing to 100%): User value 20%, Strategic importance 15%, Daily usage frequency 10%, AI readiness/leverage 10%, Data value/future intelligence 10%, Dependency on existing architecture (inverted, 10=fully reuses) 10%, Implementation feasibility (inverted, 10=easy) 8%, Product differentiation 7%, Risk (inverted, 10=low) 5%, Time-to-value (inverted, 10=fast) 3%, Competitive positioning 1%, Revenue potential 1%.

**Rationale:** user value, strategic importance, and daily usage frequency dominate (45% combined) because the product's stated mission is daily usefulness, not near-term monetization — consistent with this codebase's own evidence (no billing infrastructure, no plan/tier model, no signal of an imminent go-to-market motion). Revenue/competitive positioning are given minimal weight (2% combined) for the same evidence-based reason. Architecture-reuse and implementation feasibility carry real weight (18% combined) because this project's entire five-phase track record has been built on "extend, don't duplicate" — a candidate that fights the existing architecture is a worse bet than the numbers alone might suggest, and this assessment weights that discipline accordingly.

| Candidate | User value | Strategic | Daily freq. | AI readiness | Data value | Arch. reuse | Feasibility | Differ. | Risk | Time-to-value | Competitive | Revenue | **Weighted** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Task Dependencies** | 7 | 7 | 5 | 8 | 8 | 10 | 8 | 4 | 8 | 8 | 4 | 2 | **7.17** |
| **Recurring Work** | 8 | 7 | 6 | 6 | 6 | 9 | 7 | 5 | 8 | 7 | 4 | 2 | **6.93** |
| **AI Work Assistant** | 7 | 9 | 6 | 5 | 5 | 3 | 2 | 9 | 3 | 3 | 8 | 6 | **5.82** |
| **Time Tracking** | 5 | 5 | 4 | 5 | 6 | 7 | 6 | 3 | 8 | 6 | 3 | 3 | **5.28** |
| **Calendar expansion** | 5 | 4 | 5 | 3 | 3 | 6 | 4 | 4 | 5 | 4 | 5 | 2 | **4.34** |
| **Notifications expansion** | 4 | 3 | 3 | 2 | 2 | 8 | 6 | 2 | 6 | 5 | 2 | 2 | **3.86** |
| **Projects/Events expansion** | 3 | 3 | 3 | 2 | 2 | 7 | 6 | 2 | 7 | 5 | 2 | 2 | **3.61** |
| **Row-Level Security** | 2 | 4 | 1 | 6 | 1 | 5 | 4 | 1 | 5 | 4 | 2 | 2 | **3.10** |
| **Production Infra Hardening** | 2 | 4 | 1 | 2 | 1 | 5 | 5 | 1 | 6 | 4 | 2 | 2 | **2.83** |
| **Voice interaction** | 2 | 2 | 2 | 1 | 1 | 1 | 3 | 4 | 6 | 2 | 3 | 1 | **2.12** |
| **Billing / SaaS** | 1 | 2 | 1 | 1 | 1 | 2 | 4 | 1 | 5 | 3 | 2 | 8 | **1.83** |

**Ranking:** Task Dependencies (7.17) → Recurring Work (6.93) → AI (5.82) → Time Tracking (5.28) → Calendar expansion (4.34) → Notifications expansion (3.86) → Projects/Events expansion (3.61) → RLS (3.10) → Production Infra (2.83) → Voice (2.12) → Billing (1.83).

No score was adjusted after computing the ranking. This is a genuinely close top pair (0.24 apart) — Recurring Work actually scores *higher* on raw User Value (8 vs 7); Dependencies wins on architecture-reuse, feasibility, time-to-value, and AI-readiness, which is an honest, evidence-grounded basis for a decision, not a manufactured tiebreak — resolved explicitly in §11.

---

## 8. AI Readiness Assessment (Rule 6)

**Does the system currently know enough for a genuinely useful AI Work Assistant?** Checked against the brief's own list:

| Signal | Known today? |
|---|---|
| Tasks, assignments, assignment history, accountability | **Yes** — mature since Phase 1 |
| Teams, departments | **Yes** |
| Workdays, planned tasks, scheduled task blocks | **Yes** — Phase 3, now UI-active via Phase 7 |
| Calendar meetings | **Yes** — Phase 7 |
| Deadlines | **Yes** |
| Notifications | **Yes** |
| Conversations, files | **Yes** |
| Projects | **Yes** |
| Reports/workload/capacity | **Yes** — Phase 4/7 |
| **Dependencies** | **No** — confirmed dormant (§3) |
| **Recurrence** | **No** — confirmed absent (§3) |
| **Actual time spent** | **No** — raw timestamps exist, never derived into a duration (§3) |

**What AI could actually DO today**, concretely: retrieve/search (`SearchService`), summarize a day (`getWorkday` + `getDayTimeline`'s already-computed capacity/meeting/plan data), create a task, propose a reschedule *within* a single day. **What it could not yet do honestly:** explain *why* a task can't move ("it's blocking on Priya's review" — no such fact exists in the graph), recognize a standing obligation ("this is your weekly report — want me to handle the next four?" — no recurrence concept exists), or reason about historical effort accuracy ("this kind of task usually takes you longer than estimated" — no actual-duration signal exists).

**The distinction the brief asks for, stated plainly:** built today, an AI layer would be **text-generation over retrieval** — a competent search-and-summarize assistant. `UNDERSTAND → RETRIEVE → REASON → PROPOSE → CONFIRM → ACT → VERIFY` only becomes a genuine *reasoning* pipeline once REASON has real structural facts (blocked-by, recurs-every, typically-takes) to reason *over* — not just a longer list of things to retrieve. This is not a reason to build AI worse; it's a reason the REASON step has nothing non-trivial to do yet. **Do not build AI now** — not because AI lacks value, but because the specific data it would need to reason about priority and schedulability doesn't exist, and both of the top two Phase 8 candidates (§7) exist specifically to create that data.

---

## 9. Task Dependencies — Implementation Reality Check (Rule 9)

Inspected directly, as required:

- **Schema:** exists in full — `TaskDependency { id, taskId, dependsOnTaskId, type: DependencyType }`, cascade-delete on both FKs, `@@unique([taskId, dependsOnTaskId])` preventing duplicate edges.
- **Relations:** `Task.dependencies` (`DependentTask` relation) and `Task.dependedOnBy` (`DependsOnTask` relation) are both already declared on the `Task` model — confirmed present.
- **Indexes:** only the compound unique constraint. **No standalone index on `dependsOnTaskId`** — a "what blocks task X" reverse-lookup query (`WHERE dependsOnTaskId = ?`) would do a full scan of `task_dependencies` today. At current/near-term scale this is not a real performance problem (doc 21 §18's own "human-scale, not a hot path" reasoning applies identically), but a future migration adding `@@index([dependsOnTaskId])` is a named, cheap, worth-doing addition if this phase proceeds.
- **Service logic:** none.
- **APIs:** none.
- **UI:** none.
- **Reporting awareness:** none — confirmed by grep, `reporting.service.ts` has zero mention of dependencies/blocking.
- **Task status awareness:** none — `task-status.machine.ts`'s state machine has no "blocked" state; a blocked task today is indistinguishable from an unstarted one anywhere in the product.

**Verdict: this is genuinely an "almost free next capability," not a deceptively large one** — the two structural pieces that usually make a feature expensive (schema design, and getting the graph relationships right) are **already done and already correct**. The actual work is: a service layer (create/remove a dependency edge with authorization + cycle-detection), a small API surface (2-3 routes), a UI affordance (show blocking/blocked-by on the task detail page, exclude blocked work from "what can I plan today"), and one reporting extension (a real "blocked" signal replacing Phase 4's narrower "stuck in acknowledgement" proxy). **Cycle detection is the one piece of genuine algorithmic work** (a task cannot transitively depend on itself) — small, well-understood, but real engineering, not just CRUD.

---

## 10. Recurring Work Assessment (Rule 10)

Every sub-question the brief asks, addressed directly:

- **Recurring tasks/assignments/deadlines:** none exist; would need a recurrence-rule model (fixed-cadence patterns, not full RRULE) plus a generation job.
- **Recurring calendar events:** also none — Phase 7 deliberately shipped Calendar without recurrence (doc 26 §14/§23), specifically so one future recurrence engine could serve both tasks and meetings rather than building two.
- **Recurring daily plans:** would follow naturally from task generation (a newly-generated recurring task's occurrence gets planned the same way any task does).
- **Recurrence exceptions / missed occurrences:** genuine design surface — "skip this one," "an occurrence nobody ever did." Not scaffolded anywhere today.
- **Future occurrence generation:** the scheduler (`scheduler.service.ts`) is the natural, already-proven home for this — a fourth tick function, following the exact conditional-claim idempotency pattern the other three already established.
- **Notification behavior, assignment acknowledgement, history, audit:** all fall out for free — a generated task instance is, from the moment it's created, an ordinary `Task` going through the exact same assignment/acknowledgement/audit/notification machinery every other task uses. No new subsystem needed for any of these.
- **Timezone/day-boundary correctness:** the one genuinely tricky part — "every Monday" needs to mean the same local Monday regardless of DST, reusing `local-day.ts`'s already-DST-tested utilities, not a new time abstraction.

**Should recurrence come before or after Dependencies/AI?** **After Dependencies, before AI.** Not because of a hard technical dependency (recurrence doesn't need dependency data), but for architectural coherence: Dependencies deepens the Work Graph's *relationships* (what points to what); Recurring Work deepens its *generation* (what creates what). Building generation logic before the relationship model is stable risks a recurring task later wanting to express "each occurrence also depends on the prior one" — a real, plausible future need — which is cheaper to design correctly if `TaskDependency` is already a live, understood pattern rather than something being retrofitted alongside a new generation system at the same time.

---

## 11. Time Tracking Trade-off (Rule 11)

**Is actual time tracking necessary before AI can make meaningful capacity recommendations? No — not as a hard prerequisite.** A capacity recommendation ("you have 90 minutes free before your 2pm") only needs *planned* duration, *scheduled* meeting time, and working hours — exactly what Phase 7 already computes via `availableMinutes`. Actual-time tracking would improve *estimate calibration* over time ("tasks like this usually take you 50% longer than planned") — a genuine, valuable refinement, but a refinement to an already-functional capacity model, not a missing input it can't run without.

**The trade-off, stated plainly:** building time tracking now means asking users to form a new habit (starting/stopping a timer, or at minimum trusting `startedAt`/`completedAt` as a real signal) for a benefit (calibrated estimates) that only pays off once enough history accumulates — a cold-start problem. Building Dependencies or Recurring Work first means shipping value that's useful on day one, with no habit change required. Time Tracking remains a legitimate, well-scoped *future* addition (§7 ranks it fourth, ahead of everything except the top three) — not urgent now.

---

## 12. Security / Infrastructure — Blocking Check (Rule 12)

Directly answering the brief's explicit question: **does anything here block further product development?**

- **Authorization / tenant isolation:** app-layer, consistent, and heavily tested — 137 E2E scenarios across 7 phases include repeated cross-tenant/cross-department/cross-team denial tests, with no known bypass found at any point in this project's history. **Not blocking.**
- **RLS:** genuinely absent, genuinely valuable as defense-in-depth, genuinely not urgent given the app-layer's track record — same conclusion as doc 25, independently re-verified this session. **Not blocking — later hardening.**
- **API boundaries:** every route re-derives authorization from the session server-side (`withAuth`, `assertOrgMember`/`assertCan` patterns) — unchanged, consistent. **Not blocking.**
- **Object/file access:** `LocalDiskStorageService` is explicitly not production-multi-instance-ready (doc 14's own disclosure) — a real gap, but only relevant once actual deployment is imminent, which this assessment has no evidence of. **Not blocking feature development.**
- **Audit logs:** append-only, DB-enforced immutability (`app_runtime` role has `UPDATE`/`DELETE` revoked on `audit_logs`) — real, verified, unchanged. **Not blocking.**
- **Scheduler / background execution:** single-process, in-instrumentation-hook, explicitly designed and documented for exactly this deployment shape (doc 24 §11) — correct for what exists today. **Not blocking.**
- **Secrets:** `.env`/`.env.local` conventions in place; nothing found hardcoded in source during this or prior sessions' audits. **Not blocking.**
- **Deployment assumptions:** genuinely absent (no Dockerfile, no CI, no public endpoint) — this blocks *external* users and *external* integrations (e.g., calendar sync, per doc 26 §11), but **does not block continuing to build features into this codebase**, which is the actual question Phase 8 is about.

**Conclusion: nothing found is serious enough to block Phase 8 feature development.** Everything in this section is legitimate future hardening, correctly not forced into this phase.

---

## 13. Product Scope Control (Rule 13)

Evaluated against "Run your entire working day from one place," not "how many features can be added":

- **Task Dependencies:** strengthens the promise — it's a property *of* a task, shown *on* the task and *in* the daily plan, not a new app section.
- **Recurring Work:** strengthens the promise — generates the same tasks/plan-items/events the product already has, on autopilot; no new UI paradigm.
- **AI Work Assistant:** strengthens the promise *if and only if* scoped narrowly (a daily-planning assistant reasoning over this product's own data) — the real risk named in §13 is real: built prematurely or broadly, it becomes "a chatbot bolted onto a task manager," the exact disconnected-product failure mode the brief warns against.
- **Time Tracking:** strengthens the promise only if kept minimal (no start/stop timer UI, no utilization dashboards, no billing-adjacent features) — over-built, it becomes a timesheet product.
- **Calendar expansion (external sync):** the clearest risk of becoming a *disconnected* product — "an Outlook competitor" is explicitly not this product's job. Correctly not recommended (§6).
- **Production Infra / RLS:** invisible to the promise either way — neither strengthens nor dilutes it; pure infrastructure, correctly kept out of the numbered roadmap.
- **Billing / Voice:** both would be entirely new product surfaces with no current connection to "running your day" — the two clearest candidates for "don't build yet" on scope-control grounds alone, independent of their (already low) weighted scores.

---

## 14. Recommended Phase 8

**Phase 8: Task Dependencies / Blocked Work Visibility**

**Why now:** highest weighted score (7.17/10, §7), and it directly answers the one item in the brief's own "WHO/WHAT/WHEN/WHERE/WHY/PRIORITY/CAPACITY/DEPENDENCIES/CONTEXT/COMMUNICATION/PROGRESS/RISK" list that nothing built through Phase 7 addresses at all. It is the cheapest capability on the entire board to ship correctly — the schema has been sitting ready, unused, since Phase 1.

**What it unlocks:** a real "blocked" signal in Phase 4's reporting (replacing the narrower "stuck in acknowledgement" proxy with an actual blocking-relationship fact), a PLAN-stage filter ("don't show me work I can't start yet"), and — most importantly for the product's stated AI ambition — the first genuine *reasoning* input for a future AI layer: "why can't this move" finally has a real answer in the data, not just a longer list of tasks to retrieve.

**Why not the alternatives:** Recurring Work is a close second (6.93) and scores higher on raw user value, but costs more (a new recurrence-rule model + generation job vs. zero schema change) and is architecturally cleaner to build *after* Dependencies (§10). AI (5.82) is premature — §8 shows the data it would need to reason well still doesn't exist; building it now yields a shallow assistant. Time Tracking (5.28) is a legitimate future refinement, not a current need (§11). Everything else scores meaningfully lower and either risks scope creep (Calendar expansion, Billing, Voice) or is correctly-deferred infrastructure (RLS, Production Hardening) with no evidence of urgency (§12).

**Expected user impact:** a manager or teammate finally sees *why* something hasn't started, instead of guessing; daily planning stops silently including work that can't actually be done yet; reporting's "attention required" signal gets meaningfully more precise.

**Technical scope (high-level, not an implementation design — that is a separate future document):** a `TaskDependencyService` (or equivalent) with authorization-checked create/remove and cycle detection; 2-3 new API routes; task-detail UI showing blocking/blocked-by relationships; Today/Plan-stage awareness of blocked status; one Phase 4 reporting extension for a real "blocked" count; one small future-facing index addition (`@@index([dependsOnTaskId])`, §9).

**Dependencies:** none blocking — the schema, relations, and every authorization pattern this needs already exist and are already proven at scale across six prior phases.

**Risks:** cycle detection is genuine (not large) algorithmic work, not pure CRUD — must be gotten right the first time, the same discipline every prior phase's state-machine work already applied. Cross-task visibility must be re-derived through existing authorization (a dependency reference must never leak the existence of a task the viewer can't otherwise see) — directly analogous to the calendar-visibility discipline Phase 7 just established, and should be held to the same standard.

**What Phase 9 should probably be:** **Recurring Work** — now cheap (the scheduler is proven three times over) and architecturally natural once Dependencies has stabilized the Work Graph's relationship model (§10).

---

## 15. Phase 8 Scope Boundary

**IN SCOPE:**
- Activating `TaskDependency`/`DependencyType` (already-existing schema) with a dedicated service layer.
- Create/remove a dependency edge, with authorization matching existing task-access rules and cycle detection.
- Task-detail UI: show what this task is blocked by, and what it blocks.
- PLAN-stage awareness: a blocked task is visibly distinguishable from an unstarted one; daily planning can flag or exclude it.
- One `@@index([dependsOnTaskId])` migration (additive, minimal).
- One Phase 4 reporting extension: a real blocked-work count/list, alongside (not replacing) the existing stuck-acknowledgement signal.
- Full authorization/tenant-isolation test coverage matching this project's established discipline.

**OUT OF SCOPE:**
- Recurring Work (Phase 9, per §14).
- AI Work Assistant, Voice (deferred per §8/§13).
- Time Tracking (deferred per §11).
- Calendar expansion of any kind, including external sync (no fresh evidence, §6).
- RLS, production infrastructure hardening (not blocking, §12 — pursue opportunistically, not as a numbered phase).
- Billing/SaaS readiness (no go-to-market evidence).
- Critical-path/Gantt-style scheduling, automatic date-shifting when a blocker slips, or any visualization beyond a plain blocking/blocked-by list.
- `RELATES_TO` dependency type's own UI/behavior beyond simple display — `BLOCKS` is the only type with real product behavior (excluding blocked work from planning); `RELATES_TO` is informational only, correctly minimal.

**DEFERRED (named, not forgotten):**
- Cross-task dependency-aware scheduling ("Task B's deadline should account for Task A blocking it") — real future value, needs Dependencies to exist and stabilize first.
- Team/department-level "what's blocking my team" reporting rollups — a Phase 4-style extension, reasonable once the base capability proves out.

---

## Final Report

### 1. Current product capability summary
Tasks/assignments/acknowledgement (Phase 1), conversations/files (Phase 2), Daily Work Cycle (Phase 3), management reporting (Phase 4), search (Phase 5), notifications/scheduler (Phase 6), calendar/meetings with real capacity math (Phase 7) — all confirmed live and mature via fresh inspection. 37 schema models, 73 API routes, 12 domain test files, 137 E2E scenarios, zero `TODO`/`FIXME` debt anywhere.

### 2. Dormant/hidden capability findings
`TaskDependency` (schema-ready, zero usage — the standout finding), `AiInteraction`/`AI_FEATURES_ENABLED`/`AuditSource.AI` (all dormant placeholders, unchanged since doc 25), recurrence (entirely absent), actual time tracking (raw timestamps exist, never derived), RLS (absent), production infra (absent). **Newly found this session:** `CalendarEvent.visibility` is backend-complete but has no UI control (every event defaults `PRIVATE`); `CalendarEvent.externalProvider`/`externalEventId` are reserved-unused, matching the `DeliveryChannel.PUSH`/`.EMAIL` placeholder pattern.

### 3. Daily Work Cycle assessment
START and CLOSE are strong; EXECUTE remains the most mature stage overall; **PLAN is the weakest stage**, specifically because the system cannot tell a user whether a task is actually startable or whether it recurs.

### 4. Calendar impact
Calendar makes Recurring Work both more valuable and cheaper; has no effect on Dependencies; meaningfully de-risks (without completing) AI's future grounding; no effect on Time Tracking; proves the scheduler scales cheaply to new checks. No fresh evidence justifies a Calendar-expansion phase.

### 5. AI readiness assessment
Most Work Graph facts are known (tasks, assignments, calendar, capacity, reports). The three genuinely missing signals — dependencies, recurrence, actual time — are exactly what a *reasoning* (not just retrieving) AI layer needs. AI is not recommended for Phase 8.

### 6. Candidate phase comparison
Eleven candidates evaluated; see §7 for the full table. Task Dependencies and Recurring Work are a clear top pair, well ahead of everything else; AI is a strong but premature third.

### 7. Weighted scoring table
See §7. Weights: User value 20%, Strategic importance 15%, Daily usage frequency 10%, AI readiness 10%, Data value 10%, Architecture reuse 10%, Feasibility 8%, Differentiation 7%, Risk 5%, Time-to-value 3%, Competitive positioning 1%, Revenue potential 1%.

### 8. Recommended Phase 8
**Task Dependencies / Blocked Work Visibility** — 7.17/10, highest-ranked, cheapest to ship, zero schema migration needed beyond one small index, directly closes the weakest Daily Work Cycle stage.

### 9. Phase 8 scope boundary
See §15 — in scope: dependency CRUD + cycle detection, task-detail UI, PLAN-stage blocked-work awareness, one reporting extension, one index. Out of scope: everything else, explicitly enumerated.

### 10. Recommended Phase 9
**Recurring Work** — now cheap given the scheduler's three-times-proven pattern, and architecturally cleaner once Dependencies has stabilized the Work Graph's relationship model.

### 11. Major risks / open questions
Cycle detection is real (if small) algorithmic work, not pure CRUD. Dependency visibility must be re-derived through existing task authorization, never a shortcut. Open product question: should a blocked task's daily-plan inclusion be a hard exclusion or a soft warning — a UX decision, not an architecture one, left to the future implementation-architecture step.

### 12. Confirmation — no application code changed
Confirmed. The only non-doc file difference in the working tree (`apps/web/instrumentation.ts`) predates this assessment entirely — a `next dev`-only bug fix from the prior session, left exactly as it was, not touched during this assessment.

### 13. Confirmation — no schema/API/UI/test/dependency changes
Confirmed. No `schema.prisma` change, no migration created, no API route added/modified, no UI component changed, no test file changed, no `package.json` touched, in this session.

### 14. Confirmation — no commit/push performed
Confirmed. No `git commit`, no `git push` executed in this session.

### 15. Git status and HEAD
```
HEAD:          94f9d75614d04547c5cc0151052915a8efe197fd
origin/master: 94f9d75614d04547c5cc0151052915a8efe197fd
```
Working tree: **not fully clean** — `apps/web/instrumentation.ts` remains modified from the prior session's dev-mode bug fix (never committed, per that session's own open question to the user); this assessment added one new untracked file, `docs/architecture/27-phase8-product-capability-and-roadmap-assessment.md`. Nothing else changed.
