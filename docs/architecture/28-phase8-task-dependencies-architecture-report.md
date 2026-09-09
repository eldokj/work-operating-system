# Phase 8 Task Dependencies / Blocked Work Visibility Architecture

**Base commit:** `94f9d75614d04547c5cc0151052915a8efe197fd` (branch `master`, `origin/master` synchronized). **Status:** architecture only — no code, schema, migration, API, UI, config, dependency, or test change exists yet for anything in this document. Follows the same process as docs 17/19/21/24/26: investigation → proposal → explicit approval required before any implementation. Builds directly on [doc 27](27-phase8-product-capability-and-roadmap-assessment.md)'s conclusion (Task Dependencies = highest-priority next capability, 7.17/10) and resolves its one open question (§10 below).

**Product framing, restated:** doc 27 found this is "an almost free next capability" — the schema has sat ready, unused, since Phase 1. The goal is not to build a project-management dependency graph feature; it's to answer one question the product currently cannot: *why can't this task start yet.*

---

## 1. Fresh Codebase Inspection

Verified this session, not assumed from doc 27.

| Area | Status | Evidence |
|---|---|---|
| `TaskDependency` model | **Schema-complete, zero usage** | `schema.prisma:765-776` — `id`, `taskId`, `dependsOnTaskId`, `type: DependencyType`, cascade-delete both FKs, `@@unique([taskId, dependsOnTaskId])` |
| `Task.dependencies` / `Task.dependedOnBy` relations | **Already declared** | `schema.prisma` Task model — `dependencies: TaskDependency[] @relation("DependentTask")` (what this task depends on), `dependedOnBy: TaskDependency[] @relation("DependsOnTask")` (what depends on this task) |
| Index coverage | **Incomplete** | Only the compound unique exists; no standalone index on `dependsOnTaskId` for the reverse ("what does this block") lookup |
| Service/API/UI/reporting | **None** | Confirmed again this session — zero references anywhere outside `schema.prisma` |
| `task-status.machine.ts` | **No "blocked" state** | Full transition table read fresh — 9 states, 11 events, no dependency awareness of any kind |
| Task sub-resource authorization precedent | **`assertCanEdit`** | `task.service.ts:361-373` — creator, current assignee, or current assignor may edit; personal workspace requires ownership. Used unchanged by `addChecklistItem`/`updateChecklistItem`/`updateTask` — the exact precedent this phase reuses (§4) |
| Cyclic-data-guard precedent | **`PermissionService.getDepartmentPath`** | `permission.service.ts:36-52` — `MAX_DEPARTMENT_DEPTH = 25` bounds a self-referential walk against bad/cyclic data. Directly reused for cycle detection (§5) |
| Reporting's stuck-acknowledgement pattern | **Confirmed, directly reusable** | `reporting.service.ts` — `isStuckAcknowledgement` is a pure function applied over an already-batch-fetched task array (`teamTasks.filter(...)`), never a per-task query. The template for `isBlocked` (§7) |
| Permission catalog | **34 keys, no new one needed** | Every existing task sub-resource (checklist, comments, updates) is gated by task-level authorization alone, never a dedicated RBAC permission — Dependencies follows the same rule (§4) |

---

## 2. What a Dependency Row Means

A `TaskDependency` row with `taskId = A`, `dependsOnTaskId = B`, `type = BLOCKS` means: **A is blocked by B** — A cannot reasonably proceed until B resolves. `Task.dependencies` on task A returns this row (what A depends on); `Task.dependedOnBy` on task B returns the same row (what depends on B). Both directions are needed in the UI: viewing A shows "blocked by B"; viewing B shows "blocks A."

