# 07 — API Architecture

## 7.1 Conventions

- Base path: `/api/v1/...`. Versioned from day one so Phase 2+ AI endpoints or breaking
  changes never require a client-side branch on "old vs new" without a version signal.
- Every request passes through: **authenticate → resolve org context → authorize
  (permission check) → validate input (Zod) → rate limit → service call → audit log (if
  mutating) → response**.
- Response envelope:
  ```json
  { "data": { ... }, "error": null }
  { "data": null, "error": { "code": "FORBIDDEN", "message": "..." } }
  ```
- Pagination: cursor-based, `?cursor=&limit=` → `{ data: [...], nextCursor }`.
- All mutating endpoints require an `Idempotency-Key` header where retries are plausible
  (e.g. task creation from a flaky mobile connection).

## 7.2 Resource map (representative, not exhaustive)

| Resource | Endpoints |
|---|---|
| Auth | `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh` (delegates to Supabase Auth) |
| Users | `GET /users/me`, `PATCH /users/me`, `GET /organizations/:orgId/users` |
| Organizations | `POST /organizations`, `GET /organizations/:id`, `PATCH /organizations/:id`, `POST /organizations/:id/invite` |
| Departments | `POST /organizations/:orgId/departments`, `GET/PATCH/DELETE /departments/:id` |
| Teams | `POST /departments/:deptId/teams` (or org-level `/organizations/:orgId/teams` if no department), `GET/PATCH/DELETE /teams/:id`, `POST /teams/:id/members`, `PATCH /teams/:id/members/:userId` (set `is_head`), `DELETE /teams/:id/members/:userId` |
| Roles | `GET /organizations/:orgId/roles`, `POST /organizations/:orgId/roles`, `PATCH /roles/:id/permissions`, `POST /users/:userId/roles` (grant, with scope) |
| Workspaces | `GET /workspaces` (personal + all orgs the user belongs to), `POST /workspaces` (org workspace auto-created with org) |
| Projects | `POST /workspaces/:workspaceId/projects`, `GET/PATCH/DELETE /projects/:id` |
| Tasks | `POST /tasks` (direct create), `POST /tasks/ai-draft` (AI parse → returns unsaved structured draft for confirmation), `GET /tasks/:id`, `PATCH /tasks/:id`, `GET /tasks?filter=...`, `DELETE /tasks/:id` (soft, → CANCELLED) |
| Assignments | `POST /tasks/:id/assignments` (assign), `POST /assignments/:id/accept`, `POST /assignments/:id/decline` (body: `reason`), `POST /assignments/:id/reassign-internal` (Team Head distributing) |
| Checklist | `POST /tasks/:id/checklist-items`, `PATCH /checklist-items/:id`, `DELETE /checklist-items/:id` |
| Comments | `POST /tasks/:id/comments`, `GET /tasks/:id/comments` |
| Updates | `POST /tasks/:id/updates` (progress %, note) |
| Attachments | `POST /tasks/:id/attachments` (signed upload URL via Supabase Storage), `DELETE /attachments/:id` |
| Reviews | `POST /tasks/:id/submit`, `POST /tasks/:id/reviews` (body: `decision`, `notes`) |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/mark-all-read` |
| Reports | `GET /organizations/:orgId/reports/overview`, `.../reports/team/:teamId`, `.../reports/department/:deptId` |
| Audit | `GET /organizations/:orgId/audit-logs?entity=&actor=&from=&to=` |
| AI | `POST /ai/parse-task`, `POST /ai/suggest-checklist`, `POST /ai/recommend-assignee`, `POST /ai/summarize-progress`, `POST /ai/draft-followup`, `POST /ai/review-precheck` — all Phase 2/3, all server-side only, all logged to `ai_interactions` |
| Internal | `POST /internal/cron/tick` (protected by a separate internal-only secret, not user auth) |

## 7.3 Authorization pattern per endpoint

Every handler declares its required permission(s) declaratively, e.g.:

```ts
export const POST = withApi(
  { permission: 'task.assign', resolveContext: (req) => ({ taskId: req.params.id }) },
  async (req, ctx) => { /* AssignmentService.assign(...) */ }
);
```

`withApi` is the shared middleware wrapper: it authenticates the session, loads the
resource context, calls `PermissionService.can(...)`, validates `req.body` against the
route's Zod schema, and only then invokes the handler — so no handler can accidentally
skip a check (the pattern makes "forgot to add an authz check" structurally harder, per
§24 "never trust client-side permission checks... all authorization must be enforced
server-side").

## 7.4 AI endpoint contract (Phase 2)

`POST /ai/parse-task` never writes to the database. It returns a structured draft:

```json
{
  "data": {
    "title": "Prepare Q3 report",
    "description": null,
    "dueDate": "2026-09-15",
    "suggestedAssignee": { "type": "USER", "name": "Priya", "matchedUserId": "uuid-or-null" },
    "priority": null,
    "unresolvedFields": ["priority"],
    "ambiguities": [{ "field": "suggestedAssignee", "note": "Multiple users named Priya found" }]
  }
}
```

The client always shows this as an editable confirmation form before calling
`POST /tasks`. `matchedUserId: null` or a populated `ambiguities` array means the UI
*must* block silent submission and force user resolution (Rule 13).
