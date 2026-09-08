# Phase 2C Architecture Report — Event / Project Workspace

**Status: design only. No code, schema, migration, or UI has been touched to produce
this report — confirmed by `git status` showing only this new file.**

## 1. Executive Summary

The central finding changes the shape of this whole phase: **a `Project` model already
exists**, from Phase 1's original schema (`docs/architecture/03-database-erd.md`), and is
already minimally wired — one API route (`POST`/`GET /workspaces/:id/projects`), one
dashboard widget ("My Projects" in `ReportingService.getPersonalDashboard`), the
`PROJECT_CREATE`/`PROJECT_MANAGE` permissions already in the catalog and already granted
to `ORG_ADMIN` and to every individual user in their personal workspace, and — critically
— **`Task.projectId` already exists as a nullable foreign key**, exactly matching this
phase's own stated preference ("a task should have one clear contextual workspace or no
workspace").

This is the identical situation Phase 2B found with `TaskAttachment` and `StorageService`:
a correctly-shaped, previously-unused-beyond-a-stub entity from the original architecture
package, waiting to be built out rather than replaced. **Recommendation: extend `Project`,
do not create a new `Event`/`Workspace`-named entity.**

The word "Workspace" is already taken and means something structurally different (the
Personal/Organization tenant container — `docs/architecture/01-product-architecture.md`
§1.3) — reusing it for this concept would be a serious, confusing naming collision. This
report uses **"Project"** throughout, with a purely cosmetic, optional `kind` field
(`PROJECT | EVENT`) for the cases the brief calls "Event."

Every other Phase 2C capability (main conversation, files, membership, dates, progress,
activity) is designed as an **additive widening of the exact same patterns Phase 2A and
2B already established** — generalizing `TaskConversation`/`TaskAttachment` to optionally
hang off a project instead of only a task, reusing `AuditLog`'s already-proven
`taskId`-style nullable column trick, and reusing `canAccessConversation`'s composition
style rather than inventing new authorization primitives. No second conversation system,
no second attachment system, no second assignment system, no second audit system.

One new, genuinely new concept is required: **project membership** (`ProjectMember`,
`ProjectTeam`) — because "who is a legitimate participant in this project" has no existing
equivalent (organization membership and task-assignment are both the wrong granularity).

**Final recommendation: READY FOR IMPLEMENTATION**, with the phased sequence in §23 and
the specific decisions in §21 (Alternatives Considered) confirmed by you first.

## 2. Existing Architecture Relevant to Phase 2C

Inspected directly (source of truth, not assumed): `packages/db/prisma/schema.prisma` in
full; `packages/domain/src/services/{task,conversation,task-attachment,permission,
organization,reporting,audit}.service.ts`; `packages/domain/src/permission-engine/{
resolve-scope,conversation-access,assignment-authorization}.ts`;
`packages/shared/src/permissions/permissions.catalog.ts`;
`apps/web/app/api/v1/workspaces/[workspaceId]/projects/route.ts`; `apps/web/app/(app)/
layout.tsx` and `tasks/[taskId]/page.tsx`; docs 01, 03, 04, 15, 16; and the E2E test
fixtures in `tests/e2e/abc-college.e2e.test.ts`.

Confirmed facts that ground every decision below:

