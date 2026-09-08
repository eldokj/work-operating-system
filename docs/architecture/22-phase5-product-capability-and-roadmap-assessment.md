# Phase 5 Product Capability & Roadmap Assessment

**Base commit:** `c4b1ae0` (branch `master`, `origin/master` synchronized). **Method:**
every claim below was re-verified directly against the repository at this commit this
session — not assumed from `docs/architecture/*`'s own prior claims, and not assumed from
docs 18/20 (written before Phases 3/4 existed). Where those reports' conclusions still
hold, they are re-cited with fresh evidence, not repeated on faith. This is a read-only
assessment — no code, schema, route, UI, config, or dependency was touched.

---

## 1. Executive Summary

Phase 4 closed the visibility gap between an individual's work and what a manager can see
of it. What remains open, confirmed by fresh inspection this session, is narrower and more
specific than it was at doc 18/20's time: **there is still no way to find anything in this
product except by already knowing where to look** (§8/C below — zero search
infrastructure exists anywhere, re-confirmed by grep), and **the product is still entirely
pull-based** — every one of Phase 3's Daily Work Cycle signals and Phase 4's
`attentionRequired` signals only reaches anyone who chooses to open the app and look
(§9/C — `DEADLINE_APPROACHING`/`TASK_OVERDUE` remain declared, unused enum values; no
scheduler, cron package, or `middleware.ts` exists anywhere in the repository).

**Recommendation: Phase 5 = Search & Navigation.** Not because it's the most exciting
option, but because it is the only one of the serious candidates evaluated (§E) that
requires **zero new infrastructure class**, carries the **lowest scope-creep risk**, and
is immediately useful in the exact environment this product runs in today — unlike
Proactive Notifications, which needs a scheduler this codebase has never had and which
this project doesn't yet have anywhere to reliably deploy (§G). Full comparison in §E,
scope in §H.

---

## 2. What The Product Can Actually Do Today (A)

Re-verified end to end against the code at `c4b1ae0`, not inferred from any doc:

- **Identity & tenancy**: local JWT-cookie auth (`apps/web/lib/session.ts`,
  `packages/domain/src/services/auth.service.ts`), personal + organization workspaces,
  departments, teams, capability-based RBAC with 6 system role templates (`SUPER_ADMIN`,
  `ORG_ADMIN`, `DEPARTMENT_HEAD`, `TEAM_HEAD`, `MANAGER`, `MEMBER` —
  `packages/shared/src/permissions/permissions.catalog.ts`).
- **Task lifecycle**: create → assign (6 patterns: direct, cross-team, cross-department,
  org-wide, team-then-distribute, reassignment) → acknowledge (accept/decline with
  mandatory reason) → execute → submit → review → complete/cancel
  (`packages/domain/src/services/task.service.ts`,
  `assignment.service.ts`, `task-status.machine.ts`, `assignment-status.machine.ts`).
- **Conversation & files**: one conversation and one file library per task *or* per
  project (`Conversation`/`TaskAttachment`, generalized across both in Phase 2C),
  mentions, reactions, replies, edit/delete-own-message.
- **Projects/Events**: `Project` (kind `PROJECT`/`EVENT`), `ProjectMember`/`ProjectTeam`
  rosters, `ProjectDate`s, derived progress.
- **Daily Work Cycle**: `Workday`/`DailyPlanItem` — Inbox (derived), Plan, Work (Now/Next/
  Later), Close with mandatory disposition, carry-forward chain
  (`packages/domain/src/services/daily-work.service.ts`, `apps/web/app/(app)/today/`).
- **Management visibility (Phase 4, new)**: team/org dashboards now surface
  `attentionRequired` (stuck-acknowledgement, over-capacity, repeat-carry-forward,
  unplanned-work counts) alongside the pre-existing overdue/workload/performance figures
  (`reporting.service.ts`, extended this phase — verified via `git show c4b1ae0`).
- **Audit**: append-only, DB-role-immutable `audit_logs`, now with 4 optional context FKs
  (`taskId`/`projectId`/`workdayId`/`organizationId`).
- **66 API routes, 17 UI pages** (re-counted this session — unchanged from before Phase 4,
  which added zero new routes/pages by design).

---

## 3. Original Vision vs. What's Covered (B)

