# 04 — RBAC + Permission Model

## 4.1 Design principle

Permissions are **capabilities** (`resource.action` strings), never hardcoded role checks.
No code should ever say `if (user.role === 'TEAM_HEAD')`. Code says
`if (await can(user, 'task.assign', { teamId }))`. Roles are just named bundles of
permissions, and every bundle is editable per-organization — the seeded roles below are
defaults, not constraints.

## 4.2 Permission catalog (seed data in `permissions`)

| Key | Meaning |
|---|---|
| `organization.create` | Create a new organization (typically self-serve signup) |
| `organization.manage` | Edit org settings, branding, feature flags |
| `department.create` / `department.manage` | CRUD departments |
| `team.create` / `team.manage` | CRUD teams |
| `team.assign_head` | Designate/remove a Team Head |
| `team.manage_members` | Add/remove team members |
| `role.manage` | Create custom roles, edit role-permission grants |
| `workspace.create` | Create a project workspace (org workspaces auto-created with org; personal always exists) |
| `project.create` / `project.manage` | CRUD projects |
| `task.create` | Create a task (personal or org, per Rule 1 — **broadly granted by default**) |
| `task.assign` | Assign a task within one's own team/scope |
| `task.assign_cross_team` | Assign a task to a team/user outside the assignor's own team |
| `task.assign_cross_department` | Assign across department boundaries |
| `task.assign_org_wide` | Create an assignment sourced from the organization/management level (no team of origin) |
| `task.accept` / `task.decline` | Respond to an assignment addressed to the user |
| `task.accept_on_behalf_of_team` | Respond to an assignment addressed to a team (Team Head capability) |
| `task.reassign_internal` | After accepting on behalf of a team, distribute internally |
| `task.update_progress` | Post progress updates |
| `task.comment` | Comment on a task |
| `task.review` | Approve / request changes on a submission |
| `task.complete` | Force-complete / close a task |
| `task.cancel` | Cancel a task |
| `reports.view` | View team/department/org dashboards & analytics |
| `audit.view` | View audit log entries |
| `ai.use` | Use any AI feature |
| `ai.configure` | Toggle/configure AI features for an org |

This list is stored as data (`permissions` table) so new keys can be added without a
schema migration to the RBAC engine itself — only a seed/data change.

## 4.3 Seeded role templates (`roles.is_system = true`)

These are starting points assignable at signup; every org can clone, edit, or ignore them
via `role.manage`.

| Role | Typical permission bundle |
|---|---|
| `SUPER_ADMIN` | All permissions, all scopes (platform operator, not a normal org role) |
| `ORG_ADMIN` | `organization.manage`, `department.*`, `team.*`, `role.manage`, `task.*` incl. `assign_org_wide`, `reports.view`, `audit.view`, `ai.configure` |
| `DEPARTMENT_HEAD` | `department.manage` (own dept), `team.create/manage` (own dept), `task.*` incl. `assign_cross_team` within dept, `reports.view` (own dept) |
| `TEAM_HEAD` | `team.manage_members` (own team), `task.create`, `task.assign` (own team), `task.accept_on_behalf_of_team`, `task.reassign_internal`, `task.review`, `reports.view` (own team) |
| `MANAGER` | Like TEAM_HEAD but without `team.manage_members`; used for a delegated task coordinator who isn't the formal head |
| `MEMBER` | `task.create`, `task.accept`, `task.decline`, `task.update_progress`, `task.comment` |
| `INDIVIDUAL_USER` | Personal-workspace equivalent of MEMBER; no org scope |

Per Rule 1/2/9: task creation and assignment permissions are granted broadly by default
(even `MEMBER` can create tasks and assign within permissions they hold), and it is
`task.assign_cross_team` / `_cross_department` / `_org_wide` that gate the higher-blast-
radius moves — not task creation itself.

## 4.4 Scope resolution

A grant in `user_roles` has a `scope_type` (`ORGANIZATION | DEPARTMENT | TEAM`) and
`scope_id`. Resolving "what can user U do regarding resource R" (e.g. a task owned by
Team T under Department D under Organization O):

```
1. Collect all user_roles rows for U within organization O.
2. For each, resolve the permission set (role_permissions).
3. A grant applies to R if:
     scope_type = ORGANIZATION                      → always applies (org-wide)
     scope_type = DEPARTMENT AND scope_id = D        → applies
     scope_type = DEPARTMENT AND D is descendant of scope_id (nested depts) → applies
     scope_type = TEAM AND scope_id = T              → applies
4. Union all applicable permissions → the effective permission set for (U, R).
5. permission-in-set? → allow; else → deny.
```

This is implemented once in `PermissionService.can(user, permissionKey, resourceContext)`
and used identically by API middleware, service-layer guards, and (as a second, defense-
in-depth layer) Postgres RLS predicates — never re-implemented ad hoc per endpoint.

## 4.5 Assignment-specific authorization (the sensitive path)

Because assignment is the highest-blast-radius action (it can cross team/department
lines), `AssignmentService.assign()` runs a dedicated check beyond a flat permission
lookup:

```
canAssign(actor, task, target) =
  target is within actor's own team/department
     → requires `task.assign`
  target is a different team, same department
     → requires `task.assign_cross_team`
  target is a different department
     → requires `task.assign_cross_department`
  actor is acting at the organization/management level (no team of origin, e.g. an
  ORG_ADMIN dispatching to any team)
     → requires `task.assign_org_wide`
```

`target` resolution also matters: assigning *to a team* only requires the actor to be
authorized to reach that team — it does **not** require, and must never silently trigger,
acceptance by every member (Rule 5). Only the Team Head acknowledgement path
(`task.accept_on_behalf_of_team`) governs that.

## 4.6 Multiple roles / contextual identity (§9 example)

Because `user_roles` rows are scoped per (org, scope_type, scope_id), a single user row
can simultaneously be:
- `TEAM_HEAD` scoped to Team=Marketing
- `MEMBER` scoped to Team=Admissions
- (implicitly) `INDIVIDUAL_USER` in their personal workspace, which has no org scope at all

No "current role" flag is stored on the user — the applicable role is always computed
per-resource at authorization time, which is what makes this correct rather than a hack.

## 4.7 AI guardrails as permission-gated actions

AI actions are not exempt from this model: `ai.use` gates access to AI features at all,
and every *consequential* AI output (an actual task creation, an actual assignment) still
flows through the identical `task.create` / `task.assign` checks as if a human had typed
it directly — the AI layer calls `TaskService`/`AssignmentService`, it does not have a
side-door. This structurally enforces Rule 13/14 (AI cannot invent an entity or silently
decide something a human lacks permission for) rather than relying on prompt instructions.