| Fact | Evidence |
|---|---|
| `Workspace` already means the Personal/Organization tenant container, not a project | `schema.prisma` `model Workspace { type: PERSONAL\|ORGANIZATION, ownerUserId?, organizationId? }` |
| `Project` already exists, workspace-scoped, with optional department/team | `schema.prisma` `model Project { workspaceId, departmentId?, teamId?, ownerId, status }` |
| `Task.projectId` already exists, nullable, one project per task | `schema.prisma` `Task.projectId String? @map("project_id")`, `@@index([projectId])` |
| `PROJECT_CREATE`/`PROJECT_MANAGE` already exist and are already granted to `ORG_ADMIN` and to every individual user personally | `permissions.catalog.ts` `SYSTEM_ROLE_TEMPLATES.ORG_ADMIN`, `INDIVIDUAL_USER_PERMISSIONS` |
| Personal projects are already an intended case | same — `INDIVIDUAL_USER_PERMISSIONS` includes both project permissions |
| `TaskConversation` is 1:1 with `Task`, `taskId` required+unique | `schema.prisma`, doc 15 §1.2 |
| `TaskAttachment.taskId` is required (not nullable) today | `schema.prisma` |
| `AuditLog.taskId` (nullable, indexed) was added in Phase 2A specifically so a task's activity is one query over the *existing* audit table, not a parallel table | doc 15 §1.5 |
| `canAccessConversation` is already extracted as a standalone, reusable predicate (not a method locked inside `ConversationService`) specifically to let a second service compose it without duplicating logic | `packages/domain/src/permission-engine/conversation-access.ts`, doc 16 §1.4 |
| Task-level "team assignment ≠ every member gets conversation access" is enforced by exactly one predicate, reused everywhere | doc 15 §1.3, doc 16 §1.4 — a real bug was caught and fixed in Phase 2B by *not* having two versions of this rule |
| Global nav is a flat list of top-level links (Dashboard, Tasks, Teams, Organization, Notifications) | `apps/web/app/(app)/layout.tsx` |
| `ReportingService.getPersonalDashboard`'s "My Projects" currently returns *every* project in the workspace, not ones the user actually participates in | `reporting.service.ts` — a real, pre-existing gap this phase's membership model should close |

## 3. Recommended Domain Model

```
ORGANIZATION (or PERSONAL WORKSPACE)
        │
     PROJECT  (existing model, extended)
        │
        ├── ProjectMember ──── User            (NEW — individual participants)
        ├── ProjectTeam   ──── Team             (NEW — participating teams)
        │
        ├── Conversation (taskId=null, projectId=set)   ← generalized TaskConversation
        │        └── TaskMessage / mentions / reactions / read-state   (UNCHANGED models)
        │
        ├── TaskAttachment (taskId=null, projectId=set) ← generalized TaskAttachment
        │
        ├── ProjectDate    (NEW — important dates / milestones)
        │
        └── Task (existing, projectId now populated)
                 │
                 ├── TaskAssignment            (UNCHANGED — still sole accountability source)
                 ├── Conversation (taskId=set, projectId=null)  ← same generalized model
                 │        └── TaskMessage / ...                (UNCHANGED)
                 └── TaskAttachment (taskId=set, projectId=null) ← same generalized model

AuditLog gains a nullable `projectId` column, exactly like it gained `taskId` in Phase 2A.
Progress is NOT a stored field — always computed from Task.status within the project (§13).
```

Nothing here introduces a second conversation table, a second attachment table, a second
audit table, or a second assignment/acknowledgement concept. `TaskAssignment` is untouched
and remains the only source of task accountability, exactly as §7 of the brief demands.

## 4. Event vs Project Decision

**One model.** "Event" and "Project" describe the same structural need — a container of
people, a main conversation, tasks, files, and dates working toward a goal — differing
only in vocabulary and which sections a user cares about most (an Event leans on
Important Dates; a Project leans on Tasks). Splitting them into two models would mean two
schemas, two services, two API surfaces, and two sets of authorization logic for zero
behavioral difference — precisely the "two independent systems" the brief warns against.

Recommendation: add one nullable, purely-cosmetic field, `Project.kind: PROJECT | EVENT`
(default `PROJECT`). It drives icon/label choice and which Overview sections are
emphasized in the UI; it drives nothing in authorization, task behavior, conversation
behavior, or file behavior. "Annual Day 2026" is a `Project` row with `kind = EVENT`.

## 5. Naming Decision

**Keep the name `Project`.** It already exists in the schema, the permission catalog
(`project.create`, `project.manage`), the API (`/workspaces/:id/projects`), and the
dashboard ("My Projects"). Renaming it now would be a gratuitous breaking change to
working (if minimal) code for no functional gain. The brief's own "Workspace" language for
this concept is explicitly rejected (§2 above) because that word is already load-bearing
for something else in this codebase; using it here would make every future sentence about
"workspace access" ambiguous between "are you in this org" and "are you in this project."