Doc 01 §1.1 defines the core loop as one pipeline: `CREATE → ASSIGN → ACKNOWLEDGE →
EXECUTE → UPDATE → SUBMIT/REVIEW → COMPLETE → REPORT`. Every stage of that pipeline is
now **implemented and E2E-tested** (113 scenarios at `c4b1ae0`) — including `REPORT`,
which was the weakest stage until Phase 4. Doc 01 §1.3's workspace model (personal vs.
organization, one entity not two) is implemented exactly as specified. The positioning
promise — **"run your entire working day from one place"** — is now genuinely true for
the full single-person loop (create through daily execution through close) and, as of
Phase 4, true for a manager's *visibility* into several people's loops at once. It is
**not yet true** for the moment work arrives unexpectedly (no proactive notification) or
the moment someone needs to locate something they already know exists but can't remember
where (no search) — both are pull-only today.

---

## 4. What's Still Missing (C)

Re-confirmed this session, not assumed:

- **Search**: zero implementation anywhere — no `tsvector`, no search route, no search UI
  (grep-confirmed against `packages/db/prisma`, `apps/web/app`, `packages/domain/src`).
- **Proactive notifications**: `DEADLINE_APPROACHING`/`TASK_OVERDUE` remain declared,
  never triggered (`notification.service.ts` lines 13-14, grep-confirmed unchanged). No
  scheduler/cron package in any `package.json`. No `middleware.ts` anywhere in `apps/web`.
- **Calendar**: no `CalendarEvent`/meeting model (grep-confirmed against
  `schema.prisma`) — `Task.dueDate`/`ProjectDate`/`DailyPlanItem.scheduledStart` remain
  the only date-bearing fields, none rendered as a calendar grid.
- **Recurring work**: no recurrence field on any model.
- **AI**: `AiInteraction` model present, schema-only, zero code references (unchanged).
- **Production infrastructure**: no `Dockerfile`, no `.github/` workflow, no object
  storage adapter beyond `LocalDiskStorageService`, no RLS (zero `CREATE POLICY`
  statements across all 9 migrations, re-confirmed).
