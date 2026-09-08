# 25 — Phase 7 Product Capability & Architecture Assessment (Read-Only)

**Status:** Assessment only. No code, schema, migration, config, API, UI, or test changes were made while producing this document. Nothing was committed or pushed. **Base state:** `HEAD` = `051ac12f18f87623ec137379d7585761f50450fb` — "feat: add proactive notifications and scheduler" (Phase 6, complete).

**Method:** Fresh repository inspection performed for this document — direct `grep`/`read` of `schema.prisma`, every migration's raw SQL, all five `package.json` files, `docker-compose.yml`, `.env`/`.env.example`, `AuditSource`/`AiInteraction`/`TaskDependency`/`ProjectDate` model definitions, `PermissionService`, `StorageService`, and the domain service directory — not a restatement of prior assessment documents. Every claim below is traceable to a specific file/grep result from this session; where a prior doc's finding is reused, it is independently re-verified here, not assumed.

---

## 1. Executive Summary

Phase 6 closed the Awareness gap (notifications + scheduler). What remains is a product that is structurally excellent at **Execution** (task lifecycle, assignment, conversation, review) and now reasonably good at **Awareness** and **organizational visibility**, but still fictional at **Planning accuracy**: a person's daily "capacity" is computed purely from `User.workingHours` (an advisory 9–5 default) with zero knowledge of the meetings that actually consume a chunk of that time. Nothing in the schema, service layer, or dependencies represents a meeting, an external calendar, a recurrence rule, an actual-time-spent record, or an AI/voice interaction — every one of these is either completely absent or, in AI's case, a set of inert placeholders (an unused `AiInteraction` model, an unused `AI_FEATURES_ENABLED` flag, an unused `AuditSource.AI` enum value — all discovered fresh this session).

The weighted evaluation in §8 — built from first principles, not reverse-engineered from a preferred answer — ranks **Calendar & Meeting Integration** first (7.10/10), ahead of **Recurring Work** (6.30), a newly-surfaced **Task Dependencies / Blocked Work** candidate (5.75), and **AI Work Assistant** (5.00). AI's own weighted position is not an accident of scoring: it is genuinely under-founded today (Dependency/Foundation-value score of 2/10 — zero provider, zero tool architecture, zero eval harness) and would today only be capable of a shallow "search / create / basic report" chatbot, not the "understand time, capacity, and priorities" assistant the product's stated vision requires. Voice ranks lowest of all nine candidates (2.55) because it has no standalone value without an AI reasoning layer beneath it and zero existing infrastructure of its own.

**Recommended Phase 7: Calendar & Meeting Integration — internal MVP only** (no external sync, no conflict detection, no meeting recurrence in v1). It is the single highest-leverage next move because it is the one gap that simultaneously distorts three of the five Daily Work Cycle stages (START, PLAN, EXECUTE) today, and it is the precondition for any future AI "run my day" reasoning to be grounded in reality rather than a fiction.

---

## 2. Current Product State (Freshly Verified)

