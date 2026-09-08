# 18 — Product Capability & Roadmap Assessment

**Snapshot commit:** `d4d3b8b` (branch `master`)
**Method:** every claim below was verified against the actual repository at this commit —
`schema.prisma`, all 8 migrations, every file in `packages/domain/src/services`, the
permission engine, all 54 API route files, all UI pages/components, `packages/shared`,
`tests/e2e/abc-college.e2e.test.ts` (84 passing scenarios), `docker-compose.yml`,
`package.json` dependency lists, and `.env.example` — not from `docs/architecture/*`'s
claims about itself. Where the original design docs (02, 12) describe something the code
does not do (Supabase Auth, Supabase Storage, Postgres RLS, rate limiting), that gap is
called out explicitly; doc 14 (Phase 1 deviations) already self-discloses most of it, and
this report re-verifies each disclosure against the code rather than trusting the doc.

This is a read-only assessment. No code, schema, migration, or file was created or changed
except this report.

---

## 1. Repository Inspection Summary

- **Monorepo**: npm workspaces (`apps/web`, `packages/db`, `packages/domain`, `packages/shared`). No Turborepo (deferred per doc 14 #2 — not missed).
- **Schema**: 34 Prisma models, 8 migrations, all additive (no destructive migration exists in this repo's history). Two Postgres roles (`app` owner / `app_runtime` least-privilege), `audit_logs` UPDATE/DELETE revoked from `app_runtime` — real, verified in migration SQL. **Zero `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` statements exist anywhere** — confirmed by grep across every migration file. Tenant isolation is 100% application-layer (`PermissionService` + per-service predicates), not defense-in-depth at the DB layer, exactly as doc 14 #4 discloses.
- **Domain**: 13 services (`auth`, `permission`, `organization`, `task`, `assignment`, `conversation`, `task-attachment`, `task-activity`, `project`, `reporting`, `notification`, `audit`, `storage`) + 2 standalone permission-engine predicates (`conversation-access.ts`, `project-access.ts`) + 2 state machines (task status, assignment status) + 1 scope-resolution engine.
- **API**: 54 route files under `/api/v1/*`, one shared envelope (`{data,error}`), one shared `withAuth` wrapper. No API versioning beyond the `/v1/` path segment (fine for now, not a gap worth fixing yet).
- **UI**: 15 pages, 8 shared components, one `WorkspaceProvider` context, Tailwind, no design system beyond a handful of `.btn-*`/`.input`/`.card` utility classes.
- **Testing**: 42 domain unit tests (state machines, permission-engine predicates, storage, attachment-failure-consistency) + 1 E2E file with 84 real HTTP→service→Postgres scenarios covering Phase 1 through Phase 2C. `test:integration` script is defined but its config file (`vitest.integration.config.ts`) does not exist and never has (confirmed via `git log`) — a genuinely broken script, not a regression.
- **Deployment**: `docker-compose.yml` starts Postgres only. No Dockerfile for the app, no CI workflow (no `.github/`), no Vercel/Fly/Railway config, no staging environment definition anywhere in the repo.
- **Storage**: local disk only (`LocalDiskStorageService`), gitignored `storage/local/`. No S3/Supabase/GCS adapter exists.
- **Auth**: hand-rolled `jose`-signed JWT in an httpOnly cookie + bcrypt password hashing. No Supabase Auth (doc 02's original design), no OAuth/SSO, no email verification, no password reset, no MFA, no account lockout.
- **AI**: zero implementation. `AiInteraction` model and `AI_FEATURES_ENABLED` env flag exist and are completely unused by any code path.

---

## 2. Complete Feature Inventory (grouped A–AE)

Legend — **Quality**: Solid (tested, consistent) / Adequate (works, rough edges) / Weak (works narrowly or untested) / N/A. **Importance**: Critical / High / Medium / Low.

### A. Authentication & Users
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Signup/login/logout (email+password, JWT cookie) | Implemented | Solid | bcrypt, jose | Critical | — |
| Email verification | Missing | — | Email provider | Medium | Later |
| Password reset | Missing | — | Email provider | High | Soon |
| MFA / SSO / OAuth | Missing | — | Auth provider swap | Low (now) | Defer |
| Account lockout / brute-force protection | Missing | — | Rate limiting | Medium | Soon |
| User profile edit (name, avatar, timezone) | Partial — `avatarUrl`/`defaultTimezone` columns exist, no UI/route to edit them | Weak | — | Low | Later |

### B. Personal Workspace
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Auto-provisioned on signup | Implemented | Solid | — | Critical | — |
| Self-assign-only task model | Implemented | Solid | Task, Assignment | Critical | — |
| Personal projects | Implemented (Phase 2C) | Solid | Project | Medium | — |

### C. Organization
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Create org, auto ORG_ADMIN grant, org workspace | Implemented | Solid | RBAC | Critical | — |
| Member invite/add | Partial — add-by-userId works (`/organizations/:id/members`), no email-invite flow (no pending invite state, no invite link) | Adequate | Email | High | Soon |
| Org settings (name, slug, `settings` JSON) | Partial — `settings: Json` column exists, unused by any route | Weak | — | Low | Later |
| Multi-org membership for one user | Implemented (workspace switcher in nav) | Solid | — | Medium | — |

### D. Departments
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| CRUD + parent/child hierarchy | Implemented (create + hierarchy in schema/permission-engine `getDepartmentPath`) | Adequate — no dedicated department management UI page (departments are created via API in tests/seed flows only) | Org | High | Soon |
| Department-scoped permission grants | Implemented | Solid | RBAC | High | — |

### E. Teams
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| CRUD, department link | Implemented, has UI (`/organizations/:id/teams`) | Solid | Org, Dept | Critical | — |
| Membership + Team Head designation | Implemented, has UI | Solid | — | Critical | — |

### F. Roles & Permissions
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Capability-based permission catalog (32 keys) | Implemented | Solid | — | Critical | — |
| System role templates (ORG_ADMIN, DEPARTMENT_HEAD, TEAM_HEAD, MEMBER) | Implemented, seeded idempotently | Solid | — | Critical | — |
| Custom org-defined roles | Partial — `Role.organizationId` supports it, `Role`/`RolePermission` CRUD exists via `/organizations/:id/roles` & `/role-grants`, but no UI to build a custom role (grant list) | Adequate | — | Medium | Soon |
| Scope resolution (ORG/DEPT/TEAM, dept-path inheritance) | Implemented, unit-tested | Solid | — | Critical | — |

### G. Tasks
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Create (Quick + Advanced), edit, cancel | Implemented | Solid | — | Critical | — |
| Checklist items | Implemented | Solid | — | High | — |
| Comments (`TaskComment`) | Implemented but **orphaned** — API live, zero UI consumer since Phase 2A's Conversation superseded it (see §13) | Weak (dead surface) | — | Low | Fix debt |
| Subtasks (`parentTaskId`) | Partial — schema + relation exist, no service method reads/writes it beyond raw create, no UI | Weak | — | Medium | Later |
| Tags (`Tag`/`TaskTag`) | **Unused** — models exist, zero service/route/UI reference anywhere | Missing (dead schema) | — | Low | Remove or build |
| Dependencies (`TaskDependency`, BLOCKS/RELATES_TO) | **Unused** — same as Tags | Missing (dead schema) | — | Low | Remove or build |

### H. Task Assignment
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Individual↔individual, cross-team, cross-dept, team→internal-distribute (all 6 brief patterns) | Implemented, E2E-tested end to end | **Solid — the strongest part of the product** | RBAC | Critical | — |
| Origin tracking (immutable via DB trigger) | Implemented | Solid | — | High | — |
| Reassignment mid-flight | Implemented | Solid | — | High | — |

### I. Acknowledgement
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Accept/decline (individual + team-head-on-behalf) | Implemented, state-machine-governed, unit + E2E tested | Solid | — | Critical | — |
| Decline reason required | Implemented | Solid | — | Medium | — |

### J. Task Lifecycle
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Full state machine (DRAFT→…→COMPLETED/CANCELLED) | Implemented, unit-tested | Solid | — | Critical | — |
| Progress updates (%, note) | Implemented | Solid | — | High | — |
| Submit → review → approve/changes-requested | Implemented | Solid | — | Critical | — |
| Overdue detection | Implemented but **reactive only** — `isOverdue()` runs when a list is fetched; nothing proactively notifies anyone | Adequate | Background jobs | High | Soon |

### K. Projects / Events
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Project/Event CRUD (kind is cosmetic) | Implemented (Phase 2C), E2E-tested | Solid | — | High | — |
| Derived progress (never stored) | Implemented | Solid | — | Medium | — |
| Important dates (labeled list, no recurrence) | Implemented | Adequate | — | Medium | — |
| Project→task filter (thin, reuses task infra) | Implemented | Solid | — | High | — |

### L. Project Membership
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Individual members, team participants | Implemented, E2E-tested including the explicit non-leakage regression | Solid | — | High | — |
| Live (uncached) revocation | Implemented, E2E-tested | Solid | — | High | — |

### M. Conversations
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Task conversation (Phase 2A) + Project conversation (Phase 2C, same model) | Implemented | Solid | — | High | — |
| Replies, mentions, reactions, edit/delete own message | Implemented | Solid | — | High | — |
| Read cursor / unread count | Implemented (single cursor per conversation, not per-message) | Adequate | — | Medium | — |
| Real-time delivery (websocket/SSE) | Missing — UI polls on mount + 30s notification poll only | Weak for a "conversation" product | Realtime infra | Medium | Later |

### N. Files & Attachments
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Upload/list/retrieve/delete (task + project scoped, one model) | Implemented, E2E-tested including failure-consistency (orphan cleanup) | Solid | — | High | — |
| Mime/size validation, filename sanitization | Implemented | Solid | — | High | — |
| Object storage (S3-class) | **Missing** — local disk only, will not survive a second app instance or a serverless deploy | Missing | S3/Supabase/GCS adapter | Critical for production | Fix before scale |
| Virus scanning | Missing | — | Scan hook | Medium | Before public upload exposure |
| Previews (beyond raw `<img>` for images) | Missing (PDF/office preview) | — | — | Low | Later |

### O. Notifications
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| In-app (DB-backed, mark read/unread, bell + full list) | Implemented | Adequate — 30s poll, not push | — | High | — |
| Push (mobile/web push) | Missing — `DeliveryChannel.PUSH` enum value exists, never set by any code | Missing | Device tokens, push service | High (for mobile) | With mobile |
| Email | Missing — `DeliveryChannel.EMAIL` same story | Missing | Email provider | Medium | Soon |
| Preferences (mute/digest/channel choice) | Missing | — | — | Medium | Later |
| Deadline-approaching / overdue proactive alerts | **Missing** — `DEADLINE_APPROACHING`/`TASK_OVERDUE` notification types are declared and never triggered anywhere; no scheduler exists to fire them | Missing (dead enum values) | Cron/scheduler | High | Soon |

### P. Calendar / Dates
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Task due dates, project important dates | Implemented | Adequate | — | Medium | — |
| Calendar view (any kind) | **Missing entirely** | — | — | Medium | Later (deliberately) |
| External calendar sync (Google/Outlook) | Missing | — | OAuth, calendar API | Low (now) | Defer |
| Recurring events/tasks | Missing | — | — | Low (now) | Defer |

### Q. Dashboard
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Personal (My Tasks, Due Today, Overdue, Upcoming, Completed, Pending Acceptance, Waiting for Review, My Projects) | Implemented, wired UI | Solid — genuinely the closest thing to "situational awareness" that exists today | — | Critical | — |
| Team dashboard (workload, unassigned/assigned/in-progress/overdue) | Implemented, wired UI | Solid | — | High | — |
| Org dashboard (dept/team performance, completion trend) | Implemented, wired UI | Adequate — counts only, no trend-over-time chart | — | High | — |

### R. Search
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Any search (tasks/projects/users/messages/files) | **Missing entirely** — zero routes, zero service, zero UI, confirmed by repo-wide grep | Missing | Postgres FTS or external index | High | Next few phases |

### S. Reporting
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Basic aggregation (counts, overdue, completion, per-dept/team) | Implemented, wired UI | Adequate | — | Medium | — |
| Time-series / trend charts | Missing | — | — | Low (now) | Later |
| Export (CSV/PDF) | Missing | — | — | Low | Later |
| Individual workload view across all their tasks org-wide | Partial — derivable from "My Tasks" but no dedicated workload report | Weak | — | Medium | Later |

### T. Daily Work Cycle
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| "Today" view | Partial fragment — dashboard's `dueToday` bucket exists | Weak as a cycle | — | High | Next |
| Plan (choose today's work, time-block, priority-order) | **Missing** | — | — | High | Next |
| Start/Close ritual, end-of-day review, carry-forward | **Missing** | — | — | High | Next |
| Unplanned-work capture / interruption logging | Missing | — | — | Medium | Later |

### U. Time Tracking
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Estimated duration | Implemented — `Task.estimatedDurationMinutes`, set once, never compared to actual | Weak (write-only field) | — | Low | Later |
| Actual time / work sessions / pause-resume | **Missing entirely** | — | — | Low (now) | Defer |

### V. Mobile
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Consistent JSON envelope + error codes | Implemented | Solid | — | Critical for mobile | — |
| Auth transport suitable for native apps | **Gap** — cookie-only session (`httpOnly` JWT cookie); no bearer-token/API-key mode a native client can store itself | Weak for mobile | Auth rework | Critical before mobile | Before mobile phase |
| Consistent pagination shape | **Gap** — messages/notifications/activity use `{items, nextCursor}`; project members/teams/dates, comments, updates, task lists return raw arrays with no pagination at all | Inconsistent | — | High before mobile/scale | Before mobile phase |
| Push notification plumbing | Missing (see O) | — | — | High | With mobile |
| Deep links | Missing (no URL scheme design) | — | — | Medium | With mobile |

### W. AI
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Any AI feature | **Not implemented** (by design — Phase 1–2C scope) | N/A | See §6 | Deferred by design | Later, deliberately |
| `AiInteraction` logging table | Present, schema-only, unused | N/A | — | — | Ready when needed |

### X. Integrations
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Calendar/email/Slack/Teams | **Missing entirely** | — | OAuth per provider | Low (now) | Defer |

### Y. Billing / SaaS
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Plans/tiers, seats, billing, payment provider | **Missing entirely** — no `plan`/`tier` field on Organization, no Stripe/payment code | — | Payment provider | Low (now) | Defer until PMF |

### Z. Security
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| App-layer authorization (RBAC, resource predicates) | Implemented, extensively tested | Solid | — | Critical | — |
| Postgres RLS (second defense layer) | **Missing** — explicitly deferred per doc 14 #4 | Missing | Session-variable mechanism | High before production | Before production |
| Audit log immutability (DB-role-enforced) | Implemented | Solid | — | High | — |
| Rate limiting / abuse prevention | **Missing entirely** | — | Edge middleware | High before production | Before production |
| IDOR protection | Implemented (route params, never body-trusted ids) — verified by direct code review + tests | Solid | — | Critical | — |
| Signed/short-lived file URLs | Not applicable yet — local disk has no signed-URL concept; server streams and re-checks auth per request instead (a legitimate substitute today, not a gap given local storage) | Adequate for now | — | High once on object storage | With storage swap |

### AA. Performance
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Core-path indexes (workspace/status/project/task/actor/created_at) | Implemented | Solid | — | High | — |
| Unbounded list queries (comments, updates, project members/teams/dates, org departments/teams) | **Gap** — no `take`/cursor on several `findMany` calls | Weak at scale | — | Medium now, High at scale | Before scale |
| Caching layer | Missing | — | — | Low (now) | Defer |

### AB. Observability
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Structured logging | **Missing** — only ad hoc `console.error` in the API error mapper | Weak | — | High before production | Before production |
| Metrics / APM / error tracking (Sentry-class) | **Missing entirely** | — | — | High before production | Before production |

### AC. Deployment / Production
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Any deployment target (Docker app image, Vercel, Fly, etc.) | **Missing entirely** — `docker-compose.yml` is DB-only | — | — | Critical for launch | Before launch |
| CI pipeline | **Missing entirely** — no `.github/` workflows | — | — | High | Soon |
| Staging environment | Missing | — | — | Medium | Before launch |
| Backups / PITR | Missing (local Docker volume only) | — | Managed Postgres | Critical for launch | Before launch |

### AD. Testing
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Domain unit tests (42) | Implemented | Solid | — | High | — |
| E2E over real HTTP+DB (84 scenarios) | Implemented, genuinely comprehensive for the features it covers | **Solid — a real strength** | — | Critical | — |
| Integration test tier | **Broken** — `npm run test:integration` references a nonexistent config file | Missing | — | Low (E2E already covers this ground) | Fix or delete the script |
| Frontend component tests | Missing | — | — | Low (now) | Later |

### AE. Data / Backup / Recovery
| Feature | Status | Quality | Dependencies | Importance | Phase |
|---|---|---|---|---|---|
| Soft-delete / status-transition convention | Implemented consistently (attachments, messages, projects) | Solid | — | High | — |
| Automated backups | **Missing** | — | Managed Postgres | Critical for launch | Before launch |
| Documented recovery procedure | Missing | — | — | Medium | Before launch |

---

## 3. What The Product Can Do Today (verified, end-to-end)

Every workflow below was traced through actual service/route code and matches a passing E2E scenario — not aspirational.

1. **Sign up → get a personal workspace automatically → create and complete a personal task** solo, no organization needed.
2. **Create an organization → build departments → build teams → add members → designate a Team Head → grant scoped roles.**
3. **Create a task and route it through any of the six real assignment patterns**: direct individual, cross-team, cross-department, org-wide, team assignment → Team Head accepts → Team Head distributes internally → individual accepts → task moves to IN_PROGRESS.
4. **Decline an assignment with a required reason**, which reverts the task to a re-assignable state.
5. **Post progress updates, submit for review, have a reviewer approve or request changes**, cycling back to IN_PROGRESS on a request.
6. **Hold a threaded conversation on a task**: reply, @mention (server-validated against real access, not a trusted client list), react with emoji, edit/delete your own message, see an accurate unread count, mark read.
7. **Upload files to a task**, attach them to a specific message or leave them unlinked, download them back out through an authorization-rechecked endpoint, delete your own upload (soft-delete).
8. **Create a Project or Event** ("Annual Day 2026"), add individual members and whole teams as participants, add tasks that are simultaneously visible under "My Tasks" and under the project, hold a separate project-level conversation and file library, track a handful of important dates, and see progress computed live from task status — with a verified guarantee that project-team membership never silently grants access to an unrelated task's conversation.
9. **See a personal dashboard** with Due Today / Overdue / Upcoming / Completed / Pending Acceptance / Waiting for Review buckets, a **team dashboard** with workload-per-member, and an **organization dashboard** with department/team completion and overdue counts.
10. **Get in-app notifications** for every one of the above (assignment, accept/decline, comment, message, mention, review outcome), with a bell dropdown and a full notifications page that deep-links to the right task or project.
11. **Look at a complete, tamper-evident audit trail** for any task, any project, or the whole organization, written by every mutation above and immutable at the database level.

What's notably **not** available yet, even though it sounds adjacent to the above: searching for anything, seeing a calendar, getting proactively notified that something is overdue (only reactive, on-visit), or using the product from anything other than a signed-in browser session on this exact web app.

---

## 4. Partially Built Features — Detail

**Reporting.** *Exists:* per-dept/team task counts, completion, overdue, via a real (not mocked) `ReportingService` composed from `TaskService.listTasks`, wired to actual UI pages. *Missing:* any time dimension (no "last 7 days" / trend), no export, no cross-project rollup, no individual workload view distinct from "My Tasks." *Production-ready needs:* at minimum a trend chart and CSV export before calling this "reporting" rather than "counters." *Now or later:* **later** — the counters already answer the most common manager question ("what's overdue, who's behind") well enough to not be this quarter's bottleneck.

**Notifications.** *Exists:* real DB-backed events, sensible triggers, in-app UI. *Missing:* push/email delivery, preferences, and — the most consequential gap — nothing is ever triggered proactively (no scheduler exists), so a task can sit overdue for weeks and nobody gets told unless they open the app. *Production-ready needs:* a scheduled job runner (even a simple cron endpoint hit by an external scheduler) plus one real delivery channel beyond in-app. *Now or later:* the proactive-overdue piece is genuinely **soon** — it's the single highest-leverage fix relative to effort, and directly serves the "run your day from one place" positioning; push/email channels themselves can wait.

**Dashboard.** *Exists:* three real, differentiated dashboards (personal/team/org) with correct authorization. *Missing:* a coherent single "start my day" moment — the personal dashboard is a grid of buckets, not a ranked, actionable list. *Production-ready needs:* nothing structurally; this is a UX/product-design gap, not a plumbing gap. *Now or later:* the underlying data is already there — this is the natural first slice of Daily Work Cycle, not separate work.

**Projects.** *Exists:* the full model from the brief (members, teams, conversation, files, dates, derived progress), extensively tested. *Missing:* nothing structural for an MVP; the People/Dates tabs are functional but plain (no bulk-add, no reminder tied to a date). *Production-ready needs:* UI polish only. *Now or later:* **later**, low urgency — this phase just shipped and is solid.

**Search.** *Exists:* nothing. *Missing:* everything — no index, no route, no UI entry point. *Production-ready needs:* Postgres full-text search (`tsvector`) over task title/description + project name is enough for an MVP; no external search service needed at this scale. *Now or later:* **next** — this is the single most commonly-expected feature that is entirely absent, and it's cheap relative to its value (see §12).

**Task management (core).** *Exists:* the complete lifecycle and the entire assignment/acknowledgement engine — this is not "partial," it's the most complete part of the product. Listed here only to flag its two orphaned neighbors: `TaskComment` (dead UI surface, superseded by Conversation) and `TaskDependency`/`TaskTag` (dead schema, never wired). *Now or later:* clean up **now** as architectural debt (§13), not a feature investment.

**Mobile support.** *Exists:* a genuinely mobile-friendly-shaped JSON API (uniform envelope, clear error codes). *Missing:* everything that turns "an API a mobile app could theoretically call" into "an API a mobile app should call" — bearer-token auth, uniform pagination, push notifications. *Production-ready needs:* see §7. *Now or later:* fix the auth/pagination inconsistencies **before** starting a mobile build, not during it — retrofitting auth transport after a mobile client exists is much more expensive.

**Storage.** *Exists:* a clean interface (`StorageService`) with exactly one implementation (local disk), explicitly designed as a swap point. *Missing:* the actual S3-class implementation. *Production-ready needs:* an S3-compatible adapter is a **hard blocker** for any multi-instance or serverless deployment — local disk means uploaded files vanish or become inconsistent the moment there's more than one running app instance. *Now or later:* must happen **before** production deployment, not after.

**Permissions.** *Exists:* the full engine, seeded system templates, org-scoped custom `Role`/`RolePermission` rows reachable via API. *Missing:* a UI to actually build a custom role (pick permissions, save, grant it) — right now customizing roles requires calling the API directly. *Now or later:* **later** — the four system templates cover the brief's actual scenarios; custom-role UI is a real gap but not urgent until a customer specifically needs it.

---

## 5. Missing Product Capabilities — Product-Architect View

### Daily Work Cycle
The dashboard's `dueToday` bucket is a *fragment* of a cycle, not the cycle itself — it's a filtered list, with no notion of "I chose to work on these five things today," no ordering, no time-blocking, no explicit close-of-day moment, and nothing carried forward automatically into tomorrow's view. **Build first:** a `DailyPlan`-shaped concept — a per-user, per-day ordered set of task references (could be as simple as a join table with a position and a "planned" boolean) plus a two-screen ritual (Plan / Review). This deliberately does **not** need time-blocking, actual-vs-estimated tracking, or interruption logging in its first version — those are v2 refinements once the core ritual is validated with real usage.

### Calendar
**MVP:** a read-only aggregated view of `Task.dueDate` + `ProjectDate` on a month/week grid — zero new write model needed, since both already exist. **Explicitly later:** anything involving meetings, time blocks, recurrence, or external sync (Google/Outlook) — those are genuinely large, separate subsystems (recurrence rules alone are a well-known complexity trap) and nothing in the current product needs them yet. Do not build a scheduling engine before there is a single confirmed user asking for meeting-booking.

### Search
**MVP:** Postgres `tsvector` full-text search over task title/description, project name/description, and (optionally) message body, scoped through the exact same authorization predicates every other read path already uses (never a parallel unauthorized index). This is genuinely small — a GIN index, one query, one UI input — and disproportionately valuable, because right now there is *no way to find anything* except by browsing lists.

### Reporting
**MVP add-on:** one trend chart (tasks completed per week, last 8 weeks) and a CSV export button on the existing org dashboard. **Later:** bottleneck detection, workload-distribution heatmaps, predictive risk — all of these are legitimately AI/analytics territory (§6), not hand-rolled reporting work.

### Notifications
**MVP add-on:** a scheduled job (even a single cron-hit endpoint) that scans for tasks crossing into "due tomorrow" / "now overdue" and fires the two notification types that already exist in the enum but are never triggered. **Later:** push, email, digests, per-type preferences.

### Time Tracking
**Not recommended now.** The one field that exists (`estimatedDurationMinutes`) is unused for anything beyond storage. Building real time tracking (sessions, pause/resume, actual-vs-estimate reporting) is meaningful scope for a feature nobody has asked for yet and that competes directly with dedicated time-tracking tools. Defer until a specific customer need is confirmed.

---

## 6. AI Readiness Assessment

No AI is being built here — this section evaluates whether the *foundation* would support it later, per capability.

| Capability | Data required | Schema supports it today? | Gap to close first |
|---|---|---|---|
| 1. NL task creation | Free text → structured Task | Yes — `createTaskSchema` is already the single contract for manual + (future) AI-produced input, per its own doc comment | None — this is the best-prepared AI feature in the codebase |
| 2. Task parsing | Same as above | Yes | None |
| 3. Assignee recommendation | Historical assignment outcomes, team/skill signals | Partial — `TaskAssignment` history exists; no skill/capacity model | Needs a lightweight "current workload per user" query (derivable today) before a recommendation is more than a guess |
| 4. Deadline intelligence | Historical estimate-vs-actual, overdue patterns | **No** — no actual-duration data exists anywhere (see §5 Time Tracking) | Needs real completion-time data first; premature without it (doc 10 itself flags this) |
| 5. Checklist generation | Task title/description → suggested items | Yes (`checklist: string[]` at creation is already the exact shape) | None |
| 6. Daily planning | User's tasks + priorities + a `DailyPlan` concept | **No** — no planning entity exists yet | Build Daily Work Cycle's `DailyPlan` first (§5) |
| 7. Daily summary | Audit log + task state for a user/day | Yes — the audit log already has everything needed | None |
| 8. Conversation summarization | `TaskMessage` thread | Yes | None |
| 9. Action extraction from conversations | Same | Yes | None |
| 10. Attachment understanding | File content | Partial — files exist, but only as opaque local-disk blobs; no text-extraction pipeline | Needs a content-extraction step, deferred until object storage lands anyway |
| 11. OCR | Image/PDF attachments | Same as above | Same as above |
| 12. Meeting → tasks | Meeting transcript/notes input | No calendar/meeting model exists | Needs Calendar MVP first (§5) if meetings become a first-class object; text-paste-based extraction needs nothing new |
| 13. Follow-up generation | Overdue/stale task detection | Yes — `isOverdue()` + audit log already provide the trigger signal | Needs the scheduler gap closed (§5 Notifications) to run proactively |
| 14. Workload analysis | Per-user active-task counts | Yes — `ReportingService.getTeamDashboard`'s `workload` array already computes this | None |
| 15. Bottleneck detection | Cross-team/department task flow over time | Partial — org dashboard has snapshot counts, no time-series | Needs the reporting time-series gap closed (§5) |
| 16. Risk prediction | Historical completion/deadline data | **No** — insufficient historical depth yet (product is pre-launch) | Needs real usage data over time; not a schema gap |
| 17. Project status summaries | Project + task + conversation state | Yes — everything Phase 2C added is directly usable | None |
| 18. AI command center | Aggregation of all of the above | Depends on the above | Sequencing dependency, not a schema gap |
| 19. NL search | Search infrastructure | **No** — no search exists at all yet (§5) | Build MVP search first; NL search is a layer on top, not a replacement |
| 20. Personal work assistant | Daily plan + tasks + notifications + search | Depends on #6, #19 | Sequencing dependency |

**Minimum "AI-ready foundation," in order:** (1) close the Notifications/scheduler gap — most AI-assist features (follow-ups, deadline nudges, daily summaries) need *something* to trigger them; (2) ship Daily Work Cycle's `DailyPlan` concept — several features (#6, #20) have nowhere to attach without it; (3) ship MVP search — needed for #19/#20 and generally useful independent of AI. Everything else in the AI list is either already schema-ready (checklist generation, NL task creation, conversation summarization, project summaries — a genuinely large set) or explicitly data-starved regardless of schema (deadline intelligence, risk prediction) and simply needs the product to run for a while first.

---

## 7. Mobile Readiness

**What's already right:** the `{data, error}` envelope and `ErrorCodes` enum are consistent across all 54 routes; every mutating route re-derives authorization server-side (never trusts a client-supplied id); file upload/download already goes through a normal HTTP endpoint (no browser-only trick involved) — a mobile client could call `POST /attachments`-equivalent endpoints today with no server change.

**What must be corrected before building a mobile app, not during it:**
1. **Auth transport.** The only session mechanism is an httpOnly cookie set by a Next.js route handler. A native app has no cookie jar shared with a browser session — it needs a bearer token (or equivalent) it can store in secure device storage and send as an `Authorization` header. This is an additive change (`getSessionUserId()` can check a header *or* a cookie), not a rewrite, but it needs to exist before a mobile client can authenticate at all.
2. **Pagination consistency.** `{items, nextCursor}` is used for messages, notifications, and activity — but project members/teams/dates, task comments, task updates, and task lists (`GET /tasks`) return bare arrays with no `take`/cursor at all. A mobile client needs one predictable shape; retrofitting this after a mobile app ships means updating two clients instead of one.
3. **Push notification plumbing.** No device-token storage, no push provider integration. Needed the moment a mobile app exists (background badge counts, assignment alerts).
4. **Deep links.** No URL-scheme design exists yet (e.g., `atm://task/:id`) — cheap to define now, awkward to retrofit once app-store builds exist.

**Not a blocker, don't over-build:** offline support / local-first sync is explicitly **not** needed for a first mobile release — a thin online-only client against the existing REST API is sufficient and dramatically less risky than building conflict resolution before there's a single mobile user.

---

## 8. Multi-Tenancy & Security Review

**Verified safe today** (checked directly in code, not assumed):
- Tenant isolation for organizations, workspaces, tasks, conversations, attachments, and projects — every read/write path re-derives the actor's relationship to the resource from the database on every request; nothing is cached or trusted from a prior call. Directly exercised by 20+ dedicated E2E scenarios (cross-tenant, cross-project, cross-task).
- IDOR — every mutating route resolves its target from the URL path parameter (never a client-supplied body field for identity), reviewed across all 54 routes for this specific pattern.
- Membership revocation is live (no caching layer to go stale) — explicitly tested (Phase 2C E2E #18b).
- Personal-workspace restrictions (no cross-user access, no team/member concept) — enforced and tested.
- Role escalation — a plain `MEMBER`-template user cannot self-grant `PROJECT_MANAGE`/`WORKSPACE_PROJECT_MANAGE_*` etc.; every management action re-checks the permission catalog, not a cached role name.
- Audit log integrity — DB-role-enforced immutability (`app_runtime` structurally cannot `UPDATE`/`DELETE` `audit_logs`), not just an application convention.
- Deleted-user/deleted-team edge cases — task-level access has never been derived from project/team membership as a live join that could dangle; a removed team member simply stops matching the `TeamMember` query used by every predicate. No orphaned-grant class of bug was found.

**Acceptable for continued development, not yet production-grade:**
- No Postgres RLS — a second, DB-level enforcement layer doesn't exist. Today's single-layer (application-only) model is honestly documented (doc 14 #4) and has held up under adversarial-style E2E testing so far, but it means a single application-layer bug *is* a tenant-isolation breach, with no structural backstop.
- No rate limiting anywhere — login, signup, and every other endpoint can be hit at unlimited frequency. Fine for a dev/internal-pilot environment; not fine once the app is reachable by the public internet.
- No email verification / password reset / MFA — acceptable for a closed pilot with a known user set; not acceptable for self-serve signup at any real scale.
- Local-disk file storage with no signed-URL model — acceptable for a single-instance deployment; becomes an active liability the moment there's more than one app instance (files simply won't be found).

**Must be fixed before calling this production-ready:**
1. Rate limiting on auth endpoints at minimum (brute-force is currently unmitigated).
2. Object storage swap (local disk is not production storage — data loss risk on redeploy/scale-out, not just a performance concern).
3. Structured logging + an error-tracking service (Sentry-class) — right now a production incident would be debugged blind (`console.error` only).
4. Automated database backups — a Docker named volume with no backup policy is a single point of catastrophic, permanent data loss.
5. Postgres RLS as a genuine second layer, specifically once the app is handling multiple real customer organizations' data rather than a single pilot org — not needed to launch a single-tenant pilot, but needed before onboarding unrelated paying customers onto shared infrastructure.

**On RLS specifically** (the user's explicit question): **do not block the very next phase on it.** The current single-layer model is real, tested, and has caught nothing wrong in 84 adversarial-shaped E2E scenarios across four phases. RLS is the right thing to add before this becomes a genuine multi-tenant SaaS product serving unrelated paying customers on shared infrastructure — i.e., it belongs in the production-readiness phase (§9), not before. Building it now, before there's a second real tenant, would be defending a threat model the product doesn't yet have.

---

## 9. Production Readiness

**MVP production requirements** (minimum to put this in front of one real pilot customer):
- Object storage adapter (S3-compatible)
- Managed Postgres with automated backups
- One deployment target (Docker image + a host, or Vercel-style platform) + a real `.env` secrets story
- Rate limiting on auth endpoints
- Structured logging + basic error tracking
- Password reset flow (self-serve signup without it is a support burden, not a security hole, but it's table stakes)
- Fix or delete the broken `test:integration` script (currently references a nonexistent config)

**Scale-stage requirements** (once there's real multi-tenant traffic):
- Postgres RLS as a second isolation layer
- Background job/scheduler infrastructure (proactive notifications depend on it — §5)
- Consistent API pagination everywhere (§7)
- CI pipeline (typecheck/lint/unit/E2E on every PR) — currently every gate is run manually per phase, which has worked so far specifically *because* phases have been disciplined about it, but doesn't scale to multiple contributors
- Staging environment distinct from production
- Caching for the heaviest read paths (dashboards, project detail) if usage grows

**Enterprise requirements** (explicitly not needed soon):
- SSO/SAML, custom-role UI at scale, data residency controls, SOC2-style audit exports, virus scanning at upload, multi-region deployment. None of these should be built speculatively — they belong to a specific enterprise customer's contract, not a roadmap guess.

---

## 10. Product UX Review

Reviewed as a product a real person uses, not as code.

**Answered clearly today:**
- *What is assigned to me?* — "My Tasks" bucket, unambiguous.
- *What is waiting for me?* — "Pending Acceptance" and "Waiting for Review" buckets exist and are named exactly this way.
- *What is overdue?* — a real, correctly-computed "Overdue" bucket.
- *What is happening in my projects?* — the project detail page's Overview tab surfaces active tasks, upcoming dates, and progress in one place; genuinely coherent.

**Not answered, or answered ambiguously:**
- *What should I work on today?* — the dashboard shows several buckets side by side with no ranking, no "start here," and no way to actually commit to a plan for the day (this is exactly the Daily Work Cycle gap from §5, showing up as a UX symptom).
- *What did I accomplish (today/this week)?* — no such view exists; "Completed" is a bucket, not a reflection.
- *What should I carry forward?* — nothing distinguishes "still relevant" from "fell off my radar"; everything not completed just accumulates.
- *Notification → context* — the notification list links correctly to the right task/project (verified in code), but the bell dropdown itself has no click-through at all — it's read-only, which is a small, cheap inconsistency to fix.

**Inconsistencies worth naming (not fixing yet, per the "don't redesign everything" instruction):**
- Task detail's "Files" tab and the message composer's file attachment both exist and work, but a file attached to a message and a file uploaded loose to the task look identical in the Files tab with no visual distinction of "linked to message #x."
- The org/team/dept management surfaces (roles, role-grants, custom permission sets) are functionally complete via API but have no matching UI depth — an org admin who wants to build a custom role today cannot do it without calling the API directly.

**Priority for a future UX pass** (impact-ordered, not urgent now): (1) a real "Today" plan/ranked view, (2) clickable notification bell items, (3) a lightweight "what did I finish" reflection view, (4) custom-role builder UI.

---

## 11. Competitive / Product Positioning

Judged against what is *actually implemented*, not the category in general.

**Genuinely differentiated, worth defending:**
- The **assignment/acknowledgement chain** (individual→individual, cross-team, cross-department, team-head-distributes-internally, with mandatory accept/decline and a fully preserved origin trail) is more rigorous than Asana/ClickUp/Monday/Trello's flat "assignee field" model. None of those products model *who routed this to whom, and did they actually agree to take it* as a first-class, audited object. This is the product's real moat if it has one.
- **Origin-preserving cross-department task flow** — a task keeps a permanent record of who first assigned it and through which team/department, even after being reassigned repeatedly. This directly serves institutional (college/org-hierarchy) use cases that generic task tools don't model at all.
- **Unified Project+Task conversation/file model** (one `Conversation`/`TaskAttachment` system serving both, rather than a separate "channel" concept) is a smaller, cleaner architecture than Slack-adjacent tools bolted onto a task tool, and it shows in how cleanly Phase 2C extended it without duplicating anything.

**Currently commodity** (present, but table stakes — not a reason anyone would choose this product):
- Checklists, comments/threads, file attachments, basic dashboards, notifications. Every competitor listed has all of these, generally with more UI polish.

**Could become a defensible advantage if built well:**
- A genuinely good **Daily Work Cycle** — none of Asana/ClickUp/Monday/Todoist has cracked "here is exactly what I should do today and here is my close-of-day ritual" as a first-class flow (Todoist gets closest but has no organizational/assignment-chain depth). Combining the existing assignment rigor *with* a real daily ritual is a combination none of the named competitors currently own.
- **Institutional origin-tracking + reporting** aimed specifically at colleges/departments/hierarchies (the product's actual pilot context) rather than generic "teams," which is what every competitor targets.

**Should not be built — established products already do it better, and building it would dilute focus:**
- A general-purpose chat platform (Slack territory) — the task/project-scoped conversation model that exists is the right amount of "chat," more would be scope creep.
- A full calendar/scheduling system with meeting booking — Google/Outlook Calendar already own this; integrate, don't rebuild.
- A Gantt/dependency-heavy project-planning engine — Monday/ClickUp already compete hard here and it's a large investment for a feature the actual example use case ("Annual Day 2026") doesn't need.
- Rich document editing (Notion territory) — task descriptions and project overviews are the right depth; a full document/wiki system is a different product.

**Positioning conclusion:** "Run your entire working day from one place" is currently *true for task/assignment/acknowledgement work* and *not yet true* for the actual "day" — there's no daily ritual, no search, no proactive notification. The single highest-leverage next investment for the stated positioning is Daily Work Cycle, not any of the commodity features above.

---

## 12. Best Next Phases — Ranked

Each phase assumes the previous ones in this ranking are done; ranked by (value × how directly it serves the stated positioning) ÷ (complexity × risk).

### Phase 3 — Daily Work Cycle (Today / Plan / Close)
- **Purpose:** turn the existing task/dashboard data into an actual daily ritual.
- **Why now:** it's the most direct, cheapest path to the product's own stated positioning, and needs zero new subsystems (no scheduler, no external service) — just a new small entity and two UI screens.
- **User value:** answers "what should I work on today" and "what did I get done," the two questions §10 found unanswered.
- **Technical dependencies:** none beyond what exists.
- **Major entities:** `DailyPlan` (userId, date, ordered task references, planned/carried-forward flag).
- **Major APIs:** `GET/POST /daily-plan?date=`, `POST /daily-plan/reorder`.
- **Major UI:** a "Today" screen replacing/augmenting the dashboard's flat buckets with a ranked, committable list; a lightweight end-of-day summary.
- **Security concerns:** none beyond the existing per-user data pattern already used everywhere (own-data-only, cheap to get right).
- **Testing:** unit tests for carry-forward logic, E2E for plan/complete/carry-forward.
- **Complexity:** S–M. **Risk:** Low. **Impact:** High.

### Phase 4 — Search (MVP)
- **Purpose:** make the growing body of tasks/projects/messages findable.
- **Why now:** currently the single most conspicuous absence in an otherwise complete-feeling product; cheap relative to value (§5).
- **User value:** "where did that task/message go" stops being a real problem.
- **Technical dependencies:** none beyond Postgres (native `tsvector`/GIN, no external search service needed at this scale).
- **Major entities:** none new — a search index column/view over existing tables.
- **Major APIs:** `GET /search?q=`.
- **Major UI:** one global search input in the nav.
- **Security concerns:** results must be filtered through the exact same access predicates as every other read — never a shortcut index that bypasses `canViewTask`/`canAccessProject`.
- **Testing:** E2E specifically for "search results never leak content the searcher can't otherwise see."
- **Complexity:** S. **Risk:** Low (the only real risk is the security shortcut above — explicitly called out to avoid it). **Impact:** High.

### Phase 5 — Notifications: Proactive Layer + Scheduler
- **Purpose:** close the "nothing ever proactively tells you something is overdue" gap.
- **Why now:** directly required for the Daily Work Cycle to feel trustworthy, and the notification types already exist unused.
- **User value:** deadlines and pending-acknowledgement items stop silently going stale.
- **Technical dependencies:** a scheduler (can start as one cron-hit HTTP endpoint — no need for a full queue system yet).
- **Major entities:** none new.
- **Major APIs:** one internal scheduled endpoint.
- **Major UI:** none new (uses existing notification surfaces).
- **Security concerns:** the scheduled job must run with system-level authority but write notifications exactly as if each triggering check had been authorized normally — no new open door.
- **Testing:** unit tests on the "which tasks qualify" logic; do not need E2E against a real scheduler (mock the clock).
- **Complexity:** S. **Risk:** Low. **Impact:** Medium–High.

### Phase 6 — Calendar (MVP, read-only aggregation)
- **Purpose:** one visual surface for `Task.dueDate` + `ProjectDate`.
- **Why now:** cheap (zero new write model) once Daily Work Cycle exists to feed it real "what's planned" context.
- **User value:** a week/month-at-a-glance view competitors' calendar tabs already train users to expect.
- **Technical dependencies:** none new.
- **Major entities:** none new.
- **Major APIs:** a read aggregation endpoint (or client-side composition of existing task/date list endpoints).
- **Major UI:** month/week grid.
- **Security concerns:** none beyond existing read authorization.
- **Testing:** UI-level only; no new authorization surface.
- **Complexity:** S–M. **Risk:** Low. **Impact:** Medium.

### Phase 7 — Production Readiness Hardening
- **Purpose:** everything in §9's MVP list — object storage, backups, rate limiting, logging/error-tracking, deploy target.
- **Why now:** must happen before any real pilot customer touches the product, regardless of what feature work happens first; sequenced here because it's pure infrastructure and doesn't need to block feature phases 3–6 from proceeding in parallel on a dev/pilot instance.
- **User value:** indirect (reliability, data safety) but a hard precondition for "real" usage.
- **Technical dependencies:** an object storage provider, a managed Postgres provider, a deploy target.
- **Major entities:** none.
- **Major APIs:** none new (swap `StorageService` implementation only).
- **Major UI:** none.
- **Security concerns:** this phase *is* largely security/reliability work.
- **Testing:** re-run the full existing E2E suite against the production-shaped storage adapter before cutover.
- **Complexity:** M. **Risk:** Medium (external provider integration risk, not product-logic risk). **Impact:** Critical (blocking, not incremental).

### Phase 8 — Mobile Readiness Corrections (backend only)
- **Purpose:** bearer-token auth, uniform pagination — §7's "before, not during" list.
- **Why now:** cheapest to fix before a mobile client exists to depend on the current shape.
- **User value:** none directly yet (backend-only phase); unlocks Phase 9.
- **Technical dependencies:** none new.
- **Major entities:** none.
- **Major APIs:** auth header support added to `withAuth`; pagination retrofitted onto the remaining unbounded list endpoints.
- **Major UI:** none.
- **Security concerns:** bearer-token handling needs the same care cookie handling already got (no token in logs, proper expiry).
- **Testing:** extend existing E2E to also exercise header-based auth.
- **Complexity:** S–M. **Risk:** Low. **Impact:** Medium now, High as an enabler.

### Phase 9 — Mobile App (React Native/Expo)
- **Purpose:** the actual mobile client, per doc 10's original Phase 4 intent.
- **Why now (i.e., why this position):** only makes sense once Phases 3–6 have given it something worth showing and Phase 8 has made the API safe to depend on.
- **User value:** access from a phone — genuinely important for a "run your day" product, but only once the day-running features (3–6) exist to run.
- **Technical dependencies:** Phase 7 (production backend) and 8 (mobile-safe API).
- **Complexity:** L. **Risk:** Medium. **Impact:** High, but only once fed by earlier phases.

### Phase 10 — AI Layer
- **Purpose:** the assistive features in §6 that are already schema-ready (NL task creation, checklist generation, conversation summarization, daily summaries, follow-up drafting).
- **Why now (i.e., why this position, not earlier):** deliberately sequenced after Daily Work Cycle and the notification scheduler, since §6 shows most of the highest-value AI features (#6, #13, #20) have a direct dependency on those existing first; building AI on top of an incomplete daily-work foundation means re-plumbing it twice.
- **Complexity:** M–L (scoped to assistive-only, matching doc 10's own Phase 2 framing — never auto-acting). **Risk:** Medium (cost/quality control, not authorization risk, since the AI-produced payloads reuse existing Zod-validated schemas). **Impact:** High, differentiating.

### Phase 11+ — Reporting depth, custom-role UI, external calendar sync, billing/SaaS multi-tenancy hardening (RLS), enterprise features
Correctly **later**, per §9/§11 — none of these block anything above, and building them earlier would be premature relative to confirmed demand.

---

## 13. Architectural Debt — Found Now

**MUST FIX NOW** (cheap, and actively confusing to anyone reading the code):
- `TaskComment`/`/tasks/:id/comments` is a fully live API with zero UI consumer, superseded by the Conversation system. Either delete the route+service methods+schema, or explicitly redirect it to the conversation. Leaving both live invites a future contributor to build on the dead one.
- `TaskDependency`, `TaskTag`, `Tag` models exist in the schema with **zero** code references anywhere (service, route, or UI). Either remove them or build the smallest real feature that uses them — dead schema surface is a maintenance and onboarding cost with no offsetting value.
- `DeliveryChannel.PUSH`/`.EMAIL` enum values and `NotificationType.DEADLINE_APPROACHING`/`.TASK_OVERDUE` are declared and never set/triggered by any code path — harmless today, but will silently look "already built" to a future reader/AI agent scanning the schema. Comment them as not-yet-wired or remove until Phase 5 actually uses them.
- The `test:integration` npm script references a config file that has never existed in this repo's history — either write the config or delete the script; a broken script in `package.json` is a trap for the next contributor who runs it expecting it to work.

**SHOULD FIX SOON:**
- Pagination inconsistency across list endpoints (§7) — will get more expensive to retrofit the longer more endpoints are added without it.
- No structured logging/error tracking (§8/§9) — cheap to add now, expensive to debug production issues without it later.
- Local-disk storage as the only `StorageService` implementation — not urgent for continued feature development, but should not be deferred until the week of a real deployment.

**CAN DEFER:**
- Custom-role builder UI — the API exists; only the UI is missing, and no confirmed need for it yet.
- Real-time (websocket) message delivery — polling works fine at current usage; revisit if/when conversation volume grows.
- Turborepo / build-graph optimization — npm workspaces scripting is handling the current build graph fine.

**Architecture that would make mobile difficult** (already flagged in §7, restated here as debt specifically): cookie-only auth, inconsistent pagination. Both are still cheap to fix today; they become expensive the day a second client (mobile) exists and has to work around them.

**Architecture that would make AI difficult:** none found. The schema, the Zod-schema-as-single-contract pattern (`createTaskSchema` explicitly designed to serve manual and AI-produced input identically, per its own doc comment), and the audit log's completeness are all already AI-friendly by design — this is a genuine strength worth preserving as new features are added (keep validating AI-produced payloads through the same schemas humans use, never a separate "trusted AI path").

**No duplicated services, no authorization inconsistencies, and no schema/migration problems were found beyond what's listed above** — the extend-don't-duplicate discipline visible across Phases 2A/2B/2C (reusing `Conversation`/`TaskAttachment`/`Project` rather than building parallel systems) has genuinely prevented the more common form of this kind of debt.

---

## 14. Overengineering Check

Every recommendation above was screened against "does this materially improve the product now" before inclusion. Explicitly **not** recommended, and why:
- No generic chat platform — the existing task/project-scoped conversation model is the right size.
- No full calendar/scheduling engine — MVP is a read-only aggregation; meeting-booking is out of scope until a real user asks.
- No Gantt/dependency engine — `TaskDependency` exists in schema but building a real dependency-graph UI now would be solving a problem the actual pilot use case doesn't have.
- No microservices split — a monolith Next.js app + one Postgres database is the correct shape at this scale; splitting now would add operational cost with zero user-facing benefit.
- No event-driven/message-queue architecture — the direct-transaction, audit-log-as-event-source pattern already in use is simpler and has been sufid architecturally.
- No AI-everywhere — §6/§12 deliberately sequence AI *after* the foundation it depends on, and scope it to assistive-only per the original doc 10 framing, not autonomous action.
- No enterprise features (SSO/SAML, data residency, custom SLAs) before there is a single enterprise customer asking for them.

---

## 15. Prioritized Roadmap

### NOW — build immediately
- Daily Work Cycle MVP (Phase 3)
- Search MVP (Phase 4)
- Clean up the four MUST-FIX debt items (§13) — small enough to fold into whichever phase is in flight

### NEXT
- Notifications proactive layer + scheduler (Phase 5)
- Production readiness hardening — object storage, backups, rate limiting, logging (Phase 7) — can run in parallel with feature phases, not sequentially blocking them
- Calendar MVP (Phase 6)

### LATER
- Mobile readiness corrections (Phase 8), then the mobile app itself (Phase 9)
- AI layer (Phase 10), starting with the schema-ready assistive features from §6
- Reporting depth (trend charts, export)
- Custom-role builder UI

### DEFER
- Real-time (websocket) conversation delivery
- Time tracking
- External calendar sync (Google/Outlook)
- Postgres RLS (until there's a second real tenant sharing infrastructure)
- Billing/SaaS multi-tenancy plumbing
- Recurring tasks/automation rules

### NEVER / AVOID
- Generic chat platform
- Full ERP-style feature breadth
- Gantt/dependency-heavy project engine
- Premature microservices or event-driven architecture
- AI auto-acting without human confirmation (any AI feature must stay assistive-only, per doc 10's own framing)
- Enterprise features built speculatively, without a specific customer driving them

### Dependency graph

```
Foundation (Phases 1-2C, done)
   ↓
Daily Work Cycle ──────────────┐
   ↓                            │
Search                          │  (both feed directly into)
   ↓                            ↓
Notifications (proactive) ← ────┘
   ↓
Calendar (MVP)
   ↓
Production Readiness Hardening ─── (parallel track, not sequential — can start anytime)
   ↓
Mobile Readiness Corrections (backend)
   ↓
Mobile App
   ↓
AI Layer (assistive)
   ↓
Reporting depth / custom-role UI / RLS / billing (as real demand confirms each)
```

Production Readiness Hardening is drawn in-line for clarity but should actually start **in parallel** with Daily Work Cycle/Search, not after them — it has no dependency on the feature phases and nothing else depends on waiting for it except the actual go-live moment.

---

## 16. Final Answers

**"If we stop coding today at d4d3b8b, what product do we actually have?"**
A genuinely solid, well-tested **institutional task-assignment-and-accountability engine** with a real conversation and file layer and a working Project/Event grouping concept on top — usable today by a real organization willing to work inside a browser, with a known and honestly-documented set of gaps (no search, no proactive alerts, no calendar, local-only file storage, no deployment target). It is not yet the "Work Operating System" described in the positioning — it's the accountability core that a Work OS needs to be built on, and that core is unusually rigorous for this stage of a project (six real assignment patterns, a full acknowledgement state machine, immutable audit trail, 84 passing end-to-end tests). What's missing is almost entirely the *daily-use* layer (search, a real Today ritual, proactive notifications) and the *production* layer (storage, backups, deployment) — not more accountability plumbing.

**"What are the 10 most valuable things we can build next?"**
1. Daily Work Cycle MVP (Today/Plan/Close)
2. Search (Postgres full-text MVP)
3. Proactive notifications + a scheduler
4. Clean up the four dead-code/debt items in §13
5. Object storage adapter (S3-compatible)
6. Automated backups + a real deploy target
7. Rate limiting + structured logging/error tracking
8. Calendar MVP (read-only aggregation)
9. Mobile-readiness backend corrections (bearer auth, pagination)
10. AI layer, starting with the already-schema-ready assistive features (NL task creation, checklist generation, conversation/project summaries)

**"What should NOT be built yet?"**
Time tracking, external calendar sync, real-time websocket messaging, Postgres RLS, billing/SaaS plumbing, recurring tasks/automation, any form of Gantt/dependency engine, any autonomous (non-assistive) AI action, and all enterprise-tier features (SSO, data residency, custom SLAs).

**"What must be fixed before we call this production-ready?"**
Object storage (local disk is a data-loss risk at scale-out), automated backups, rate limiting on auth, structured logging + error tracking, a real deployment target and CI pipeline, and a password-reset flow. Postgres RLS should be added before onboarding unrelated paying customers onto shared infrastructure, but is not a blocker for a single-tenant pilot.

**"What should be the next major architectural phase?"**
There isn't a new *architectural* phase needed next — the architecture (extend-don't-duplicate, capability-based RBAC, one authorization predicate per resource type, audit-log-as-activity-feed) has proven itself across four phases and should keep being reused, not re-designed. The next phase is a **product** phase (Daily Work Cycle), built on the existing architecture exactly the way Phase 2C extended `Project` rather than inventing something new.

## RECOMMENDED NEXT STEP

Run a proper architecture-first design pass for **Phase 3 — Daily Work Cycle (Today / Plan / Close)**, following this project's own established process (architecture report → explicit approval → implementation → quality gate → security review → commit). It is the single highest-value, lowest-risk, most positioning-aligned next investment identified in this assessment, requires no new subsystem (no scheduler, no external service, no storage swap), and directly answers the UX gaps found in §10. Do not begin implementation until that architecture report is written and explicitly approved, matching the process used for every phase so far.

---

READY FOR NEXT PHASE PLANNING