`Event` is not a second model (§4) and not the entity name — it's a value of
`Project.kind`.

## 6. Database Schema Proposal

All changes are additive: new nullable columns on existing tables, new constraints that
only take effect on the new nullable columns, and two entirely new tables. No existing
column becomes more restrictive, no existing table is dropped or renamed.

### 6.1 `Project` (existing — additive columns only)

| New field | Type | Purpose |
|---|---|---|
| `kind` | enum `PROJECT \| EVENT`, default `PROJECT` | Presentation only (§4) |
| `startDate` | `Date?` | Optional project-level start, for Overview/future Calendar |
| `targetDate` | `Date?` | Optional project-level target/end (e.g. "Event Day"), distinct from the many-to-one `ProjectDate` milestones below |

`workspaceId`, `departmentId`, `teamId`, `ownerId`, `status` are unchanged — they already
correctly answer "which tenant, and which department/team gets credit for creating it,"
which is a different question from "who participates" (§6.2).

### 6.2 `ProjectMember` (NEW)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `projectId` | FK → Project, `onDelete: Cascade` | |
| `userId` | FK → User, `onDelete: Cascade` | |
| `addedById` | FK → User | who added them — for activity/audit, mirrors `TeamMember` conventions loosely but deliberately carries no `isHead`-equivalent (§8: this roster is not an authorization or acknowledgement source) |
| `createdAt` | timestamp | |

`@@unique([projectId, userId])`. Purpose: the explicit individual-participant roster for
the People tab and for `canAccessProject` (§9). Authoritative for project-level access,
never for task-level accountability (`TaskAssignment` keeps that role, unconditionally).

### 6.3 `ProjectTeam` (NEW)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `projectId` | FK → Project, `onDelete: Cascade` | |
| `teamId` | FK → Team, `onDelete: Cascade` | |
| `addedById` | FK → User | |
| `createdAt` | timestamp | |