- **Schema:** 35 Prisma models (`grep -c "^model " schema.prisma`), 11 migrations (10 pre-Phase-6 + Phase 6's own `20260908101253_phase6_notification_scheduler_markers`), all additive.
- **API surface:** 67 route files under `apps/web/app/api/v1/`.
- **Tests:** 78/78 domain unit/integration tests (11 files), 127/127 E2E scenarios (`tests/e2e/abc-college.e2e.test.ts`, 2055 lines) — both counts independently re-verified this session via `grep -c '[[:space:]]it('`.
- **Dependencies (all 5 workspaces, full inventory read fresh):** `next`, `react`, `prisma`/`@prisma/client`, `zod`, `bcryptjs`, `jose`, `vitest`, plus dev tooling (`eslint`, `tailwindcss`, `postcss`, `tsx`). **Zero** AI SDK, calendar library, cron/queue library, email/push SDK, rate-limiting library, or observability/APM package anywhere.

Everything listed in the prompt's "current product has" section (Org/Dept/Team, RBAC, Tasks, Assignment+ack, history, lifecycle, Projects/Events, Conversations, Files, Daily Work Cycle, Workday, DailyPlanItem, reporting, Search, Notification Center, deadline/overdue/reassignment notifications, scheduler, audit log) is confirmed **IMPLEMENTED** by this session's inspection, not merely by memory of having built it.

---

## 3. Gap Analysis

### A. Calendar / Meetings — **MISSING** (one deliberate placeholder only)

The only calendar-adjacent schema is `ProjectDate` (`schema.prisma:454-468`): `title`, `date` (`@db.Date`, no time-of-day), `notes`. Its own doc comment (line 450-453, unchanged since Phase 2C) states it is "deliberately not the Calendar module (no recurrence, no reminders, no time-of-day)." `Project.kind = EVENT` (line ~104) is a plain labeling enum value on `Project`, not a calendar entity. There is **no** `Meeting`/`CalendarEvent`/`Attendee`/`TimeBlock`/`Availability` model anywhere, no external-calendar dependency in any `package.json`, no meeting↔task conversion logic, no conflict-detection code, no time-blocking UI. **Verdict: MISSING**, with one intentional, minimal placeholder (`ProjectDate`) that a real Calendar phase would supersede or extend, not build on top of as-is.

### B. Time Tracking / Capacity — **PARTIALLY IMPLEMENTED** (planned-side only)

Real, in-use fields: `Task.estimatedDurationMinutes` (one-time estimate), `DailyPlanItem.plannedDurationMinutes` (day-specific estimate, explicitly documented as separate from the task-level estimate), `User.workingHours` (`Json?`, advisory Mon–Fri 9–5 default), and `computeCapacityMinutes()` in `daily-work.service.ts:46`, which turns `workingHours` into a daily capacity figure compared against the sum of `plannedDurationMinutes` (surfaced today via Phase 4's over-capacity signal). `DailyPlanItem.startedAt`/`completedAt` exist as coarse per-item timestamps (when a person started/finished an item *today*), but there is **no `actualDurationMinutes`, no start/stop timer, no time-entry table, no "planned vs. actual" analytics anywhere** — confirmed by grep across the domain service layer and schema; the only "actual" signal is a start/stop instant pair, never a computed duration. **Verdict: PARTIALLY IMPLEMENTED** — the planning/estimation half exists and is already wired into reporting; the tracking/measurement half does not exist at all.

### C. Recurring Work — **MISSING**

Zero recurrence infrastructure of any kind — confirmed by grep for `recur|rrule|cron` across schema, domain, shared, and web layers; every hit was either the same `ProjectDate` "no recurrence" doc comment or unrelated (`recursive` filesystem flags). No recurrence-rule model, no generation job, no recurring-assignment logic. Notably, **the one blocking dependency this had in the Phase 6 assessment (doc 23/24 — "no scheduler exists yet") is now resolved**: `packages/domain/src/services/scheduler.service.ts` exists and runs a real 15-minute tick. Recurring Work is now a matter of adding one more scheduled check to an already-built execution model, not building the execution model itself.

### D. AI — **ARCHITECTED-ONLY PLACEHOLDERS, otherwise MISSING**

Fresh findings this session, all confirmed by direct grep with zero live usage found:
- `AiInteraction` model (`schema.prisma:797-813`) — `feature`/`input`/`output`/`model`/`tokensUsed`/`acceptedByUser` fields, fully defined — **referenced nowhere outside its own model definition.**
- `AI_FEATURES_ENABLED="false"` in `.env`/`.env.example` — **never read by any code path** (`grep -rn "AI_FEATURES_ENABLED"` across all TS/TSX returns zero hits).
- `AuditSource` enum (`schema.prisma:78-83`) already declares an `AI` value alongside `UI`/`API`/`SYSTEM` — **never set anywhere**; every existing audit-log write uses `UI` or `API` only (`opts.source ?? "API"` pattern in `assignment.service.ts` and elsewhere).
- No AI provider SDK, no embeddings/vector dependency, no prompt/tool-calling scaffolding, no eval harness — confirmed via the full dependency inventory (§2).

What *does* exist and would matter for a future AI layer, unprompted by any AI-specific code, is the **capability-based authorization discipline** itself: 33 cataloged permissions (`permissions.catalog.ts`, `grep -c "key:"`), one scope-resolution engine (`resolveEffectivePermissions`), and a `PermissionService` (`can`/`assertCan`/`hasAnyGrantWithPermission`/`assertOrgMember`, 11 methods) reused by every domain service without exception. This is real foundation *for* AI to build on, but it is foundation the rest of the product already needed — it was not built with AI in mind, and AI itself has no scaffolding at all. **Verdict: the schema was designed with clear forward intent (an `AI` audit source, an `AiInteraction` table) but zero of it is wired to anything live. This is materially different from "AI infrastructure exists" — it is closer to "someone left three labeled hooks on an otherwise-empty wall."**

### E. Voice — **MISSING, zero groundwork**

`grep -rliE "voice|speech|whisper|transcri|microphone|audio"` across schema, domain, shared, web app/lib/components, and `package.json` returns **zero results**. There is no partial voice capability to build on — not even a text-to-speech dependency, not a microphone permission flow, nothing.

### F. Security / Tenant Isolation — **App-layer only, by design; RLS MISSING**

Re-confirmed by direct grep across **all 11** migration SQL files (not just a doc's claim about it): zero `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` statements anywhere, including the new Phase 6 migration. What is real and verified: the two-Postgres-role pattern (`app` owner / `app_runtime` least-privilege, `packages/db/prisma/migrations/20260906072700_.../migration.sql:44-56`) — `app_runtime` is granted `SELECT/INSERT/UPDATE/DELETE` on all tables but has `UPDATE`/`DELETE` on `audit_logs` explicitly revoked. This is genuine defense-in-depth for **audit immutability specifically**, not for cross-tenant isolation — tenant isolation today is 100% application-layer (`PermissionService` + per-service predicates: `canViewTask`, `canAccessProject`/`canAccessConversation`, `assertOrgMember`), and it is consistently and thoroughly tested (127 E2E scenarios, many explicitly asserting cross-tenant/cross-department/cross-team 403s). **Verdict: MISSING at the database layer, but not neglected** — the app-layer model is mature, uniform, and has zero known bypass across five phases of adversarial-style E2E testing.

### G. Production Readiness — **MISSING across almost every dimension**

Direct, fresh confirmation: `docker-compose.yml` defines Postgres only (no app container, no worker container). No `Dockerfile` for `apps/web` anywhere in the repo. No `.github/workflows` or any CI config. No `apps/web/middleware.ts`. No health-check route under `apps/web/app/api`. No rate-limiting code anywhere (`grep -rliE "rate.?limit"` — zero hits). Exactly **one** `StorageService` implementation (`LocalDiskStorageService`) — the interface itself (`storage.service.ts:8-19`) explicitly documents an S3-swap extension point (`getSignedDownloadUrl?`), architected for but not built. Zero email/push provider SDK in any `package.json` (`DeliveryChannel.PUSH`/`.EMAIL` are declared Prisma enum values, never set — same "inert placeholder" pattern as AI's hooks). No observability/APM dependency. **Verdict: MISSING**, and — separate from any feature-phase ranking — this is the actual precondition for the product being usable by anyone outside a local dev machine at all. This assessment does not have evidence of an imminent deployment/pilot timeline, so it is scored honestly on its own merits in §8 rather than assumed urgent.

---

## 4. Work Operating System Cycle Analysis (Baseline, Before Any Phase 7 Candidate)

| Stage | Current support | Evidence |
|---|---|---|
| **START** | Workday auto-opens on first touch (`DailyWorkService`, doc 19), notifications surface anything urgent since Phase 6 | Solid for *task* awareness; blind to calendar commitments |
| **PLAN** | `DailyPlanItem` planning against real tasks, carry-forward, capacity vs. `workingHours` | **Capacity figure is fictional** — ignores meetings entirely; this is the single biggest distortion in the cycle |
| **EXECUTE** | Full task state machine, assignment/ack, conversation, attachments, checklist, review | The most mature stage — no material gap found |
| **CLOSE** | `Workday.closedAt`, per-item disposition (`COMPLETED_TODAY`/`CARRIED_FORWARD`/`DROPPED`/`MOVED_TO_BACKLOG`), `reflectionNote` | Solid |
| **TOMORROW READY** | Carry-forward chains, unplanned-work ratio, over-capacity detection (Phase 4), deadline/overdue notifications (Phase 6) | Solid — this is where Phases 3/4/6 specifically targeted effort, and it shows |

This table is the empirical basis for §8's weighting: any candidate that materially improves **PLAN**'s accuracy scores higher on Daily Work Cycle impact than one that only adds a new, separate capability alongside an already-strong stage (e.g., Time Tracking mostly adds analytics *around* EXECUTE, which doesn't need it).

---

## 5. Per-Candidate Work OS Cycle Impact

| Candidate | START | PLAN | EXECUTE | CLOSE | Tomorrow | Work Graph | Org visibility | Day-to-day usefulness |
|---|---|---|---|---|---|---|---|---|
| Calendar | ✓ (real day picture) | ✓✓ (real capacity) | ✓ (time-blocked focus) | – | – | ✓ | ✓ (team availability, later) | High |
| Time Tracking | – | ~ (estimate accuracy over time) | – | ~ | – | ~ | ✓ (utilization reporting) | Moderate |
| Recurring Work | – | ✓ (auto-populated obligations) | – | ✓ (skip/exception handling) | ~ | ✓ | ~ | High (for recurring-work-heavy roles) |
| Task Dependencies | – | ✓ (exclude blocked work) | ✓ (enforce/advise ordering) | – | – | ✓✓ | ✓ (real "blocked" signal, not just stuck-ack) | Moderate–High |
| AI Work Assistant | ~ (today: shallow) | ~ (today: shallow) | ~ | – | ~ | consumes, doesn't deepen | ~ | High *ceiling*, low *today* |
| Voice | – | – | ~ (hands-free capture) | – | – | – | – | Low today (downstream of AI) |
| RLS | – | – | – | – | – | – | – | None (invisible to users) |
| Production Infra | – | – | – | – | – | – | – | None directly; enables everything indirectly |
| Billing | – | – | – | – | – | – | – | None (internal-facing today) |

(✓✓ = strong direct improvement, ✓ = meaningful improvement, ~ = marginal/indirect, – = no material effect)

---

## 6. Weighted Decision Matrix

Weights per the brief: User Value 20%, Daily Cycle 15%, Work Graph 10%, Differentiation 10%, Dependency/Foundation 10%, MVP/Startup 10%, AI Readiness 5%, Impl. Complexity (inverted, 10=simplest) 5%, Security Risk (inverted, 10=lowest risk) 5%, Production Readiness 5%, Long-term Defensibility 5%.

| Candidate | User Value | Daily Cycle | Work Graph | Differ. | Dep/Found. | MVP/Startup | AI Ready | Impl. (inv) | Security (inv) | Prod. Ready | Defensib. | **Weighted** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Calendar & Meetings** | 8 | 9 | 6 | 7 | 7 | 6 | 8 | 5 | 7 | 3 | 8 | **7.10** |
| **Recurring Work** | 7 | 7 | 6 | 5 | 6 | 8 | 5 | 7 | 8 | 3 | 4 | **6.30** |
| **Task Dependencies (discovered)** | 6 | 6 | 8 | 4 | 5 | 7 | 6 | 7 | 7 | 1 | 4 | **5.75** |
| **AI Work Assistant** | 6 | 5 | 5 | 8 | 2 | 4 | 6 | 2 | 3 | 3 | 9 | **5.00** |
| **Time Tracking & Capacity** | 5 | 4 | 4 | 3 | 4 | 5 | 4 | 7 | 8 | 2 | 3 | **4.40** |
| **Production Infrastructure** | 2 | 1 | 1 | 1 | 7 | 5 | 3 | 4 | 4 | 10 | 2 | **3.10** |
| **PostgreSQL RLS** | 3 | 1 | 2 | 2 | 4 | 2 | 6 | 3 | 5 | 6 | 5 | **3.00** |
| **Voice Assistant** | 3 | 2 | 1 | 4 | 1 | 2 | 2 | 4 | 6 | 2 | 3 | **2.55** |
| **Billing / SaaS Readiness** | 1 | 1 | 1 | 1 | 2 | 2 | 1 | 4 | 5 | 2 | 3 | **1.70** |

**Ranking:** Calendar (7.10) → Recurring Work (6.30) → Task Dependencies (5.75) → AI Work Assistant (5.00) → Time Tracking (4.40) → Production Infrastructure (3.10) → RLS (3.00) → Voice (2.55) → Billing (1.70).

No score was adjusted after computing the ranking. AI Work Assistant scores highest of all nine candidates on Differentiation (8) and Long-term Defensibility (9) — its overall rank is pulled down specifically by Dependency/Foundation value (2) and Implementation Complexity (2, inverted) and Security Risk (3, inverted), which is the honest, structural argument for sequencing rather than a manufactured result.

---

## 7. The AI Question

**"Should we build AI now, or first build the structured capabilities that make AI substantially more useful?"**

Concretely, today's only realistic AI tool surface is: `SearchService.search()` (task/project/message retrieval), `TaskService.createTask()`/`assign()` (task creation/assignment), `ReportingService` (basic counts/buckets), `NotificationService.listForUser()`. An AI assistant built today, however well-engineered, is architecturally limited to:

```
Task chatbot → search → create task → basic report
```

because those are literally the only structured signals available to reason over. It cannot answer "what should I actually do today" in any way that accounts for real time (no calendar), real obligations that repeat (no recurring work), or real ordering constraints (no dependency graph) — it can only manipulate the Task/Project/Conversation layer, which is exactly what a human already does through the UI. The differentiation this earns is low: it looks like every other "AI wrapper over CRUD" product.

After Phases 7-9 (Calendar, Recurring Work, Task Dependencies) land, the same AI layer inherits genuinely new signals — real time commitments, standing obligations, blocking relationships — and the achievable pipeline becomes:

```
Understand Work → Understand Time → Understand Capacity → Understand Priorities
→ Plan → Recommend → Confirm → Act → Verify → Report
```

**The difference is not "more features for AI to call" — it's that the underlying data finally contains the concepts a genuine daily-planning assistant needs to reason about.** An AI that recommends "move task X to tomorrow, you have 3 hours of meetings and task Y is blocking on someone else" cannot exist until the system itself knows about meetings and blocking relationships. This is the direct, evidence-grounded answer to the brief's own question, and it matches §6's weighted ranking without having been reverse-engineered to match it — AI's low Dependency/Foundation score (2/10) is exactly this argument expressed numerically.

**Conclusion: AI should wait**, specifically for Phases 7-9, not indefinitely.

---

## 8. The Voice Question

Voice is evaluated against four options:

- **A. Phase 7** — rejected. Zero existing infrastructure (§3E), and with no AI reasoning layer to sit on top of, voice today would be nothing more than speech-to-text piped into the existing search box — a UI convenience, not a capability, and the lowest-scoring candidate in the entire matrix (2.55).
- **B. Phase 8/9** — rejected for the same reason. Building it before AI's tool-calling/confirm/execute pipeline exists means throwing the work away once that pipeline lands and changes what voice should actually be able to trigger.
- **C. After AI** — closer, but imprecise: this frames Voice as its own phase that merely comes chronologically later, when it is better understood architecturally as something smaller than a phase.
- **D. Merely a client/interaction layer after the AI tool architecture exists** — **this is the correct framing.** Voice has no Work Graph impact, no Daily Work Cycle impact, and no standalone product value in this assessment's own scoring (every "direct improvement" cell in §5's table is empty or marginal). Once the AI layer (Phase 10, see roadmap) has a trustworthy `PROPOSE → CONFIRM → EXECUTE → VERIFY → AUDIT` pipeline, voice becomes a thin input/output adapter onto that same pipeline — not a new capability requiring its own architecture, authorization model, or Work Graph integration.

**Recommendation: D.** Do not schedule Voice as a numbered phase at all; treat it as a client-layer addition to whatever AI interaction surface Phase 10 produces, evaluated on its own merits only once that surface exists and is proven trustworthy.

---

## 9. Recommended Roadmap

```
Phase 6 (done) — Proactive Work Awareness
   ↓
Phase 7 — Calendar & Meeting Integration (internal MVP)
   ↓ gives PLAN a real capacity figure
Phase 8 — Recurring Work (MVP)
   ↓ cheap now (Phase 6's scheduler already exists); removes manual-recreation tax
Phase 9 — Task Dependencies / Blocked Work Visibility
   ↓ activates the dormant TaskDependency model; Work Graph gains a real "blocked" signal
Phase 10 — AI Work Assistant (grounded, narrow-scope v1)
   ↓ consumes Phases 7-9's structured signals through the existing authorization/audit path
Phase 11 — Voice (client layer only, over Phase 10's AI pipeline)
```

Deferred / parallel-track, not numbered phases: **RLS** (recommend as a gating security review immediately before Phase 10, not its own phase — see §9's Phase 10 entry), **Production Infrastructure** (should track actual deployment/pilot timeline, which this assessment has no evidence about — flagged as an open question, not scheduled blindly), **Time Tracking** (reasonable low-priority fast-follow anytime, no urgency), **Billing** (defer indefinitely, no go-to-market signal in the repo), **Notification email/push delivery** (the `DeliveryChannel` enum already has the extension point — a cheap fast-follow slice of Phase 6 that can land opportunistically, not a phase of its own).

### Phase 7 — Calendar & Meeting Integration (Internal MVP)
- **Objective:** give the Daily Work Cycle a true picture of a day's fixed time commitments so "capacity" stops being fictional.
- **Why it belongs here:** highest weighted score (7.10); the one gap distorting three of five Work OS cycle stages today (§4).
- **Dependencies:** none blocking — reuses `local-day.ts`'s timezone resolution and the existing capacity-computation integration point (`computeCapacityMinutes`) unchanged.
- **Expected user value:** a day's plan finally reflects reality; fewer silently-overcommitted days.
- **Major architecture implications:** one new entity for internal meetings/time-blocks with an attendee/visibility model that must reuse the existing authorization predicates from day one (see §10's explicit warning) — not a parallel access-control system.
- **Unlocks:** task time-blocking, later external sync, later AI daily-planning grounded in real time.
- **Explicitly NOT built here:** Google/Outlook sync, cross-attendee conflict detection, recurring meetings, meeting→task auto-conversion, any external OAuth flow.

### Phase 8 — Recurring Work (MVP)
- **Objective:** eliminate the "recreate this every week by hand" tax for standing obligations.
- **Why it belongs here:** second-highest score (6.30); the one blocking dependency it had (a scheduler) was resolved by Phase 6, making this now cheap.
- **Dependencies:** Phase 6's `runScheduledChecks`/`instrumentation.ts` execution model (already exists) — this becomes one more scheduled check, not a new subsystem.
- **Expected user value:** standing weekly/monthly obligations appear on the right day without manual recreation.
- **Major architecture implications:** a minimal recurrence-rule model (fixed cadence patterns only, not a full RRULE implementation) plus generation logic reusing `AssignmentService`/`TaskService` exactly as a human-created task would.
- **Unlocks:** recurring-obligation visibility in reporting; a natural future hook for recurring meetings from Phase 7.
- **Explicitly NOT built here:** arbitrary custom recurrence expressions, recurring cross-team distribution workflows, recurring approval chains.

### Phase 9 — Task Dependencies / Blocked Work Visibility
- **Objective:** activate the `TaskDependency` model (schema-complete, zero live usage since Phase 1) so "blocked" becomes a real, queryable Work Graph fact instead of an inferred one.
- **Why it belongs here:** third-highest score (5.75), and the single highest Work Graph-impact score (8/10) of any candidate — zero new migration required.
- **Dependencies:** none — schema exists already.
- **Expected user value:** "why can't I start this" gets a real answer; Phase 4's attention-required reporting gains a genuine blocked-work signal (doc 20/21's own long-standing named gap, now closeable at near-zero schema cost).
- **Major architecture implications:** dependency visibility must be re-derived through the same task-level authorization every other cross-task reference uses — a dependency reference must never leak the existence of a task the viewer can't otherwise see.
- **Unlocks:** more precise PLAN-stage filtering (exclude blocked work from today's plan), a stronger AI-readiness signal for prioritization reasoning.
- **Explicitly NOT built here:** critical-path/Gantt-style scheduling, automatic date-shifting cascades when a blocker slips.

### Phase 10 — AI Work Assistant (grounded, narrow v1)
- **Objective:** the "run my day" reasoning layer, built only once Phases 7-9 give it real signals to reason over.
- **Why it belongs here:** §7's own conclusion — building it earlier produces a shallow chatbot; building it here produces something structurally differentiated.
- **Dependencies:** Phases 7-9 (Calendar, Recurring Work, Dependencies) plus a security gate — an explicit RLS/authorization review immediately before this phase (see §10), given AI is the point where an authorization mistake has the highest blast radius of anything built so far.
- **Expected user value:** genuine daily-planning assistance grounded in real time/capacity/obligations/blockers, not task-chatbot search-and-create.
- **Major architecture implications:** every AI action must follow `UNDERSTAND → RETRIEVE → REASON → PROPOSE → CONFIRM → EXECUTE → VERIFY → AUDIT` (§10), reusing `PermissionService`, the task-lifecycle state machines, and the audit log's already-reserved `AuditSource.AI` value — never a parallel write path.
- **Unlocks:** everything AI-adjacent afterward, including Voice.
- **Explicitly NOT built here:** autonomous execution without human confirmation, any tool that bypasses `canViewTask`/`canAccessConversation`-equivalent checks, a general open-ended chatbot with unscoped tool access.

### Phase 11 — Voice (client layer only)
- **Objective:** an alternate input/output modality for Phase 10's already-built, already-trustworthy AI pipeline.
- **Why it belongs here:** §8's conclusion — Voice has no standalone architecture of its own; it is a UI/interaction addition, not a new capability.
- **Dependencies:** Phase 10, fully built and security-reviewed.
- **Expected user value:** hands-free interaction with the same AI actions already available via text.
- **Major architecture implications:** none beyond speech-to-text/text-to-speech integration at the client boundary — no new authorization surface if Phase 10's pipeline is correctly built.
- **Unlocks:** nothing further; this is a terminal client-layer addition, not a foundation for something else.
- **Explicitly NOT built here:** any voice-only feature that doesn't already exist via text AI first.

---

## 10. Special Focus: Calendar MVP

The smallest architecture that creates meaningful value:

**IN v1:** internal time-blocks/meetings (title, start/end instant, optional attendees drawn from the same organization), integrated as a direct input into `computeCapacityMinutes` (a day's true available minutes = `workingHours` minus overlapping meeting time), a day view that shows tasks and meetings together, work-hours/timezone handling reused unchanged from `local-day.ts`.

**OUT of v1, deliberately:** external Google/Outlook calendar sync (a whole OAuth+webhook+token-refresh subsystem — real, but a separate future phase, not a precondition for the core capacity-accuracy value), cross-attendee conflict detection (valuable but requires a mature attendee/availability model this MVP doesn't need yet), meeting recurrence (defer to when Phase 8's recurrence model exists — do not build two separate recurrence systems), meeting→task conversion (a nice-to-have UX flow, not core value), and a full task→calendar time-blocking UI (a natural v2 once the base entity exists).

**Deadline awareness** does not need new Calendar work at all — it is already served by Phase 6's `DEADLINE_APPROACHING`/`TASK_OVERDUE` notifications; Calendar's job is meetings, not deadlines.

**The security discipline that must be non-negotiable from day one (learned directly from Phase 6's own "a notification is a disclosure" principle, generalized):** a meeting's attendee list is exactly as sensitive as a task's assignee list — visibility must be re-derived through the same authorization predicates every other Work Graph entity uses, never a parallel/simpler check because "it's just a calendar."

---

## 11. Special Focus: Time Tracking

Recommendation: **do not build the full stack.** Given §6's low weighted score (4.40) and §4's finding that EXECUTE is already the most mature stage in the product, most of the traditional "time tracking suite" doesn't address a real gap:

- **Start/stop timer:** not needed for v1 — `DailyPlanItem.startedAt`/`completedAt` already provide a coarse "when did you work on this" signal; a dedicated timer UI is a bigger investment than the value it returns right now.
- **Manual time entry:** not needed for v1, same reasoning.
- **Estimated duration:** already exists (`Task.estimatedDurationMinutes`, `DailyPlanItem.plannedDurationMinutes`) — nothing to add.
- **Actual duration:** the one genuinely missing piece with real value — but only worth adding *if* paired with a specific downstream use (e.g., feeding "how long does this kind of task actually take" back into future AI capacity planning, Phase 10+). Recommend deferring even this until there's a concrete consumer for it, rather than collecting data with no use.
- **Capacity / team capacity / utilization / planned-vs-actual analytics:** capacity already exists (Phase 3/4); team-level rollups already exist (Phase 4's `getTeamSignals`). Utilization/planned-vs-actual is the one legitimately new reporting capability here, but it's a reporting extension, not foundational — low urgency.

**Verdict: not a phase of its own.** If ever built, it should be a small, opportunistic addition (an `actualDurationMinutes` field plus one reporting view), not a dedicated phase — and only once there's a concrete consumer (most likely Phase 10's AI, reasoning about realistic time estimates).

---

## 12. Special Focus: Recurring Work

**Should it come before or after Calendar/Time Tracking?** After Calendar (Phase 8, not Phase 7), for one precise reason: Calendar is the higher-leverage capability (§6), and building Recurring Work first would mean either (a) recurring *tasks* only, missing recurring *meetings* entirely (an artificial, confusing split once Calendar lands), or (b) building two separate recurrence systems back-to-back. Sequencing Recurring Work immediately *after* Calendar lets one recurrence model eventually serve both, without forcing Calendar to wait on it (Calendar's v1, per §10, deliberately has no recurrence at all, so there's no ordering deadlock).

**Recommended MVP:** fixed-cadence patterns only (daily / specific weekdays / monthly-on-a-date) — explicitly **not** a full RRULE-standard implementation. Generated task instances reuse `TaskService.createTask`/`AssignmentService.assign` exactly as a human-triggered creation would (no parallel creation path). Exceptions/skipped occurrences: a simple "skip this one" action per generated instance, not a complex exception-calendar. Overdue recurring tasks: no special handling needed — they flow through Phase 6's existing overdue-detection unchanged, since a generated task is, from that point on, an ordinary task. Recurring assignments (who gets the next occurrence) and recurring deadlines (due date offset from generation date) are both in scope for v1 since they're required for the feature to be useful at all; recurring *daily-plan* auto-population (automatically adding the new occurrence to someone's plan, not just creating the task) is a reasonable v1 inclusion given `DailyPlanItem` already exists and doing otherwise would leave newly-generated recurring tasks invisible until manually planned.

---

## 13. Special Focus: AI Future — Architecture Decisions to Make Now

Even with AI deferred to Phase 10, these decisions should shape Phases 7-9 so AI can adopt them later without rework:

- **Every new service method Phases 7-9 add (calendar queries, recurrence generation, dependency checks) should be a plain, typed, authorization-checked function** — exactly the existing pattern (`TaskService`, `AssignmentService`, `ReportingService` already are this) — never a raw-query shortcut that a future AI tool would have to wrap awkwardly.
- **The reserved `AuditSource.AI` enum value (already in the schema, currently unused) is exactly right and should be adopted, unmodified, the moment Phase 10 begins** — every AI-initiated write should audit-log with `source: "AI"`, giving every future report/security-review a free way to distinguish AI actions from human ones without new schema.
- **AI must reuse, never bypass:** `PermissionService.can`/`assertCan` for every action; the existing task/assignment/review state machines (`canTransitionTask`, `canTransitionAssignment`) for every lifecycle mutation; `canViewTask`/`canAccessConversation`/`canAccessProject`-equivalent checks for every retrieval; the acknowledgement model (`PENDING_ACKNOWLEDGEMENT` cannot be skipped by an AI proposing a reassignment any more than by a human); and `AuditService.log` for every write, unconditionally.
- **The `UNDERSTAND → RETRIEVE → REASON → PROPOSE → CONFIRM → EXECUTE → VERIFY → AUDIT` pipeline the brief specifies maps directly onto services that already exist or will exist after Phase 9:** RETRIEVE = `SearchService`/`ReportingService`/Calendar queries/Dependency queries; PROPOSE/CONFIRM = a new, thin layer that never itself mutates anything; EXECUTE = the exact same `TaskService`/`AssignmentService`/`DailyWorkService` calls a human's own UI action would make; VERIFY = re-reading the same authorization-checked state; AUDIT = the reserved `AuditSource.AI` value. **No new write path should ever be introduced for AI — it should always be a new *caller* of the existing, human-tested write paths**, matching exactly the discipline doc 21 §15 already established for future reporting-consumed-by-AI and this assessment's own Phase 10 entry.

---

## 14. Final Decision

1. **Single best Phase 7 capability: Calendar & Meeting Integration (internal MVP).**
2. **Why:** highest weighted score (7.10/10, §6); the one existing gap that simultaneously distorts START, PLAN, and EXECUTE (§4/§5) by making "capacity" fictional; the single biggest unlock for a future AI layer that can reason about real time.
3. **What should NOT be Phase 7:** AI, Voice, Billing, RLS as a standalone phase, Production Infrastructure Hardening as a standalone phase, Time Tracking as a full suite — and, within Calendar itself, not external sync/conflict-detection/meeting-recurrence (§10).
4. **Should AI wait?** Yes — until Phases 7-9 (Calendar, Recurring Work, Task Dependencies) exist. Building it now yields a shallow task-chatbot (§7); building it after yields a genuinely grounded daily-planning assistant.
5. **Should Voice wait?** Yes, further than AI — Voice is not a phase at all in its own right; it is a client/interaction layer over Phase 10's AI pipeline, evaluated only once that pipeline is built and trustworthy (§8).
6. **What capability should follow Phase 7?** Recurring Work (Phase 8) — now cheap because Phase 6's scheduler already exists — then Task Dependencies (Phase 9).
7. **What should the product look like after Phase 10?** A complete, structured Work Graph (Tasks, Assignments, Projects, Conversations, Daily Work Cycle, Calendar, Recurring Work, Dependencies, Reporting, Search, Notifications/Scheduler) with a grounded AI layer sitting on top that reasons about real time, capacity, obligations, and blockers, and acts exclusively through the same authorization- and audit-checked paths a human uses — never a shortcut around them.

**Confidence level:** High on the qualitative ranking (Calendar > Recurring Work > Task Dependencies > AI > everything else) — it held up consistently across every independent dimension in §6, not just the top-line weighted score. Moderate on the exact Calendar MVP boundary (§10) — that is a genuine product-scope judgment call, not something pure codebase evidence can fully settle.

**Weighted score of recommended Phase 7 (Calendar):** 7.10 / 10.

**Top 3 alternatives:** Recurring Work (6.30), Task Dependencies / Blocked Work Visibility (5.75), AI Work Assistant (5.00).

**Biggest architectural risk:** introducing Calendar's attendee/meeting-visibility model without disciplined reuse of the existing authorization predicates from day one — repeating, in a new domain, the exact class of mistake Phase 6 specifically had to guard against for notifications ("a notification is a disclosure" → "a meeting attendee list is a disclosure").

**Biggest product risk:** over-scoping Calendar into a full external-sync/conflict-detection/recurring-meetings system for v1 instead of proving the core "capacity now reflects reality" value first — burning a phase's effort on breadth the weighted matrix doesn't actually reward (Calendar's own Implementation-Complexity score is already the second-lowest of the top four candidates).

**Biggest opportunity:** once Calendar, Recurring Work, and Task Dependencies exist (Phases 7-9), this product will hold every structured signal — time, obligations, blockers, priorities, capacity, organizational visibility — a genuinely differentiated "run your day" AI needs, at which point Phase 10 stops being a chatbot-over-CRUD and becomes the actual product-defining capability the vision describes. The sequencing recommended here is itself the differentiation strategy.

---

## 15. Audit Trail

**Files/areas inspected this session (representative, not exhaustive):** `packages/db/prisma/schema.prisma` (full, targeted sections re-read: `ProjectDate`, `Task`, `TaskDependency`, `AiInteraction`, `AuditLog`, `AuditSource`, `Notification`/`DeliveryChannel`); all 11 migration `migration.sql` files (grepped for RLS/policy statements and role grants); all 5 `package.json` files (full dependency inventory); `docker-compose.yml`; `.env`/`.env.example`; `packages/domain/src/services/daily-work.service.ts`, `scheduler.service.ts`, `storage.service.ts`, `assignment.service.ts`; `packages/domain/src/services/permission.service.ts`; `packages/shared/src/permissions/permissions.catalog.ts`; `tests/e2e/abc-college.e2e.test.ts` (scenario count); `apps/web/app/api/v1/**/route.ts` (route inventory).

**Assessment document:** created at `docs/architecture/25-phase7-product-capability-and-roadmap-assessment.md` (this file — did not previously exist).

**Git HEAD:** `051ac12f18f87623ec137379d7585761f50450fb` (unchanged throughout this session).

**No application code changed. No schema/migration changed. No API/UI/test code changed. No commit created. No push performed.**