- **Mobile-readiness gaps**: cookie-only session, still-inconsistent pagination on
  non-Phase-3/4 list endpoints (unchanged from doc 20 §17's findings).

None of these are surprises — every one was already named in doc 18/20 as deferred. What
this session confirms is that **none of them silently got built as a side effect of Phase
3 or Phase 4** — the gap list is exactly as accurate today as it was before those phases,
minus reporting, which Phase 4 closed.

---

## 5. Candidate Directions & Comparison (D/E)

Five candidates evaluated: **Search & Navigation**, **Proactive Notifications +
Scheduler**, **Calendar (MVP)**, **AI Work Assistant (early features)**, **Production
Infrastructure Hardening**. Scored 1-10 (higher = stronger case) against every criterion
the brief specifies.

| Criterion | Search | Notifications+Scheduler | Calendar (MVP) | AI Work Assistant | Production Infra |
|---|---|---|---|---|---|
| User value | 8 | 8 | 4 | 6 | 2 (invisible to users directly) |
| Product differentiation | 3 (commodity) | 6 | 2 | 7 (if grounded) | 0 |
| Leverage on existing architecture | 6 | **9** (activates Phase 3/4's own signals directly) | 4 | 5 (depends on #1/#2 existing first) | 3 |
| AI readiness (enables future AI) | 7 (feeds future NL search) | 8 (feeds future daily-briefing AI) | 3 | N/A (is the AI itself) | 1 |
| Business/revenue potential | 4 | 6 | 3 | 7 | 2 (indirect, enables launch) |
| Implementation complexity (higher score = lower complexity) | **9** (Postgres FTS only) | 4 (first new infra class this codebase needs) | 6 | 3 (needs #1's foundation + a provider) | 5 |
| Security/privacy risk (higher score = lower risk) | 7 (must reuse existing access checks) | 6 | 8 | 4 (payload/PII exposure to a provider) | 5 |
| Performance risk (higher score = lower risk) | 7 (one GIN index) | 8 | 8 | 6 | 6 |
| Infrastructure requirement (higher score = less new infra needed) | **9** (none) | **2** (needs a scheduler; no deployment target exists yet to run one reliably — §G) | 8 | 4 (needs an AI provider key/config) | 1 (is entirely new infra) |
| Risk of becoming a generic PM suite (higher score = lower risk) | **9** (expected baseline utility) | 7 | 4 (calendars are where scope creep usually starts) | 6 (if scoped to assistive-only) | 9 |
| **Total** | **69** | **64** | **50** | **48** | **34** |

**Reading the table, not just the total:** Search and Notifications are close, and for
good reason — Phase 4 specifically built Notifications' future trigger content
(`attentionRequired`), which is why it scores highest on architectural leverage. But
Notifications loses decisively on **Infrastructure requirement**: this codebase has never
needed a background/scheduled execution path, and — critically — **this project has no
deployment target at all yet** (§4, re-confirmed: no `Dockerfile`, no CI, no hosting
decision made). Building "proactive, scheduled" anything before there's a real place to
run a schedule is solving the wrong problem first. Search has no such prerequisite: a
Postgres `tsvector` index and a query work identically in local dev and in any future
production deployment, with nothing else required.

---

## 6. What Should NOT Be Phase 5 (F)

- **Notifications + Scheduler** — not because it's a bad idea (§5 shows it's the
  second-strongest candidate), but because of §G's dependency: it needs infrastructure
  this project doesn't have anywhere to run reliably yet. Correctly Phase 6.
- **Calendar** (even MVP) — no current gap forces it (doc 20 §10's finding stands
  unchanged); carries real scope-creep risk if built before a concrete need names it.
- **Recurring work** — no current gap forces it; its payoff is much higher once
  Notifications exist to make a recurring-and-overdue item actually actionable.
- **AI Work Assistant** — scores well on differentiation but depends on Search existing
  first (for NL search / "find X" style AI commands) and ideally on Notifications too
  (for briefing-style features); building it now would mean re-plumbing it once those
  land. The AI Strategy Principle (carried forward from doc 21 §16, unchanged) still
  requires a reliable deterministic foundation under any AI feature — Search is part of
  that foundation, not yet built.
- **A generic project-management feature sweep** (custom fields, Gantt charts, generic
  automation rules, a document/wiki system) — explicitly guarded against per this
  session's own instruction; nothing in the evidence gathered suggests any of these are
  needed, and building them would dilute the "Work OS" loop into "another PM tool."
- **Production infrastructure as "Phase 5"** — it's not a competing product-phase choice
  at all (unchanged conclusion from doc 20 §21/§24); it's a parallel track that should
  start whenever there's a real deployment target in mind, independent of which product
  phase is next.

---

## 7. Dependencies to Address Before Phase 5 (G)

**For the recommended Search phase specifically: none are blocking.** The schema already
supports it (`Task.title`/`.description`, `Project.name`/`.description`,
`TaskMessage.body` all exist today); the authorization patterns it must reuse
(`TaskService.canViewTask`, the project-access predicate) are stable and unchanged since
Phase 2C. No migration, no new service, no new infrastructure is a prerequisite.

**Named for completeness, not as blockers:** if Notifications+Scheduler is what gets
picked instead of this report's recommendation, its real dependency is a deployment
decision (§6) — not a code change, a decision about where and how this application will
eventually run continuously enough to execute a schedule. That decision does not need to
be made before Phase 5 (Search) proceeds.

---

## 8. Recommended Phase 5 Scope — Architecture Level (H)

**Search & Navigation**, scoped narrowly per this project's own established discipline
(extend, don't duplicate; minimum correct model; no new infra unless proven necessary):

- **Data model**: Postgres native full-text search (`tsvector` generated columns +
  GIN indexes) on `Task.title`/`Task.description`, `Project.name`/`Project.description`,
  and `TaskMessage.body` — no new table, no external search service (Elasticsearch/
  Algolia/etc.) at this scale.
- **Domain**: one new, thin `SearchService` composing existing authorization — a search
  result set is filtered through **the exact same** `canViewTask`/project-access
  predicates every other read path already uses, never a shortcut index that could leak
  content a searcher couldn't otherwise see. This is the one non-negotiable architectural
  rule for this phase, carried forward unchanged from doc 20 §8's original framing.
- **API**: one new route, `GET /api/v1/search?q=...`, returning a small, typed, mixed
  result set (tasks/projects/messages) with the existing `{items, nextCursor}` pagination
  convention.
- **UI**: one search input in the nav (not a dedicated full-page search experience unless
  usage later justifies it) plus a results view.
- **Explicitly not included**: file-content search (searching *inside* attached PDFs/
  documents), fuzzy/typo-tolerant matching beyond Postgres's own built-in capability,
  saved searches, search analytics, or any AI/NL layer on top (that's a later, separate
  addition once this foundation exists, per the AI Strategy Principle).

This is intentionally the smallest phase in the roadmap so far — matching its own
low-complexity score in §5, not scope creep in either direction.

---

## 9. What Remains Deferred (I)

Unchanged in substance from doc 20 §22/doc 21 §22, reaffirmed by this session's
re-verification: Proactive Notifications + Scheduler (Phase 6, once a deployment
decision exists), Calendar, Recurring Work, Time Tracking beyond Phase 3's existing
coarse signal, Forecasting/Predictive Analytics, any BI/export platform, Billing/SaaS
readiness, RLS (before onboarding unrelated paying customers onto shared infrastructure,
not before this), and AI of any kind (grounded in Search + Notifications existing first).

---

## 10. Proposed Phase 5 Architecture Document Outline (J)

For the dedicated architecture report this assessment recommends writing next (mirroring
docs 17/19/21's structure), once explicitly approved:

1. Executive Summary
2. Current Search Capability (confirming the "zero" baseline)
3. Problem Definition
4. Searchable Entities & Fields
5. Data Model (`tsvector`/GIN — exact columns, exact indexes)
6. Authorization Model (the non-negotiable "same predicates as every other read path" rule)
7. Query/Ranking Model (relevance ranking approach, `ts_rank` or equivalent)
8. API Design (`GET /search`, request/response contract, pagination, error cases)
9. UI/UX (nav search input, results view, empty/loading states)
10. Filtering vs. Global Search Boundary (reusing doc 21 §13's existing distinction —
    Phase 4's report filtering and this phase's search remain architecturally separate)
11. Performance & Indexing (expected query volume, GIN index sizing, no N+1 risk)
12. Security Threat Model (IDOR via search, cross-tenant leakage via search, aggregation
    leakage — mirroring doc 21 §19's threat-table format)
13. AI Compatibility (how this becomes the foundation for future NL search, without
    building it now)
14. Testing Strategy (unit + E2E, including an explicit "search never returns content the
    searcher couldn't otherwise see" adversarial test)
15. Schema Impact (the exact `tsvector`/index migration, precisely specified, not yet
    implemented)
16. MUST / SHOULD / COULD / DEFERRED
17. Implementation Sequence
18. Final Recommendation

---

## Final Summary

**1. Recommended Phase 5:** Search & Navigation.

**2. Why it wins:** it is the only serious candidate requiring **zero new infrastructure
class** in a project that currently has none beyond Postgres itself, it scores highest
across the brief's own weighted criteria table (§5) once infrastructure requirement and
generic-PM-suite risk are weighted properly (not just "most exciting" or "most
differentiated" alone), and it closes the one gap left in the individual-user experience
after Phases 1-4 closed everything else (create through daily execution through
management visibility) — the ability to find something you know exists but can't
remember where.

**3. Exact proposed scope:** Postgres `tsvector`/GIN full-text search over task title/
description, project name/description, and message body; one new thin `SearchService`
reusing existing authorization predicates exactly; one new `GET /search` route; one nav
search input plus a results view. No new tables beyond generated search columns, no
external search service, no AI layer yet.

**4. Explicitly deferred:** Proactive Notifications + Scheduler (Phase 6, pending a
deployment decision), Calendar, Recurring Work, Time Tracking, Forecasting, BI/export,
Billing/SaaS readiness, RLS, and AI of any kind.

**5. Risks:** the one non-negotiable architectural rule (search must be filtered through
the exact same authorization every other read path uses) is also the one place a bug
could cause real information leakage — this needs its own dedicated adversarial test
before this phase can be called done, exactly as named in §10 item 14. Secondary risk:
scope creep toward a "smart"/fuzzy/AI-flavored search experience before the plain,
authorized, correct version exists and is validated.

**6. Architecture questions requiring approval before implementation:**
- Confirm the search surface for v1 (tasks + projects + messages, per §8) is the right
  starting set, or whether files/people/teams should be included from day one.
- Confirm a single unified `/search` endpoint (mixed result types) is preferred over
  separate per-entity endpoints.
- Confirm no ranking/relevance sophistication beyond Postgres's built-in `ts_rank` is
  needed for v1.

This is an assessment only. No code, schema, route, or UI was created or modified. The
dedicated Phase 5 architecture report (§10's outline) should be written and explicitly
approved before any implementation begins, matching the process used for every phase so
far.

READY FOR NEXT PHASE PLANNING