`type = RELATES_TO` is a plain informational cross-reference — **no product behavior** attaches to it (§9's explicit non-goal, per doc 27 §15). Only `BLOCKS` feeds `isBlocked` (§7), planning awareness (§8), and reporting (§9).

---

## 3. Data Model — One Additive Index, Nothing Else

**No new table, no new columns, no new enum.** The only schema change this phase proposes:

```
@@index([dependsOnTaskId])   // on TaskDependency
```

Reasoning: every "what blocks task X" read (X = `taskId`) is already served by the existing compound-unique-as-index on `(taskId, dependsOnTaskId)`. Every "what does task Y block" read (Y = `dependsOnTaskId`) has no supporting index today — a full scan of `task_dependencies` for every reverse lookup. At current scale this isn't a live performance problem (doc 21's own "human-scale, not a hot path" reasoning applies identically — a task's dependency count is small), but the index costs nothing to add now and removes doubt, matching the same "add it now while touching this area, not because it's urgent" discipline doc 24 applied to `Task.dueDate`.

**Explicitly not added:** a `status`/`resolved` column on `TaskDependency` itself — whether a dependency is "resolved" is entirely derived from `dependsOnTask.status` at read time (§7), never stored redundantly. Storing a second source of truth for something one join already answers correctly would violate the same principle doc 21 §11 established for reporting ("never a second source of truth") and doc 26 §17 reapplied for Calendar.

---

## 4. Authorization

**No new permission key.** Every existing task sub-resource (checklist items, comments, progress updates) is gated purely by task-level authorization — `getTaskByIdOrThrow` (view) + `assertCanEdit` (creator/current-assignee/current-assignor, or personal-workspace ownership) — never a dedicated RBAC grant. Dependencies follow the identical rule:

- **Creating a dependency** (`A depends on B`): the actor must be able to **view** both A and B (`canViewTask` on each, re-derived, never assumed from "same workspace" alone) and **edit** A specifically (`assertCanEdit(actor, A)`) — they're the one declaring that A is blocked, not modifying B. This mirrors exactly how adding a checklist item to A only requires edit rights on A.
- **Removing a dependency**: same rule — edit rights on the task the dependency is declared *from* (A).
- **Same-workspace restriction (new, this phase's own rule):** a dependency may only be created between two tasks in the **same workspace**. This is a deliberate product/security simplification, not an arbitrary limitation — a personal-workspace task depending on an unrelated organization task (or vice versa) has no coherent meaning in this product's model, and restricting to one workspace substantially narrows the cross-authorization surface this feature has to get right (§4's next point still applies within that narrower surface, but "narrower" is exactly the point).

**The load-bearing rule, directly extending Phase 6's "a notification is a disclosure" principle and Phase 7's identical rule for calendar visibility — now a third application of the same discipline:** *a dependency reference is itself a disclosure.* Task B's title/status must never be exposed to a viewer of task A who cannot independently see task B (§1's authorization gap this design must not introduce). Concretely:

- **`GET /api/v1/tasks/:taskId/dependencies`** (§6) — the endpoint that returns full detail (title, status, priority) for every task A depends on / is depended on by — re-derives `canViewTask` for **every individual related task**, never trusting the same-workspace restriction alone as sufficient (same-workspace narrows the risk, it does not eliminate it — task-level visibility inside one organization workspace still varies per task, exactly as it already does for Search/Calendar). A related task the viewer cannot see is either omitted entirely or returned as a minimal `{ id, visible: false }` placeholder (an implementation-time UX choice, not an authorization-relevant one — either way, no title/status/priority leaks).
- **The coarse `isBlocked` boolean** surfaced on `DailyPlanItem`/task-list reads (§7/§8) is safe to show unconditionally — it reveals only "this has an unresolved blocker," never which task, mirroring exactly the free/busy pattern doc 26 §13 designed for calendar visibility (a coarse signal, safe to show broadly; full detail, re-authorized per relation).

---

## 5. Cycle Detection

Before creating `A depends on B`, walk B's own dependency chain (`B.dependencies` → their `dependsOnTask.dependencies` → ...) looking for A. If found, reject the write — it would make A transitively depend on itself.

Reuses the exact defensive pattern `PermissionService.getDepartmentPath` already established for a structurally identical problem (a self-referential chain that must never be trusted to terminate cleanly on bad data): an explicit `MAX_DEPENDENCY_DEPTH` bound (25, matching `MAX_DEPARTMENT_DEPTH`'s own value — no evidence suggests a different bound is needed for this graph), a `visited` set to avoid redundant re-walking, and a plain iterative/recursive walk — not a recursive SQL CTE, matching this project's consistent preference for application-level graph walks over database-specific recursive query features (the same choice already made for carry-forward chains, doc 19 §19, and department paths).

This is the one genuinely algorithmic piece of this phase (doc 27 §9's own assessment, reconfirmed) — small, bounded, well-precedented, not novel to this codebase.

---

## 6. API Surface (Design Only)

Following the existing nested-resource convention exactly (`/tasks/:taskId/checklist-items`, `/tasks/:taskId/comments`):

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/v1/tasks/:taskId/dependencies` | Both directions — what this task depends on, and what depends on it — each related task re-authorized (§4) |
| `POST` | `/api/v1/tasks/:taskId/dependencies` | Create (`{ dependsOnTaskId, type? }`, default `BLOCKS`) — same-workspace check, cycle check (§5), edit-rights check (§4) |
| `DELETE` | `/api/v1/tasks/:taskId/dependencies/:dependencyId` | Remove — edit-rights check on the owning task |

**Explicitly not built:** a bulk/graph-visualization endpoint, a dependency-aware task-list filter endpoint (the filtering this phase needs is small enough to live inside existing reads — §7/§8), any endpoint returning the full organization-wide dependency graph at once (unbounded, no product need identified).

Dependency detail is **not** added to `GET /api/v1/tasks/:taskId`'s existing `TASK_DETAIL_INCLUDE` response — deliberately kept as its own endpoint (§4's per-related-task re-authorization doesn't fit cleanly into a raw Prisma `include`, which has no per-row authorization hook; a dedicated service method mirrors exactly how `AuditService.listForTask` is already a separate read from the main task fetch, not baked into it).

---

## 7. `isBlocked` — the Coarse Signal

```ts
// Pure function, mirrors isStuckAcknowledgement's exact shape (reporting.service.ts) —
// unit-testable without a database, applied over an already-batch-fetched task array.
function isBlocked(task: { dependencies: { type: DependencyType; dependsOnTask: { status: TaskStatus } }[] }): boolean {
  return task.dependencies.some(
    (d) => d.type === "BLOCKS" && d.dependsOnTask.status !== "COMPLETED" && d.dependsOnTask.status !== "CANCELLED"
  );
}
```

A task is "blocked" if it has at least one `BLOCKS` dependency whose target hasn't reached a terminal state. `RELATES_TO` never contributes (§2/§9's explicit non-goal). This mirrors `isOverdue`'s own terminal-status exclusion (`task-status.machine.ts`) and `isStuckAcknowledgement`'s pure-predicate-over-batch-data shape exactly — no new pattern introduced.

**Computed at read time, never stored** — the same "no second source of truth" discipline as §3. A batched query (`include: { dependencies: { include: { dependsOnTask: { select: { status: true } } } } }`) over whatever task set is already being fetched (a day's plan, a team's task list) costs one extra join, never a per-task round-trip.

---

## 8. Daily Work Cycle Integration — Resolving Doc 27's Open Question

**Doc 27 §11 left one question open: should a blocked task's daily-plan inclusion be a hard exclusion or a soft warning? Resolved here: soft warning — advisory only, never a hard block.**

This is not a default or a punt; it is the same design principle this project has applied consistently at every prior decision point of this exact shape:
- Calendar conflicts are shown, never blocking (doc 26 §9 — "real calendars allow double-booking on purpose all the time").
- `workingHours` is advisory input to capacity, never an enforcement boundary (doc 19 §16/§22, unchanged through every subsequent phase).
- Capacity itself has never once been a hard cap on planning.

A blocked task belongs in the same category: a user may have good reason to plan or even start a task whose formal blocker hasn't resolved (prep work, a blocker they know is about to close, a `BLOCKS` relationship that's simply stale). Hard-rejecting the plan/start action would be the first genuinely enforcement-shaped rule in a Daily Work Cycle that has never had one, and doc 27 itself frames this as a UX choice, not a forced consequence of the data existing — the consistent, precedented answer is advisory.

**Concretely:**
- `DailyWorkService.listItems`'s per-item DTO (`toItemDTO`) gains one new boolean field, `isBlocked`, computed via §7's function over a batched dependency-include added to that method's existing task query.
- `DailyWorkService.addItem` performs **no new check** — a blocked task can be planned exactly as freely as any other task. The `isBlocked` flag is purely informational once it appears in `listItems`'s response.
- The Today page's `ItemTaskLine`/Plan-tab rendering gains one more conditional badge, following the exact existing pattern (`{item.isUnplanned && <span className="badge...">}`, `{item.ownershipLost && <span className="badge...">}`) — `{item.isBlocked && <span className="badge bg-red-50 text-red-600">Blocked</span>}`. No new component, no new interaction model.
- `task-status.machine.ts` is **not touched** — `ASSIGN`/`SUBMIT`/any transition remains exactly as permissive as it is today. This is the single most important scope-control decision in this document: dependencies are a visibility layer over the existing lifecycle, never a modification to it.

---

## 9. Reporting Integration

One extension to `ReportingService`, matching doc 21's own established shape exactly:

- A new pure function, `isBlocked` (§7, same implementation reused — no duplicate definition), applied over the already-fetched `teamTasks`/`deptTasks`/`allTasks` arrays `getTeamDashboard`/`getOrganizationDashboard` already load (the same arrays `isStuckAcknowledgement` is already applied over) — requires those existing queries' `include` to add `dependencies: { include: { dependsOnTask: { select: { status: true } } } }`, one more join, not a new query.
- A new `blockedCount` field alongside the existing `stuckAcknowledgementCount` in `AttentionRequiredSummary` (`summarizeAttention`) — **additive, not a replacement.** Doc 27 §9 was explicit that Phase 4's stuck-acknowledgement signal and this phase's blocked-work signal answer genuinely different questions ("nobody's responded yet" vs. "something else has to finish first") and both remain valuable side by side.
- **Explicitly deferred** (doc 27 §15): a dedicated "blocked work" drill-down list (which tasks, blocked by what) — the count is in scope; a full list view is a reasonable SHOULD-HAVE fast-follow, not required to prove the core value.

---

## 10. UI (Design Only)

- **Task detail page:** a new small section ("Blocked by: …" / "Blocks: …"), fetched via `GET /api/v1/tasks/:taskId/dependencies`, rendered only when non-empty. An "Add dependency" affordance — a plain task picker scoped to the same workspace (reusing whatever existing task-search/select pattern the app already has, e.g., the same lookup `QuickTaskBar` or task-linking flows already use — not a new component family).
- **Today page (Plan tab):** the one-badge addition described in §8 — no new section, no new tab.
- **Reporting/dashboard:** the existing "Attention Required" section (doc 21 §12) gains one more count alongside stuck-acknowledgement, same visual treatment, same drill-down-later precedent.
- **Explicitly not built:** any graph/network visualization, any Gantt-style dependency chart, any drag-to-link interaction — a plain list is sufficient for the stated goal (doc 27 §15's own explicit exclusion, reconfirmed here).

---

## 11. Audit

Mirrors the checklist-item precedent exactly (`task.checklist_item_added`, `task.service.ts:445-453`):

- `task.dependency_added` — `entityType: "TaskDependency"`, `entityId` = the new row's id, `taskId` = the dependent task (A), `after: { dependsOnTaskId, type }`.
- `task.dependency_removed` — same shape, `before` instead of `after`.

No new `AuditLog` column needed — `taskId` (the existing, four-times-reused additive column) is sufficient; a dependency's own activity already belongs to task A's existing activity feed (`AuditService.listForTask`), exactly like a checklist-item addition already does.

---

## 12. Testing Strategy (Design Only)

- **Domain unit tests:** `isBlocked` as a pure-function test (mirrors `isStuckAcknowledgement`'s own test style exactly — fixture data, no database); cycle-detection as a pure-function test over a small synthetic dependency graph (mirrors `resolve-scope.test.ts`'s DB-free style).
- **Domain integration tests (real Postgres, mirroring `calendar.service.test.ts`'s established pattern):** create/remove a dependency; same-workspace rejection; cross-workspace rejection; cycle rejection (A→B→C→A); authorization — creator/assignee/assignor can create, an unrelated org member cannot; a related task the viewer can't see is never exposed with full detail via the dependencies endpoint (the single most important test in this phase, directly proving §4's disclosure rule — same weight doc 26's "REPORTS_VIEW must never imply calendar visibility" test carried for Phase 7).
- **E2E scenarios:** blocked-task badge appears on the Today Plan tab; a blocked task can still be planned/started (proving §8's advisory-only decision is actually true in the running system, not just documented); reporting's `blockedCount` reflects reality; tenant/cross-workspace isolation; regression — the full existing 137-scenario suite reruns unmodified and green.

---

## 13. Phase 8 Implementation Boundary

Restates doc 27 §15, unchanged by this design pass — no scope drift found during architecture:

**IN SCOPE:** `TaskDependencyService` (or equivalent) with create/remove + cycle detection; the 3 API routes (§6); task-detail UI section; `isBlocked` in `DailyWorkService.listItems` + one Plan-tab badge; `ReportingService.blockedCount`; audit logging; the one `@@index([dependsOnTaskId])` migration.

**OUT OF SCOPE:** Recurring Work (Phase 9, doc 27 §14); AI, Voice, Time Tracking, Calendar expansion, RLS, production hardening, billing (all deferred, doc 27 §12/§13); any `task-status.machine.ts` change; any hard block on planning/starting/assigning a blocked task; `RELATES_TO` behavior beyond plain display; graph visualization; a blocked-work drill-down list (SHOULD-HAVE, not required).

**DEFERRED (named, not forgotten):** dependency-aware deadline suggestions ("A's deadline should account for B blocking it") — real future value, needs this phase to exist and stabilize first, explicitly the reason doc 27 §10 sequenced Dependencies before Recurring Work; team/department "what's blocking my team" rollup beyond the single count.

---

## 14. Recommended Implementation Sequence

1. **Schema** — the one additive index; hand-written migration per this project's established pattern.
2. **`TaskDependencyService`** — create/remove with §4's authorization + §5's cycle detection, mirroring `AssignmentService`'s "highest-blast-radius code re-derives authorization from first principles" discipline (doc 06's own stated standard) given this is also a cross-task, disclosure-sensitive write path.
3. **API routes** (§6) — thin wrappers, identical convention to every existing nested task-resource route.
4. **`isBlocked`** — pure function first (unit-tested in isolation), then wired into `DailyWorkService.listItems`'s existing query + DTO.
5. **Reporting extension** — `blockedCount` alongside `stuckAcknowledgementCount`, reusing the same batched-query pattern.
6. **UI** — task-detail dependency section, Today Plan-tab badge, reporting count.
7. **Audit** — wire both mutations through `AuditService`, matching §11.
8. **Tests** — the full matrix from §12, with the disclosure test and the "blocked task can still be planned" test treated as launch-blocking, not optional.
9. **Security review** — a dedicated self-review pass against §4, matching every prior phase's pre-commit discipline.
10. **Production build, full test suite, final diff audit, commit, push** — only following this project's established, unchanged process (approval gates at each step, never automatic).

---

## 15. Final Architecture Decision

1. **Recommended data model:** zero new tables/columns — the existing `TaskDependency` model, activated, plus one additive index (`@@index([dependsOnTaskId])`).
2. **Recommended API surface:** 3 routes under `/api/v1/tasks/:taskId/dependencies`, following the existing nested-resource convention exactly.
3. **Authorization model:** no new permission key — reuses `canViewTask` (both related tasks, re-derived per relation, never assumed) + `assertCanEdit` (the dependent task only) — the same task-level authorization every other task sub-resource already uses. Same-workspace restriction on creation. Full detail always re-authorized per related task (§4's central, load-bearing rule — the third application of this codebase's now-consistent disclosure principle).
4. **Cycle detection:** a bounded graph walk reusing `PermissionService.getDepartmentPath`'s exact defensive pattern (visited set, max-depth guard) — the one genuinely algorithmic piece of this phase.
5. **Daily Work Cycle integration:** advisory only — resolves doc 27's open question explicitly. A blocked task is visibly flagged, never blocked from being planned or started. `task-status.machine.ts` is untouched.
6. **Reporting integration:** one additive `blockedCount` alongside the existing `stuckAcknowledgementCount`, same batched-query discipline, no new query shape.
7. **UI:** a task-detail dependency section, one Plan-tab badge, one reporting count — no graph visualization, no new page.
8. **Audit:** two new actions (`task.dependency_added`/`.removed`), reusing the existing `taskId`-indexed activity feed unchanged.
9. **Phase 8 MVP:** §13's IN SCOPE list.
10. **Explicit Phase 8 non-goals:** §13's OUT OF SCOPE list.
11. **Dependencies:** none blocking — every reused piece (`canViewTask`, `assertCanEdit`, the batched-reporting-query pattern, the cyclic-walk defensive pattern) already exists and is already proven.
12. **Risks:** cycle detection is genuine algorithmic work needing correctness on the first pass (§5); the disclosure rule (§4) must be treated as launch-blocking, not a nice-to-have, exactly as Phase 7's equivalent rule was.
13. **Testing strategy:** §12, with the disclosure test and the advisory-not-enforcement regression test as the two most important additions to the suite.
14. **Recommended sequence:** §14.

This is an architecture design only. Implementation should not begin until this report is explicitly approved, matching the process used for every phase so far.

READY FOR IMPLEMENTATION
