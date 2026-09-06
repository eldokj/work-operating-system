# 12 — Security Strategy

## 12.1 Authentication
- Supabase Auth handles credential storage/hashing, session/JWT issuance, email
  verification, and password reset. No custom password handling code is written.
- Sessions via httpOnly, secure, SameSite cookies on the web app; no tokens stored in
  `localStorage`.
- Future: OAuth/SSO providers plug into Supabase Auth without touching the app's own
  authz model (extension point, doc 13).

## 12.2 Authorization
- **Server-side only**, always — client-side permission checks exist purely for UI
  affordance (hiding a button a user couldn't use anyway) and are never trusted; every
  mutating and sensitive-read endpoint re-checks via `PermissionService.can(...)`
  (doc 04, doc 07 §7.3).
- Two independent enforcement layers: application-level checks + Postgres RLS (doc 02
  §2.3). A bug in one layer does not become a breach.
- Assignment authorization has its own dedicated, more granular check (doc 04 §4.5)
  beyond a flat permission lookup, because it's the highest-blast-radius action (crosses
  team/department boundaries).

## 12.3 Tenant isolation
- Every org-scoped table carries `organization_id`; RLS policy `organization_id =
  current_setting('app.current_org_id')::uuid` set per request from the authenticated
  session's verified membership — never from a client-supplied header taken at face
  value.
- Personal-workspace data isolated by `owner_user_id` under the same two-layer model.
- Integration tests explicitly probe cross-tenant access attempts (doc 11 §11.2).

## 12.4 Input validation
- Every API input validated against a Zod schema before touching the service layer —
  including AI-produced payloads, validated through the identical schema a manual form
  submission uses (doc 02 §2.2, doc 07 §7.4). This is a primary defense against AI
  "inventing" malformed or out-of-contract data.
- File uploads: server-side mime-type and size validation before issuing a Supabase
  Storage signed URL; a virus-scan hook is a named future extension point, not built in
  Phase 1 (documented, not silently skipped).

## 12.5 Rate limiting & abuse prevention
- Edge middleware rate limits by user/IP on auth endpoints and AI endpoints specifically
  (AI calls have real cost and are the most likely abuse/DoS target).
- `Idempotency-Key` support on task/assignment creation endpoints to prevent duplicate
  side effects from client retries.

## 12.6 Secrets management
- `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, and any push-provider
  server key live only in server-side environment variables, never in `NEXT_PUBLIC_*`
  variables, never returned in any API response, never logged.
- AI calls happen exclusively inside `AIService` (server-side) — the client never holds
  or sees a provider key (§24 explicit requirement).

## 12.7 Audit logging
- Every state-changing action (task status transitions, assignment accept/decline,
  role/permission grants, membership changes) writes an immutable `audit_logs` row
  (doc 03 §`audit_logs`).
- DB-level enforcement: the application's Postgres role has `INSERT` but not `UPDATE`/
  `DELETE` on `audit_logs`; only a migration run under a privileged role could alter
  history, satisfying §22 "immutable from normal application users."

## 12.8 Secure file handling
- Attachments stored in Supabase Storage buckets scoped per organization; access via
  short-lived signed URLs generated server-side after an authorization check, never a
  public bucket.

## 12.9 Dependency & build security
- Standard practice from day one: lockfile-pinned dependencies, `npm audit`/equivalent in
  CI, no secrets committed (`.env` gitignored, `.env.example` checked in instead).

## 12.10 Review cadence
Per the brief's quality gates (§31), every phase includes an explicit security review
pass and an authorization review pass before being marked complete — not deferred to a
single end-of-project audit.
