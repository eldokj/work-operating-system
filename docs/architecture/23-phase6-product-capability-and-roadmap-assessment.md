# 23 — Phase 6 Product Capability & Architecture Assessment (Read-Only)

**Status:** Assessment only. No code, schema, migration, config, API, UI, or test changes were made while producing this document. Nothing was committed or pushed.

**Method:** Fresh repository inspection performed for this document (grep sweeps across `packages/`, `apps/web/`, root config, `.env.example`, `docker-compose.yml`, `package.json` in all five workspaces, and direct reads of `notification.service.ts`, `assignment.service.ts`, `task.service.ts`), combined with direct authorship knowledge of Phases 1–5 and the evidence already recorded in docs [18](18-product-capability-and-roadmap-assessment.md), [20](20-phase4-product-capability-and-roadmap-assessment.md), and [22](22-phase5-product-capability-and-roadmap-assessment.md).

---

## 1. Executive Summary

The system has, through Phases 1–5, built a correct, well-tested Work Graph (Task/Project/Conversation/Workday/DailyPlanItem) with strong authorization discipline, a working Daily Work Cycle, management visibility/reporting, and full-text search — all pull-based. A user only learns something changed by opening the app and looking. There is no push signal of any kind, and no mechanism capable of producing one on a schedule, because **no scheduled/background execution infrastructure exists anywhere in the repository** (confirmed again this session: no Dockerfile, no CI workflow, no worker process, no cron library, no queue library, no `middleware.ts`, no health-check route).

This is the single most consequential fact for Phase 6. Every candidate that depends on time-based automation (notifications for deadlines/overdue/reminders, recurring work generation, daily summaries) is blocked on the same missing capability: reliable scheduled execution. Candidates that don't depend on it (Calendar, Time Tracking, AI Assistant, RLS hardening, general production hardening) are each individually weaker on user value or premature on their own dependencies.

**Recommended Phase 6: Proactive Work Awareness — Notification Center + Minimal Scheduler**, scoped as one phase, not two. The reasoning (detailed in §13) is that a scheduler with no consumer is infrastructure work with no user-visible value, and notifications without a scheduler can only ever be reactive (event-triggered), which the system already does — partially, and with four confirmed-dead notification types that prove the gap is real, not hypothetical. Building both together, deliberately small, closes the gap the first five phases created: a user now plans and executes work inside the app but is only ever told about it when they go looking.

The recommended scope is deliberately narrower than "Proactive Work Awareness" might imply: it reuses the existing `NotificationService`/`Notification` model as-is (extending, not rebuilding), adds a minimal in-process scheduler (not a distributed job system — there is no deployment topology that would justify one yet), and wires up exactly the notification types that already exist but are dead, plus one new time-based check (deadline approaching / overdue), rather than inventing a broad new taxonomy.

## 2. Current Product State

As of Phase 5 (commit `9860875`), the product supports, per workspace (personal or organizational):

- **Work definition & assignment**: Tasks with capability-checked create/assign/reassign/status transitions, individual or team assignment, attachments.
- **Collaboration**: Per-task and per-project conversations, comments, mentions, review requests/decisions.
- **Daily Work Cycle**: Per-user `Workday` anchored to local calendar day, `DailyPlanItem` planning against real tasks, carry-forward chains, workday open/close.
- **Management visibility**: Team/department/org rollups, attention-required signals (stuck acknowledgement, over-capacity, repeat carry-forward, unplanned work), computed on read from existing data — no new schema.
- **Search & navigation**: Cross-entity (task/project/message) full-text search, authorization-safe by construction (every candidate individually re-checked against the same predicates used everywhere else).
- **Notifications (partial, since Phase 1/2A)**: In-app only, 14 declared types, but only 10 are actually ever triggered (see §14/§4).

All of this is pull-based. Nothing in the system currently pushes information to a user proactively, and nothing runs on a schedule.

## 3. Phase 1–5 Capability Baseline

| Area | Built | Notably absent |
|---|---|---|
| Identity/RBAC | Capability catalog, 6 role templates + individual-user permissions, scope resolution (org/dept-path/team) | — |
| Work Graph | Task, Project, Conversation, Attachment | Recurrence, dependencies between tasks |
| Daily Work Cycle | Workday, DailyPlanItem, carry-forward | Time-of-day scheduling, calendar view |
| Reporting | Team/dept/org rollups, attention signals | Historical trend charts, export |
| Search | Task/Project/Message FTS | Files, people, teams (explicitly deferred, doc 22 §9) |
| Notifications | Model + service exist, 10/14 types live, in-app delivery only | Scheduler-driven types, push/email delivery, preferences, read-state beyond boolean |
| Background execution | **None** | Cron, queue, worker, event bus, webhook |
| Calendar | **None** (deliberate — `ProjectDate` doc comment explicitly disclaims recurrence/reminders/time-of-day) | Everything |
| Time tracking | Coarse only (Workday open/close timestamps) | Per-task time entries, timers, reports |
| AI | Schema-only `AiInteraction` model, unused; `AI_FEATURES_ENABLED="false"` in env | Any actual AI code path |
| Multi-tenancy hardening | App-layer authorization predicates, consistently applied and tested | Database-enforced RLS |
| Deployment infra | `docker-compose.yml` for Postgres only | Dockerfile, CI, health checks, worker process |