`@@unique([projectId, teamId])`. Purpose: "this team participates in this project."
Membership is **dynamic** (reads live off `TeamMember`, not a snapshot) — same
freshness guarantee every other team-scoped permission grant in this codebase already has
(doc 04 §4.4's scope resolution is always computed live, never cached/snapshotted).
Deliberately does **not** carry an `isHead`-only-can-accept distinction the way task-team
assignment does — see §8 for why that's the correct, not-a-regression call.

### 6.4 `Conversation` (generalized from `TaskConversation` — additive widening)

| Field | Change |
|---|---|
| `taskId` | was `String @unique` (required) → becomes `String? @unique` |
| `projectId` | **new**, `String? @unique` |
| everything else | unchanged (`id`, `organizationId`, `createdAt`, and the `messages`/`reads` relations) |

New raw-SQL migration (mirroring the exact pattern already used for
`workspaces_owner_xor_org_check` in Phase 1 and documented in doc 03 §3.3):
`CHECK ((task_id IS NOT NULL AND project_id IS NULL) OR (task_id IS NULL AND project_id IS NOT NULL))`.

`TaskMessage`, `TaskMessageMention`, `TaskMessageReaction`, `TaskConversationRead` are
**completely unchanged** — they only ever reference `conversationId`, never `taskId`
directly, so this widening is invisible to them. The Prisma model name changes from
`TaskConversation` to `Conversation` (the `@@map("task_conversations")` table name can
either stay as-is or be renamed to `conversations` in the same migration — a purely
cosmetic call to make at implementation time, not an architectural one).

### 6.5 `TaskAttachment` (generalized — additive widening)

| Field | Change |
|---|---|
| `taskId` | was `String` (required) → becomes `String?` |
| `projectId` | **new**, `String?` |
| everything else | unchanged |

New CHECK constraint: `(task_id IS NOT NULL AND project_id IS NULL) OR (task_id IS NULL AND project_id IS NOT NULL)`
— this is exactly the invariant §13 of the brief asks for ("avoid an invalid state where
workspaceId=A, taskId=task belonging to workspace B"): by construction, an attachment
never carries both, so they can never disagree. A message-linked attachment
(`messageId` set) still also carries whichever of `taskId`/`projectId` matches the
context it was uploaded through — set once by the service layer, mirroring how `Task`'s
own origin fields are set once and never overwritten (doc 03 §3.2, enforced by a DB
trigger) — the same trigger pattern should extend to this pair for defense in depth.

### 6.6 `ProjectDate` (NEW)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `projectId` | FK → Project, `onDelete: Cascade` | |
| `title` | text | e.g. "Finalize Decoration" |
| `date` | `Date` | |
| `notes` | text? | |
| `createdById` | FK → User | |
| `createdAt` | timestamp | |

`@@index([projectId, date])`. Deliberately **not** linked to `Task.dueDate` in this
phase — a `ProjectDate` is a project-level milestone, independent of any specific task's
deadline, exactly matching the brief's own example ("Guest Confirmation" isn't
necessarily one task's due date). Kept minimal on purpose (§15 of the brief: "this is
not the full Calendar module") — no recurrence, no reminders, no time-of-day, no
attendee list. The name `ProjectDate` rather than `ProjectMilestone` is chosen because
"milestone" implies task-completion semantics this model doesn't have; it's purely a
labeled date.

### 6.7 `AuditLog` (additive column, third time this exact pattern is used)

`projectId String? @map("project_id")`, FK `onDelete: SetNull` (matching the existing
`taskId` FK's behavior — doc 15 §1.5), `@@index([projectId, createdAt])`. Every
project-related service call passes it alongside `taskId`/`organizationId`, exactly the
same additive, zero-logic-change pattern doc 15 and doc 16 already used twice.

## 7. Task Relationship

**No change needed to `Task` itself** — `Task.projectId` already exists, is already
nullable, and is already one-project-per-task (not a join table). This already satisfies
the brief's own stated preference exactly ("a task should have one clear contextual
workspace or no workspace... avoid multi-project task complexity"). A task with
`projectId = null` behaves in every respect exactly as today. A task with `projectId` set
is otherwise identical — same assignment flow, same conversation/attachment model, same
notification model — the project relationship is purely contextual grouping, never a
second task engine (directly satisfying §7/§20 of the brief).

Existing tasks require **zero migration** — the column already exists and is already
null for all of them.

## 8. Workspace (Project) Membership

Two roster tables (§6.2, §6.3): `ProjectMember` (individuals) and `ProjectTeam` (teams).
Project-level access (§9) is granted to:
- the project's `ownerId`,
- anyone in `ProjectMember`,
- anyone currently in a `Team` that's in `ProjectTeam` (live lookup, not a snapshot —
  matches every other team-scoped grant in this codebase),
- anyone holding `reports.view`/equivalent org-wide oversight (mirrors task access's own
  final fallback clause).

**Why team membership on a Project grants baseline project access, unlike team
assignment on a Task**: these are different in kind, not the same rule applied
inconsistently. A task assigned to a team is a *pending routing step* — the team hasn't
collectively acted yet, only the Head has (or hasn't) acknowledged, which is exactly why
Phase 2A narrows conversation access to the Head alone during that window. Adding a team
to a project's `ProjectTeam` roster is a *declarative membership decision* made once by
someone holding `workspace.manage_teams` — there's no "hasn't accepted yet" ambiguity to
protect against, so narrowing it the same way would be over-cautious, not consistent.

**Critically, this does not weaken task-level narrowing at all** (§10): being a project
participant (individually or via team) grants visibility into the project's shared
surface — its main conversation, its file list, the *titles and statuses* of its tasks,
its dates, its people — but opening any *specific* task's own conversation or files still
requires that task's own, completely unchanged authorization
(`canAccessConversation`/`canViewTask`). A Marketing team member added to "Annual Day"
can see that "Stage Decoration" exists and is in progress; they cannot open its
conversation unless the existing Phase 2A/2B rules already grant them that, exactly as
today. This is the direct, tested answer to the brief's explicit worry about "team access
leakage."

## 9. Authorization Model

New permission keys (added to the existing catalog, no new permission *system*):

| Key | Meaning |
|---|---|
| `workspace_project.manage_members` | add/remove `ProjectMember`/`ProjectTeam` |
| `workspace_project.manage_dates` | create/edit/delete `ProjectDate` |

(Named `workspace_project.*` rather than bare `project.*` only to avoid any future
collision with the existing `project.create`/`project.manage`, which already exist and
already cover creating/editing the `Project` row itself and are reused unchanged for
that.) No `workspace_project.view` is proposed — project *view* access is derived from
membership (§8), not a separately-grantable permission, exactly the same shape
`task.comment` plays for messaging (a capability check layered on top of an access
predicate, never a replacement for it).

```
Organization membership (existing, unchanged)
        │
Project membership  (NEW — ProjectMember / ProjectTeam, §8)
        │
   ┌────┴────────────────┬─────────────────┐
Project conversation   Project files    Project task LIST (titles/status only)
   access = project        access =         visibility = project membership
   membership + task.comment  project membership
        │
   Task access (EXISTING, completely unchanged — TaskService.canViewTask)
        │
   Task conversation access (EXISTING, completely unchanged — canAccessConversation)
        │
   Task attachment access (EXISTING, completely unchanged — assertCanAccessAttachment)
```

Composition rule, stated once so it's unambiguous: **project access is necessary but
never sufficient for task-level access**; task-level access is necessary but never
sufficient for conversation/attachment access at the task level either (that's already
true today, unchanged). Each layer is its own predicate; none of them shortcut past the
layer below.

## 10. Access Composition (worked example, matching the brief's own scenario)

"Annual Day" has `ProjectTeam` = Marketing. Rahul (Marketing) can: see "Annual Day"
exists, read/post in its main conversation, see its shared files, see that "Stage
Decoration" is a task in it with status IN_PROGRESS. Rahul **cannot** open "Stage
Decoration"'s own conversation unless he is its current assignee, its creator, ever
appeared in its assignment chain, or holds `reports.view` over it — the exact same rule
as every task today, completely untouched by any of this. If "Stage Decoration" is
instead assigned to the Marketing *team* and sits pending (not yet distributed to an
individual), Rahul still cannot see that specific task's conversation, even though he can
see the project's — this is the direct, deliberate preservation of the Phase 2A rule the
brief calls out by name.

## 11. Main Conversation Architecture

Reuses Phase 2A's conversation stack with the single generalization in §6.4: `taskId`
becomes optional, `projectId` is added, one CHECK constraint keeps exactly one set.
`TaskMessage`/mentions/reactions/read-state are untouched. `ConversationService` gains
methods that resolve "the conversation for project X" the same way it already resolves
"the conversation for task X," and its authorization composition point becomes: for a
task-scoped conversation, `canAccessConversation` (unchanged); for a project-scoped
conversation, project membership (§8) plus the same `task.comment`-equivalent posting
bar. No `type: WORKSPACE | TASK` enum is used (the brief floated this as one option) —
the nullable-FK-pair-with-CHECK pattern is preferred because it's already the established
idiom in this codebase (`Workspace` itself, and `TaskAttachment`'s `taskId`/`projectId`
pair above), and because it preserves real foreign-key integrity that an enum+generic-id
approach would lose.

## 12. File Architecture

Same generalization approach as conversations (§6.5), reusing `StorageService`,
`attachment-policy.ts` validation, the secure-retrieval route, and soft-delete semantics
completely unchanged. `TaskAttachmentService` gains project-scoped list/upload methods
whose authorization gate is project membership instead of `canAccessConversation` for the
task case — same class, same validation, same storage key builder pattern extended with
a `project_{id}` segment alongside the existing `task_{id}` one.

## 13. Important Dates

`ProjectDate` (§6.6) — a labeled date, nothing more. Explicitly not integrated with
`Task.dueDate`, notifications, or reminders in this phase (all named as future work in
§23/§Deferred). The model is intentionally boring specifically so a future Calendar
module has an easy, unambiguous source to read from without this phase having guessed
wrong about recurrence/reminders/timezones and left migration debt.

## 14. Progress Calculation

**Derived, never stored**, computed on read from `Task.status` for every task where
`projectId` matches:

```
completed = count(status = COMPLETED)
cancelled = count(status = CANCELLED)
active    = count(status NOT IN (COMPLETED, CANCELLED))
total     = completed + active   (cancelled tasks excluded from the denominator —
                                   a cancelled task was never "supposed to" complete,
                                   so counting it against progress would understate
                                   a project that correctly pruned scope)
percent   = total > 0 ? round(completed / total * 100) : 0
```

Subtasks: a subtask (`parentTaskId` set) only counts toward its *own* project if it
independently carries that `projectId` — no automatic parent/child aggregation in this
phase (avoids the brief's own warning against "complicated versioning"-style scope
creep). Unassigned tasks count identically to assigned ones (status is status regardless
of who's on it). This is a simple, explainable, easily-reportable definition — exactly
what an MVP needs, and easy to refine later without a schema change since nothing is
stored.

## 15. Activity/Audit

Reuses `AuditLog` via the additive `projectId` column (§6.7) exactly as `taskId` was
added in Phase 2A. New action strings only (`project.created`, `project.member_added`,
`project.member_removed`, `project.team_added`, `project.team_removed`,
`project_date.created`, `project_date.updated`, `project_date.deleted`), no new table, no
new write path pattern — every one of these is a normal `AuditService.log()` call from
inside the relevant service method, identical in shape to every audit call already in
`task.service.ts`/`assignment.service.ts`/`task-attachment.service.ts`.

## 16. API Contract

Following the exact `withAuth`/Zod/envelope conventions every existing route uses:

| Method | Path | Notes |
|---|---|---|
| POST | `/workspaces/:workspaceId/projects` | already exists — extend body with `kind` |
| GET | `/workspaces/:workspaceId/projects` | already exists, filtered to the caller's projects (fixes the pre-existing over-broad-listing gap noted in §2) |
| GET | `/projects/:id` | new — full detail |
| PATCH | `/projects/:id` | new |
| DELETE | `/projects/:id` | new — likely archive (`status=ARCHIVED`), not hard delete, matching every other "deletion" in this codebase being a soft/status transition |
| GET / POST | `/projects/:id/members` | individuals |
| DELETE | `/projects/:id/members/:userId` | |
| GET / POST | `/projects/:id/teams` | |
| DELETE | `/projects/:id/teams/:teamId` | |
| GET | `/projects/:id/conversation` | mirrors `/tasks/:id/conversation` exactly |
| GET / POST | `/projects/:id/conversation/messages` | |
| POST | `/projects/:id/conversation/read` | |
| GET | `/projects/:id/tasks` | thin filter over the existing task-listing infrastructure — **not** a new task store |
| POST | `/projects/:id/tasks` | delegates straight to the existing `TaskService.createTask` with `projectId` populated |
| GET / POST | `/projects/:id/files` | mirrors `/tasks/:id/attachments` |
| GET / POST | `/projects/:id/dates` | |
| PATCH / DELETE | `/project-dates/:id` | flat, matching the existing `/messages/:id` / `/checklist-items/:id` convention of item-level routes resolving their own parent server-side |
| GET | `/projects/:id/activity` | mirrors `/tasks/:id/activity` |
| GET | `/projects/:id/progress` | §14's derived calculation |

Retrieval/mutation of an individual file continues to use the existing, unchanged
`GET`/`DELETE /attachments/:id` — no new attachment-retrieval endpoint needed at all.

## 17. UI / Screen Map

New top-level nav entry alongside the existing flat list (Dashboard, Tasks, Teams,
Organization, Notifications): **Projects**. Project detail reuses the exact tab pattern
`tasks/[taskId]/page.tsx` already established:

```
Project
├── Overview   (summary, progress, upcoming dates, active tasks, recent activity/files — §17 of the brief)
├── Conversation
├── Tasks      (filtered view over the existing task list infra, per §21 of the brief)
├── Files
├── People     (members + teams, read from ProjectMember/ProjectTeam + existing User/Team records — no duplication)
├── Dates
└── Activity
```

This is a contextual layer alongside the existing global areas, not a replacement for
them — a task inside a project still shows up in its assignee's ordinary "My Tasks," a
project's conversation is additional to (not instead of) each task's own conversation.

## 18. Migration Plan

Every migration is additive:
1. `Project.kind/startDate/targetDate` — new nullable/defaulted columns.
2. `ProjectMember`, `ProjectTeam`, `ProjectDate` — new tables.
3. `Conversation.taskId` nullable + `projectId` + CHECK — one migration, mirroring the
   exact structure of Phase 1's `workspaces_owner_xor_org_check` migration.
4. `TaskAttachment.taskId` nullable + `projectId` + CHECK — same pattern.
5. `AuditLog.projectId` — nullable column + index, identical to the existing `taskId` one.

No existing row changes meaning. Every existing `Task`, `TaskConversation` row (with
`taskId` set, `projectId` implicitly null), and `TaskAttachment` row is already valid
under the new, widened constraints without any backfill — unlike Phase 2A's conversation
backfill (which had to retroactively create rows), this phase has nothing to backfill
because nothing new is *required* to exist for old data to remain valid.

## 19. Test Plan

All 25 scenarios listed in the brief's §30 are in scope, plus (grounded in what Phase 2B's
audit actually caught): an explicit test that adding a team to a project does **not**
grant its members access to a task's conversation that the existing rules would deny —
i.e., re-running the exact "team-pending task ≠ Files public to the team" scenario from
doc 16, but this time with the team added at the *project* level, to prove the two layers
don't bleed into each other. Every existing Phase 1/2A/2B E2E test must be rerun unmodified
and green before this phase is considered complete, exactly as done at the end of Phase 2A
and 2B.

## 20. Security Analysis

- **IDOR**: every project/date/member mutation resolves its parent server-side from the
  authenticated session, never trusts a client-supplied project/org id, identical
  discipline to Phase 2B.
- **Tenant isolation**: `Project.workspaceId` already ties every project to exactly one
  tenant (personal or org); membership tables inherit that boundary transitively (a
  `ProjectMember` row can't reference a user outside the project's own org without a
  service-layer check, mirrored on `ProjectTeam`/team).
- **Unauthorized project access**: gated by §8's membership predicate, tested directly.
- **Task access escalation**: explicitly prevented by design (§9/§10) — project
  membership is proven insufficient on its own for task-level access.
- **Conversation/file access escalation**: same — the generalized `Conversation`/
  `TaskAttachment` models still gate every read through the same predicates, now with an
  additional project-membership branch that is *additive*, never a bypass of the
  existing task branch.
- **Team access leakage**: directly addressed in §8's worked reasoning — team-level
  project participation is intentionally coarser than team-level task assignment, and the
  reasoning for why that's *correct* rather than *inconsistent* is written down, not
  assumed.
- **Membership removal**: removing a `ProjectMember`/`ProjectTeam` row takes effect
  immediately (live lookups, no caching) — same guarantee every other permission grant in
  this codebase already has.
- **Deleted-member access**: a removed member immediately loses project-level access on
  the next request; any task-level access they separately hold (e.g. they're still the
  current assignee of a specific task) is untouched, because task access has never been
  derived from project membership in the first place — it was never a channel for
  project-level removal to need to "reach into."

## 21. Alternatives Considered

- **`Workspace.type` gains `EVENT`/`PROJECT` variants, reusing the existing `Workspace`
  model directly** — rejected: `Workspace` is the tenant-boundary concept (exactly one
  per user, one per org); a user needs *many* projects inside one org workspace, so the
  cardinality is already wrong, on top of the naming collision in §2.
- **`Conversation` generalized via a `type: WORKSPACE | TASK` enum plus a single
  polymorphic `contextId`** (the brief's own suggested phrasing) — rejected in favor of
  the nullable-FK-pair-plus-CHECK approach: the enum+generic-id version can't be enforced
  by a real foreign key (the DB can't verify `contextId` actually points at a live
  task/project row), while the codebase already has two working precedents (`Workspace`
  itself, and this same pattern proposed for `TaskAttachment`) for the FK-pair approach
  that keeps full referential integrity.
- **Separate `ProjectConversation`/`ProjectMessage`/... model family, fully independent
  of `TaskMessage`** — rejected: five duplicated models plus a near-identical twin of
  `ConversationService`, exactly the "second system" every phase so far has explicitly
  avoided, for zero behavioral benefit over widening the existing model.
- **Team-level project participation narrowed the same way task-team-assignment is
  narrowed** (only a "Project Head" gets access until they distribute it) — rejected:
  there is no pending-acknowledgement step being modeled here (§8's reasoning); forcing
  that pattern in would be copying a rule to a situation it wasn't designed for, not
  genuinely preserving consistency.
- **`progressPercentage` as a stored, manually-updated field on `Project`** — rejected
  per the brief's own steer; a derived calculation has no drift risk and needs no write
  path, audit entry, or "who updated progress" question at all.

## 22. Architectural Risks

| Risk | Class | Mitigation |
|---|---|---|
| Widening `Conversation.taskId`/`TaskAttachment.taskId` to nullable requires updating every call site that currently assumes non-null (`ConversationService`, `TaskAttachmentService`, both route layers) | MEDIUM | Fully cataloged in §23's sequencing; each touched call site already has E2E coverage that must stay green |
| `ProjectTeam`'s "live lookup" membership means a large project with many teams could mean a moderately expensive per-request access check | LOW | Matches the existing cost profile of `PermissionService.getUserOrgTeams`; not a new class of cost, revisit only if it's ever actually measured as slow |
| Two new permission keys risk drifting from the `project.*` ones already in the catalog if named carelessly | LOW | Deliberately namespaced `workspace_project.*` in §9 to avoid collision; confirm naming before implementation |
| "My Projects" dashboard fix (§16) changes existing behavior (narrows an over-broad list) | LOW | Arguably a bug fix, not a regression, but call it out explicitly since it's an existing, shipped code path — confirm before implementing |

No BLOCKER or HIGH risk identified.

## 23. Recommended Implementation Sequence

1. Schema: `Project` additive columns, `ProjectMember`, `ProjectTeam`, `ProjectDate`,
   `AuditLog.projectId` — no behavior change yet, existing tests must stay green.
2. Schema: widen `Conversation`/`TaskAttachment` (nullable `taskId` + `projectId` + CHECK)
   — still no new behavior; update the small number of existing call sites that
   constructed these rows assuming `taskId` required, verified by the full existing
   E2E suite staying green with zero new tests yet.
3. Domain: `ProjectMembershipService` (or fold into `OrganizationService` — decide at
   implementation time) for `ProjectMember`/`ProjectTeam` CRUD + the project-access
   predicate.
4. Domain: extend `ConversationService`/`TaskAttachmentService` with project-scoped
   entry points, reusing their existing internals.
5. Domain: `ProjectService` for CRUD + the derived progress calculation (§14).
6. API: routes per §16, thinnest possible handlers delegating to the above.
7. UI: Projects nav entry, project detail tabs (§17), task-creation project picker.
8. Tests: the full §19/brief-§30 matrix, plus the explicit project-team-doesn't-leak-to-
   task-conversation regression test.
9. Full quality gate + dedicated security/architecture audit, matching the process
   already used for Phase 2A and 2B, before any commit.

## 24. Final Recommendation

**READY FOR IMPLEMENTATION**, contingent on your confirmation of the specific calls made
in §21 (particularly: keeping the name `Project`/rejecting `Workspace` reuse, the
nullable-FK-pair generalization over an enum+polymorphic-id, and the team-membership
access-composition reasoning in §8) and the permission-naming choice in §9.
