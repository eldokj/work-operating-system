# 08 — Screen Map

Grouped by area. "Phase" marks when each screen is first needed (see doc 10).

## Auth & Onboarding (Phase 1)
- Sign up / Log in / Forgot password
- Post-signup choice: *Continue with personal workspace* vs *Create an organization* vs *Join an organization (invite link/code)*
- Organization setup wizard: name → first departments (optional) → first teams (optional) → invite members

## Navigation shell (Phase 1)
- Workspace switcher (Personal ↔ each Organization the user belongs to)
- Global "What needs to be done?" quick-capture bar (always visible — §28 central interaction)

## Dashboards (Phase 1, richer in Phase 3/4)
- **Personal dashboard**: My Tasks, Due Today, Upcoming, Overdue, Pending Acceptance, Waiting for Review, Completed, My Projects
- **Team dashboard**: Team Tasks, Unassigned, Assigned, In Progress, Blocked, Overdue, Pending Acceptance, Workload
- **Management/org dashboard**: Org workload, department performance, team performance, overdue, bottlenecks (Phase 4), completion trends, pending reviews, cross-team dependencies

## Task screens (Phase 1)
- Task list (filterable/sortable, table + board/kanban views)
- Task detail (description, checklist, comments, updates, attachments, assignment chain/lineage, activity/audit trail)
- **Quick Task** modal (title, assignee/team, due date, priority)
- **Advanced Task** form (full field set per §11B)
- **Assignment Inbox** — the pending-acknowledgement queue (accept/decline actions), separated into "assigned to me" and, for Team Heads, "assigned to my team(s)"
- Reassign / distribute-internally screen (Team Head choosing who inside the team executes)
- Submit-for-review screen
- Review screen (approve / request changes, with AI pre-check panel in Phase 3)

## AI screens (Phase 2+)
- Natural-language task composer (single input → structured confirmation preview before save)
- AI confirmation/edit form (shows extracted fields + unresolved/ambiguous fields highlighted, per doc 07 §7.4)
- Assignee recommendation panel (shown inline in Advanced Task form, not a separate page)
- AI Command Center (Phase 4)

## Organization management (Phase 1)
- Departments list/detail (CRUD, nested department support)
- Teams list/detail (CRUD, member management, set/unset Team Head)
- Members directory (org-wide user list, invite/remove/status)
- Roles & Permissions editor (view seeded roles, clone/edit, assign role-to-user with scope)
- Organization settings (branding, feature flags incl. AI on/off)

## Projects (Phase 1 basic, Phase 2+ dependencies/milestones)
- Projects list
- Project detail (tasks grouped, milestones, dependency graph)

## Notifications (Phase 1)
- Notification center (list, mark read, filters by type)
- In-app toast/badge system

## Reports (Phase 1 basic counts, Phase 3/4 analytics)
- Team/department/org report views (charts, exportable)
- Audit log viewer (filter by actor/entity/date, `audit.view` gated)

## Settings (Phase 1)
- Profile & preferences (timezone, notification preferences)
- Account/security (password, sessions)