## 4. Product Vision Alignment

The product's stated arc (carried across docs 18/20/22) is: **Awareness → Planning → Execution → Communication → Review → Completion → Organizational intelligence.** Phases 1–5 built Planning, Execution, Communication, Review, Completion, and (via Phase 4) a first slice of Organizational intelligence. **Awareness is the one stage never addressed.** Today "awareness" means "the user remembered to check." A user who doesn't open the app does not learn their task is overdue, that they were assigned something, that a review is waiting on them, or that their team is stuck — even though the system already *computes* several of these facts (Phase 4's `attentionRequired` signals) and even *has a notification type declared* for some of them (`DEADLINE_APPROACHING`, `TASK_OVERDUE`) that simply never fires.

This makes closing the Awareness gap the highest-leverage remaining move relative to the stated vision, ahead of adding new categories of work (Calendar, Time Tracking) or new intelligence (AI) on top of a system that still can't tell its users anything without being asked.

## 5. Current Architectural Readiness

Readiness is uneven by design, not oversight:

- **High readiness**: authorization predicates (`canViewTask`, `canAccessProject`, `canAccessConversation`) are exactly what any new proactive feature needs to reuse to avoid leaking information (see §16). `NotificationService` already has the right shape (`notify`/`notifyMany`, cursor-paginated `listForUser`, `markRead`/`markAllRead`) for in-app delivery. `ReportingService.getTeamSignals()` already computes several of the exact conditions a scheduler would need to check (stuck acknowledgement, over-capacity).
- **Zero readiness**: there is no process boundary for background work. `apps/web` is a Next.js app with API routes; nothing in the repo runs outside a request/response cycle. Introducing scheduled execution is a genuine new architectural concern, not a library install.
- **Deliberately absent**: Calendar (doc-commented as deliberately minimal), Recurring work, Time tracking beyond the coarse Workday signal, RLS (app-layer-only by design so far), AI (feature-flagged off, no code).

## 6. Candidate Comparison

Weighting rationale: **User Value (20%)** and **Vision Alignment (15%)** dominate because the explicit product discipline (§27 of the assessment brief) requires every recommendation to answer "how does this help the user run their working day" — features must earn their place, not accumulate. **Architecture Readiness (15%)** and **Dependency Risk (10%, inverted — lower risk scores higher)** matter because building on an unready foundation compounds cost later. **Implementation/Security/Operational Complexity (10% each, inverted)** penalize candidates that are expensive or risky relative to their value. **AI Readiness (5%)** and **Strategic Value (5%)** are minor tie-breakers, not primary drivers — this system should earn its automation/intelligence layer, not skip to it.

Scores are 1–10 (10 = best/most-ready/highest-value for the "positive" columns; for Dependency Risk/Implementation/Security/Operational Complexity, 10 = lowest risk/complexity, i.e. already inverted so higher is always better in the Overall Score sum).

| Candidate | User Value (20%) | Vision Alignment (15%) | Arch. Readiness (15%) | Dependency Risk (10%) | Impl. Complexity (10%) | Security Complexity (10%) | Operational Complexity (10%) | AI Readiness (5%) | Strategic Value (5%) | **Overall** |
|---|---|---|---|---|---|---|---|---|---|---|
| A. Notifications + minimal Scheduler (combined) | 9 | 9 | 6 | 6 | 6 | 6 | 6 | 5 | 8 | **7.15** |
| B. Scheduler alone (no notification consumer) | 3 | 4 | 6 | 6 | 7 | 7 | 5 | 4 | 5 | 4.90 |
| C. Calendar & Meeting Integration | 6 | 5 | 4 | 4 | 4 | 5 | 5 | 3 | 5 | 4.75 |
| D. Time Tracking | 5 | 5 | 6 | 7 | 6 | 6 | 7 | 3 | 4 | 5.55 |
| E. Recurring Work | 5 | 6 | 3 | 3 | 4 | 6 | 5 | 3 | 5 | 4.50 |
| F. AI Work Assistant | 6 | 6 | 2 | 2 | 3 | 4 | 4 | 8 | 8 | 4.30 |
| G. PostgreSQL RLS Hardening | 4 | 3 | 6 | 8 | 3 | 8 | 4 | 2 | 4 | 4.75 |
| H. Production Infra Hardening | 4 | 2 | 5 | 8 | 5 | 6 | 3 | 1 | 5 | 4.25 |
| I. Billing/SaaS Readiness | 3 | 2 | 3 | 5 | 4 | 5 | 5 | 1 | 6 | 3.60 |

Candidate A (Notifications + Scheduler, built together as one phase) is the clear leader. Notably, B (a scheduler built alone, ahead of anything that needs it) scores far lower than A despite sharing the same infrastructure work — confirming the answer to §13's question: build them together, not the scheduler first speculatively.

## 7. Detailed Candidate Analysis

### A. Proactive Notifications & Notification Center (+ minimal Scheduler)

- **Purpose / User Value**: Tell users what they currently have to look for. Closes the one vision-arc stage (Awareness) nothing else touches.
- **Product Fit**: Directly serves the Daily Work Cycle — "what should I know before I plan today" is the natural companion to "what should I plan today" (Phase 3).
- **Existing Foundation**: `NotificationService`, `Notification` Prisma model, `NotificationType` enum (14 values, 10 live), in-app delivery already correct and tested. This is a real, substantial head start — most of "v1 Notification Center" already exists.
- **Dependencies**: Requires a scheduler for the time-based types (deadline/overdue); does not require one for the event-based types (already working).
- **Architecture Impact**: One new small architectural concern (in-process scheduled execution). No new delivery channel needed for v1 (in-app only, matching existing scope).
- **Security Impact**: High-attention area — see §16. Every notification payload must be re-derived from an authorization-checked read, never assembled from raw event data.
- **Performance Impact**: Low if scoped to periodic batch checks (e.g. one query per check type per tick) rather than per-object polling.
- **Operational Impact**: New: something must actually run the scheduler continuously. See §18 for the deployment-grounded resolution.
- **Testing Impact**: Deterministic if the scheduler's "tick" is an explicitly callable function (not a bare timer) — same pattern already used for `local-day.ts`'s testable local-day boundary logic.
- **Risks**: Notification fatigue if scope creeps beyond the confirmed-dead types plus one deadline/overdue check; silent-failure risk if delivery isn't observable.
- **Recommendation**: Proceed, scoped narrowly (§21).

### B. Scheduler / Background Jobs (standalone)

- **Purpose / User Value**: None directly — a scheduler with nothing to schedule delivers nothing to a user.
- **Product Fit**: Only fits as an enabler, not a feature.
- **Existing Foundation**: None.
- **Dependencies**: None, which is exactly the problem — nothing depends on it yet either.
- **Architecture Impact**: Same as in Candidate A.
- **Security/Performance/Operational Impact**: Same technical shape as A, but zero offsetting value.
- **Testing Impact**: Same as A.
- **Risks**: Building infrastructure speculatively, ahead of its first real consumer, is the exact "unnecessary feature accumulation" risk the brief warns against (§27) — for infrastructure, not just features.
- **Recommendation**: Do not build alone. Fold into Candidate A.

### C. Calendar & Meeting Integration

- **Purpose / User Value**: Time-of-day scheduling and meeting visibility inside the work day.
- **Product Fit**: Plausible future companion to the Daily Work Cycle, but Phase 2C already deliberately deferred this (`ProjectDate` doc comment) pending exactly the product-priority question this document is answering.
- **Existing Foundation**: None beyond a plain-date field on `ProjectDate` (no time-of-day, no recurrence, no external calendar sync).
- **Dependencies**: Would likely also want reminders (→ Notifications) and possibly recurrence (→ Recurring Work), i.e. it is downstream of, not a substitute for, Candidate A.
- **Architecture Impact**: New entity model (events, attendees, possibly external calendar sync/OAuth) — substantial.
- **Security Impact**: Attendee visibility is another information-disclosure surface, same class of risk as notifications (§16), but with more entities (event, attendee list) to get wrong.
- **Performance/Operational Impact**: Moderate; external calendar sync (if any) adds real operational surface (webhooks, token refresh) — none of which exists today.
- **Testing Impact**: High — recurrence + timezone + external sync is a large combinatorial surface.
- **Risks**: Large scope for a v1; easy to over-build (recurrence rules, external sync) before establishing whether users need it inside this app at all versus their existing calendar tool.
- **Recommendation**: Defer. Reasonable Phase 7+ candidate once Notifications establish the reminder/delivery pattern it would reuse.

### D. Time Tracking

- **Purpose / User Value**: Per-task effort visibility, useful for reporting/billing.
- **Product Fit**: Extends Phase 3/4's existing coarse signal (Workday open/close) rather than starting from nothing.
- **Existing Foundation**: `Workday.startedAt/closedAt` already exists; per-task time entries do not.
- **Dependencies**: None blocking; genuinely additive to existing schema.
- **Architecture Impact**: Small — one new entity (`TimeEntry` or similar), no new execution model needed.
- **Security Impact**: Low-moderate — time entries are typically visible to the same audience as the task itself; reuses existing predicates.
- **Performance Impact**: Low.
- **Operational Impact**: None new.
- **Testing Impact**: Moderate, mostly logic (overlapping entries, running-timer edge cases).
- **Risks**: Lower urgency than Awareness — the brief's "how does this help the user run their working day" is answered more weakly here (reporting/billing value, not day-to-day execution value) than by Notifications.
- **Recommendation**: Reasonable, well-scoped future phase; not the highest-leverage next move. Good candidate for Phase 7 or 8.

### E. Recurring Work

- **Purpose / User Value**: Avoid manually recreating repeating tasks (weekly reports, standing reviews).
- **Product Fit**: Real and common pain point, but structurally it is "a scheduler that creates tasks" — the same missing execution-model dependency as Notifications' time-based checks.
- **Existing Foundation**: None.
- **Dependencies**: Directly depends on the scheduler being built for Candidate A. Building it before/separately from A means solving the scheduler problem twice.
- **Architecture Impact**: New recurrence-rule model (RRULE-like or simpler) plus generation logic; moderate.
- **Security Impact**: Generated tasks must inherit correct authorization/assignment — moderate care needed, but a bounded, well-understood problem.
- **Performance/Operational Impact**: Same scheduler dependency as A; no new operational surface beyond that.
- **Testing Impact**: Timezone/DST edge cases (per §18's explicit caution), similar to the scheduler's own testing needs.
- **Risks**: Building this before A duplicates the scheduler-design decision under less scrutiny.
- **Recommendation**: Defer until after the Candidate A scheduler exists, then this becomes a small, natural addition (a new scheduled job type), not a new subsystem. Good Phase 7 candidate.

### F. AI Work Assistant

- **Purpose / User Value**: Potentially high (summarization, prioritization suggestions, natural-language task creation) — hence the high AI Readiness/Strategic Value sub-scores.
- **Product Fit**: Explicitly gated by the brief's own stated principle (§19): reliable structured signals should exist before AI reasons over them.
- **Existing Foundation**: `AiInteraction` is schema-only, unused. `AI_FEATURES_ENABLED="false"`. No AI SDK dependency anywhere in any `package.json`. This is the least-ready candidate in the entire set.
- **Dependencies**: Best positioned *after* Notifications/Scheduler exist — those provide exactly the "structured, time-aware signals" (what's overdue, what's stuck, what was reassigned) that make AI suggestions trustworthy rather than speculative pattern-matching over raw task rows.
- **Architecture Impact**: Large — provider integration, prompt/response handling, cost/rate control, likely new async execution needs (another reason it benefits from Candidate A's scheduler existing first).
- **Security Impact**: High — any AI surface that reasons over task/project data must respect the exact same authorization boundary as every other read path; a leaked cross-workspace suggestion is a serious disclosure.
- **Performance/Operational Impact**: New external dependency (provider latency/cost), new observability needs.
- **Testing Impact**: Nondeterministic-output testing is a different discipline than the rest of this codebase's deterministic unit/E2E tests; would need new patterns.
- **Risks**: Building AI before Notifications/Scheduler means AI would have to reinvent "what changed and when" signal-detection logic that a scheduler would otherwise provide for free.
- **Recommendation**: Defer to Phase 8+, after both Awareness (Candidate A) and at least one more structured-signal phase (Recurring Work or Time Tracking) land.

### G. PostgreSQL RLS / Tenant Isolation Hardening

- **Purpose / User Value**: Defense-in-depth against a hypothetical application-layer authorization bug; no direct user-facing value.
- **Product Fit**: Orthogonal to the vision arc — a hardening move, not a capability.
- **Existing Foundation**: App-layer predicates (`canViewTask` etc.) are consistently applied and E2E-tested across 122 scenarios; no known bypass has been found in five phases of building directly on top of them.
- **Dependencies**: None blocking.
- **Architecture Impact**: Significant — RLS policies must exactly mirror the app-layer predicate logic (scope resolution, org/department-path inheritance, team membership) or create a second, divergent source of truth that's worse than not having RLS.
- **Security Impact**: Positive in principle, but only if done correctly; a naive RLS policy that doesn't match the real authorization rules gives false confidence.
- **Performance Impact**: RLS policy evaluation adds per-query overhead, especially for the path-based department inheritance rules.
- **Operational Impact**: Two roles (`app`/`app_runtime`) already exist and are RLS-compatible in principle, but no policies exist yet.
- **Testing Impact**: Every existing authorization test would need an RLS-equivalent verification path.
- **Risks**: This is real, valuable work, but the brief explicitly cautions "do not assume RLS is automatically required before every next feature" — with zero known incidents and a well-tested app layer, this is insurance, not a blocker.
- **Recommendation**: Valuable, but not urgent. Reasonable to schedule after Awareness, not before it. See §23.

### H. Production Infrastructure Hardening

- **Purpose / User Value**: No direct value; enables the system to actually be deployed and run continuously — which Candidate A's scheduler also needs.
- **Product Fit**: Enabler, not a capability.
- **Existing Foundation**: `docker-compose.yml` covers Postgres only. No Dockerfile for the app, no CI, no health-check route, no `middleware.ts`.
- **Dependencies**: Candidate A cannot run its scheduler reliably in production without *some* minimal piece of this (a place for a long-running or scheduled process to execute). This is the one place H and A genuinely overlap.
- **Architecture Impact**: Large if treated as "harden everything" (the brief explicitly warns against this framing, §25); small if scoped to exactly what A needs.
- **Security/Performance/Operational Impact**: Broad and generic if unscoped.
- **Testing Impact**: CI itself is a testing-infrastructure investment, independent of any feature.
- **Risks**: Turning this into a full "production readiness" phase (CI, containerization, observability, secrets management, deployment target selection) is explicitly what the brief says not to do as an unfocused catch-all.
- **Recommendation**: Do not run as its own phase. Pull in only the minimal slice Candidate A's scheduler needs (a documented execution model — see §18); leave broader hardening (CI, full containerization, observability stack) as deferred roadmap (§26).

### I. Billing / SaaS Readiness

- **Purpose / User Value**: None for existing users; relevant only if/when the product is sold as a hosted SaaS product to new organizations.
- **Product Fit**: No evidence in the repository that this is imminent (no billing provider dependency, no plan/tier model in schema).
- **Existing Foundation**: None.
- **Dependencies**: None blocking, but also nothing else depends on it.
- **Architecture Impact**: New entities (plans, subscriptions, usage metering), new external provider integration.
- **Security Impact**: Payment-adjacent data handling raises the compliance bar significantly.
- **Performance/Operational Impact**: New external dependency (billing provider webhooks) — which itself would want the scheduler/event infrastructure from Candidate A.
- **Testing Impact**: High (billing correctness is unforgiving).
- **Risks**: Premature relative to product maturity; no signal in the repo that this is the current priority.
- **Recommendation**: Not a Phase 6 candidate. Revisit only when there's an actual go-to-market decision to build against.

### J. Other capability discovered from inspection

No additional capability was found during this session's fresh inspection that outranks Candidate A. The inspection specifically searched for existing-but-hidden notification/scheduler/calendar/recurring/time-tracking/AI code (§14) and found nothing beyond what's already documented in §3/§4 — including two previously-undocumented dead notification types (`TASK_REASSIGNED`, `REVIEW_COMPLETED`), which if anything *strengthens* the case for Candidate A rather than surfacing a different priority.

## 8. Proactive Notifications Assessment

**What already exists and should be reused, not rebuilt:**
- `Notification` Prisma model and `NotificationService` (`notify`, `notifyMany`, `listForUser` with cursor pagination, `markRead`, `markAllRead`) — all correct, tested, and sufficient for v1 delivery (in-app).
- `NotificationType` enum with 14 declared values. Of these, **10 are live** (triggered somewhere in the codebase): `TASK_ASSIGNED`, `TASK_ASSIGNED_TO_TEAM`, `ASSIGNMENT_ACCEPTED`, `ASSIGNMENT_DECLINED`, `COMMENT_ADDED`, `REVIEW_REQUESTED`, `TASK_COMPLETED`, `CHANGES_REQUESTED`, `MESSAGE_ADDED`, `MENTIONED_IN_TASK`. **4 are declared but never triggered anywhere**: `DEADLINE_APPROACHING`, `TASK_OVERDUE` (previously documented, doc 22), and, newly confirmed this session, `TASK_REASSIGNED` and `REVIEW_COMPLETED`.
  - `TASK_REASSIGNED` dead-check: `assignment.service.ts`'s `reassignInternal` (team-redistribution path) calls `notify(..., NotificationType.TASK_ASSIGNED, ...)`, not a distinct reassignment type — confirmed by direct read of all five notify call sites in that file.
  - `REVIEW_COMPLETED` dead-check: `task.service.ts`'s review-decision path (`reviewTask`) notifies with `NotificationType.TASK_COMPLETED` or `NotificationType.CHANGES_REQUESTED` depending on the decision, never `REVIEW_COMPLETED` — confirmed by direct read of that method's notify call site this session.
- **What this means**: two of the four dead types (`DEADLINE_APPROACHING`, `TASK_OVERDUE`) are dead because they require time-based (scheduled) evaluation that doesn't exist. The other two (`TASK_REASSIGNED`, `REVIEW_COMPLETED`) are dead for a different reason — they're pure event-based types that were declared but the call sites simply reuse a sibling type instead. These two can be fixed with **zero new infrastructure**, as part of Candidate A, independent of the scheduler question.
- **What is genuinely missing**: delivery channels beyond in-app (push/email — explicitly out of scope per the doc comment's "named extension point, not wired up"), notification preferences (no opt-out/mute model), and any time-based trigger.

**Verdict**: Reuse the existing model and service as-is. Do not introduce a new notification subsystem.

## 9. Scheduler / Background Processing Assessment

No scheduler, cron, queue, or worker library exists in any `package.json` (root, `apps/web`, `packages/domain`, `packages/db`, `packages/shared` — all five read in full this session). No worker process, no `Dockerfile`, no CI workflow, no health-check route exist anywhere in the repository. `docker-compose.yml` defines Postgres only.

This means introducing any time-based behavior (deadline/overdue detection, recurring-task generation, daily summaries) requires first deciding *how code will run outside a request*. Given the current deployment reality (a single Next.js app, no separate process, no confirmed hosting target), the only responsible v1 design is an **in-process, explicitly-invoked scheduler** — a plain function that performs one "tick" of checks, callable both by a lightweight internal timer (e.g. `setInterval` inside the Next.js server process, acceptable for a single-instance deployment) and directly by tests (no timer needed for correctness testing — same testability pattern already used for `local-day.ts`). This avoids inventing distributed-job infrastructure (locking, retries across instances, external queue) the deployment topology doesn't yet justify. See §18 for full detail.

**Verdict**: Build the minimal version, scoped to what Candidate A's notification checks need, not a general-purpose job system.

## 10. Calendar Assessment

Confirmed no calendar/meeting/event model exists; `ProjectDate` is a deliberately plain date field with an explicit doc comment disclaiming recurrence, reminders, and time-of-day. Reasonable future capability, but downstream of Notifications (reminders) and not blocking or blocked by Candidate A. See §7/C and §20.

## 11. Time Tracking Assessment

Confirmed the only existing time signal is `Workday.startedAt`/`closedAt` (Phase 3's coarse per-day signal). No per-task time entry model exists. Independent of Candidate A; lower urgency per the vision-arc/user-value weighting. See §7/D and §22.

## 12. Recurring Work Assessment

Confirmed no recurrence model exists anywhere (schema, service, or UI). Structurally dependent on the same scheduler decision as Candidate A — see §7/E and §9. Recommended to follow, not precede or accompany, Candidate A. See §24.

## 13. AI Work Assistant Assessment

Confirmed zero AI code paths; `AiInteraction` is schema-only and unused; `AI_FEATURES_ENABLED="false"`; no AI provider SDK in any workspace's dependencies. This is the least-ready candidate assessed. Per the brief's own stated principle and this document's independent analysis, AI should follow — not precede — the establishment of reliable structured, time-aware work signals (Notifications/Scheduler), since those signals are exactly what makes AI proactive suggestions well-grounded rather than speculative. See §7/F and §19 (recommended: Phase 8+).

## 14. PostgreSQL RLS Assessment

App-layer authorization predicates are consistently applied, reused (never re-derived per feature — confirmed across Phases 2C/3/4/5's implementations), and covered by 122 E2E scenarios with no known bypass. RLS would add real defense-in-depth but at real cost (policy/predicate duplication risk, per-query overhead) and is not urgent given the current track record. See §7/G and §23.

## 15. Production Infrastructure Assessment

Genuinely absent (no Dockerfile, CI, health checks, `middleware.ts`), but a full "harden everything" phase is explicitly the wrong framing per the brief. The one piece of production infrastructure that is *not* deferrable is whatever minimal execution model Candidate A's scheduler needs to run continuously in whatever the actual deployment target turns out to be — and that decision needs a product/infra choice (which hosting model) that this read-only assessment cannot make on its own. See §18 and Open Questions (§27).

## 16. Recommended Phase 6

**Proactive Work Awareness — Notification Center Completion + Minimal Scheduler**, built as **one phase**, not two, and not a broader catch-all "Proactive Work Awareness" phase that bundles Calendar/Recurring Work/AI in as well.

Rationale for "one phase, not two, not broader" (directly answering §13 of the brief):
- **Not two sequential phases**: A scheduler built before any notification consumer exists (Candidate B) scores meaningfully lower in §6 precisely because it delivers no user value on its own — it would be built on speculation about what it needs to support. Building them together means every piece of scheduler capability is driven by a real, specified consumer (the deadline/overdue check), keeping the scheduler itself minimal.
- **Not a broader phase**: Calendar, Recurring Work, and AI are all real future candidates but each has its own scope and risk (§7/C, E, F) large enough to deserve its own phase and its own approval gate, per this project's established phase discipline. Bundling them in now would violate the brief's own "avoid feature accumulation" caution (§27) and this project's consistent one-focused-phase-at-a-time pattern (Phases 2C/3/4/5 each shipped one coherent capability).

## 17. Recommended Scope

**IN SCOPE for Phase 6:**
1. Fix the two zero-cost dead notification types: wire `TASK_REASSIGNED` into `reassignInternal`'s actual reassignment path (distinct from first assignment) and `REVIEW_COMPLETED` into the review-decision path where it's semantically correct to add it alongside (not necessarily replacing) the existing `TASK_COMPLETED`/`CHANGES_REQUESTED` signals — exact design deferred to the (separate, future) architecture step.
2. Introduce a minimal, explicitly-invoked, testable in-process scheduler capable of one deadline/overdue "tick" — reusing existing task-query patterns, not a new job-definition DSL.
3. Wire up `DEADLINE_APPROACHING` and `TASK_OVERDUE` using that scheduler.
4. A minimal Notification Center UI surface (a way to view/read notifications in-app) if one does not already fully exist — to be confirmed at the architecture step, since `listForUser`/`markRead`/`markAllRead` already exist at the service layer and may already be surfaced.
5. Apply the information-disclosure security principle (§19) to every new and existing notification-producing code path as part of this phase's own security review — not deferred.

**OUT OF SCOPE for Phase 6:**
- Push/email delivery channels.
- Notification preferences/opt-out/mute.
- Recurring work (any recurrence-rule model or generation).
- Calendar/meeting model.
- Time tracking.
- AI Work Assistant.
- RLS.
- Broader production hardening (CI, containerization, observability) beyond the minimal execution model the scheduler itself needs.
- Any distributed/multi-instance job coordination (locking across instances, external queue) — explicitly premature given the confirmed absence of a multi-instance deployment topology.

## 18. Proposed Architecture Direction (Conceptual Only — Not a Design Doc)

This section sketches shape only; a dedicated architecture document would follow this assessment's approval, per this project's established process.

- **Scheduler**: A single exported function performing one "tick" (e.g. `runScheduledChecks(db, now)`), invoked by a thin timer wrapper in the Next.js server process for the live deployment, and invoked directly (no timer) in tests — mirroring `local-day.ts`'s existing testability pattern. No new persistent job-queue table for v1; the tick re-derives what needs attention from existing data each time it runs (idempotent by construction, since it's a fresh query each tick, not a queue of one-shot jobs).
- **Notification production**: Every tick-produced notification must be generated the same way as every existing event-triggered one — via `NotificationService.notify`/`notifyMany` — and, critically, must only notify a user about an object re-verified against the same authorization predicate (`canViewTask`, etc.) used for reads, per §19.
- **No new delivery channel, no new entity model needed for the IN SCOPE items** — this reuses `Notification`/`NotificationService` exactly as they exist today.

## 19. Dependencies

- Candidate A's time-based checks depend on the scheduler existing (built together, per §16).
- The scheduler's production reliability depends on a decision about where/how the Next.js server process actually runs continuously in production — a deployment-target decision this assessment cannot make (see Open Questions, §27) but which the architecture step must resolve before implementation, per the brief's explicit caution against designing "an imaginary production scheduler."
- No new external service dependency is required for the IN SCOPE items (no email/push provider needed since those remain out of scope).

## 20. Security Requirements

The governing principle, stated in the brief and independently confirmed against this codebase's existing authorization discipline: **a notification is itself an information disclosure. A user must never receive a notification about an object they are not authorized to know about.**

Concretely, for every new and existing notification-producing code path:
- Event-triggered notifications (already correct today, per code review): the actor already has access to the object by construction (they just acted on it), and the recipients are derived from the object's own authorized-party list (assignee, creator, mentioned user) — this pattern is safe and should be the template.
- **Scheduler-triggered notifications are the new risk**: a periodic query that scans, e.g., "all tasks past their deadline" and notifies "the assignee" is safe only if the assignee-derivation itself is authorization-safe (it is, structurally — an assignee always has access to their own assigned task by definition of assignment). The risk case to explicitly guard against in the architecture step is any future extension of the check to notify someone *other* than the object's own authorized parties (e.g., a manager digest) — that must re-run the same `canViewTask`-equivalent check before inclusion, never assume org-hierarchy proximity implies authorization.
- Notification payloads must carry only data the recipient is already authorized to see (title/snippet derived from an authorization-checked read), matching the exact discipline `SearchService` already established (coarse pre-filter, never trusted as authorization on its own — this is the same pattern, applied to a push path instead of a pull path).

## 21. Performance Requirements

- Scheduler ticks should be bounded, batched queries (one query per check type per tick, following `ReportingService.getTeamSignals()`'s existing batched-query precedent), never N+1 per user or per task.
- Tick frequency should be coarse enough not to add meaningful load (e.g. checking for newly-overdue tasks does not need sub-minute resolution).

## 22. Testing Requirements

- The scheduler tick function must be directly callable and deterministic given an injected `now`, avoiding real-timer-dependent tests — matching `local-day.ts`'s existing pattern.
- E2E coverage should extend `abc-college.e2e.test.ts` with scenarios for: a reassignment producing the correct (fixed) notification type, a review decision producing the correct (fixed) notification type, and a scheduler tick producing a deadline/overdue notification only for authorized recipients (with an explicit negative case: an unauthorized user's tick-triggered visibility is never created).

## 23. Deployment / Operational Requirements

The architecture step must explicitly resolve, before implementation: where the scheduler timer actually runs continuously in the real deployment (in-process within the existing Next.js server assumes a single long-running server instance — confirmed compatible with the current single-Postgres, no-separate-worker `docker-compose.yml`, but this must be a stated, deliberate choice, not an assumption). This is flagged as an Open Question (§27) rather than resolved here, per the read-only constraint of this assessment.

## 24. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Scheduler runs on multiple instances in some future deployment, double-firing notifications | Design the v1 tick to be idempotent (re-derive from current state each time, e.g. "has this task already been notified as overdue" check) rather than assuming single-instance forever |
| Notification volume becomes noisy | Keep IN SCOPE narrow (§17); do not add more trigger types without a dedicated review |
| Scheduler-triggered notification leaks information to an unauthorized party | Apply §19's principle as a mandatory review gate on every new check, not just at design time |
| Silent scheduler failure (tick stops running, no one notices) | Architecture step should specify a minimal observability signal (e.g. a log line per tick), not full observability infrastructure |

## 25. Success Criteria

- All 14 declared `NotificationType` values are either live or deliberately removed (none silently dead).
- A user receives an in-app notification for a task becoming overdue or approaching its deadline without needing to open the app to discover it.
- No E2E test or manual verification surfaces a notification reaching a user unauthorized to view the underlying object.
- No new external infrastructure dependency (queue/cron service) was introduced for a problem the in-process scheduler already solves at this scale.

## 26. Deferred Roadmap

In rough sequence, pending their own approval gates:
1. Recurring Work (natural extension of the Phase 6 scheduler).
2. Time Tracking (independent, well-scoped, additive).
3. Calendar & Meeting Integration (benefits from Phase 6's reminder-delivery pattern).
4. PostgreSQL RLS Hardening (defense-in-depth, not urgent).
5. AI Work Assistant (after structured signals from Phase 6 and at least one of the above exist).
6. Broader Production Infrastructure Hardening (CI, full containerization, observability) — scoped as its own deliberate phase, not folded into any feature phase.
7. Billing/SaaS Readiness (only once a go-to-market decision exists).

## 27. Open Questions Requiring Product Decision

1. **Deployment target**: Where will the app actually run continuously in production (single persistent server vs. serverless/edge)? This determines whether an in-process timer scheduler (proposed here) is viable long-term or only a bridge. This assessment cannot answer it and the next architecture step must not proceed without it.
2. **Notification Center UI**: Does a way to view notifications already exist in the UI (unconfirmed by this session's backend-focused inspection) or does Phase 6 need to add one? Needs a quick UI inventory at the start of the architecture step.
3. **`REVIEW_COMPLETED` semantics**: Should it fire *alongside* `TASK_COMPLETED`/`CHANGES_REQUESTED` (an additional "review is done" signal to a different audience, e.g. the requester) or should it turn out to be genuinely redundant and be removed instead of wired up? Needs a product decision, not just an engineering one.
4. **Notification digest vs. individual**: Should overdue/deadline checks produce one notification per task or a daily digest? Affects both UX and scheduler-tick design.

## 28. Final Recommendation

**Proceed to Phase 6**, scoped exactly as defined in §17: complete the existing Notification system (fix two dead types, no new model) plus a minimal, in-process, testable scheduler for deadline/overdue detection — built as one phase. Do not build the scheduler alone, do not bundle in Calendar/Recurring Work/AI, and do not expand into general production hardening. Before implementation begins, the architecture step must resolve Open Question #1 (deployment target) explicitly, since it directly determines whether the proposed in-process scheduler design is appropriate or needs revision — consistent with the brief's caution against designing a scheduler without understanding the deployment reality it will run in.

This assessment recommends **waiting for explicit user approval of this scope** before any architecture design or implementation work begins, per standing process.
