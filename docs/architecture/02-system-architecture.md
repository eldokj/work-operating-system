# 02 — System Architecture

## 2.1 Component diagram

```
┌─────────────────────────┐     ┌──────────────────────────┐
│   Web Client (Next.js)  │     │  Mobile (RN + Expo) — later│
└────────────┬─────────────┘     └────────────┬──────────────┘
             │  HTTPS / JSON (REST, /api/v1)   │
             └────────────────┬────────────────┘
                               ▼
                 ┌───────────────────────────┐
                 │  API Layer                │
                 │  Next.js Route Handlers    │
                 │  - authn middleware        │
                 │  - authz (permission) mw   │
                 │  - zod input validation    │
                 │  - rate limiting           │
                 └────────────┬──────────────┘
                               ▼
                 ┌───────────────────────────┐
                 │  Service Layer (framework-  │
                 │  agnostic, pure TS)         │
                 │  - TaskService              │
                 │  - AssignmentService        │
                 │  - PermissionService        │
                 │  - NotificationService      │
                 │  - AuditService             │
                 │  - AIService (server-only)  │
                 │  - ReportingService         │
                 └──────┬───────────┬─────────┘
                        │           │
             ┌──────────▼───┐   ┌───▼─────────────┐
             │ Prisma ORM   │   │ Claude API       │
             │ (Postgres)   │   │ (server key only)│
             └──────┬───────┘   └──────────────────┘
                    ▼
        ┌───────────────────────────┐
        │ Supabase                  │
        │  - Postgres (+ RLS)       │
        │  - Auth                   │
        │  - Storage (attachments)  │
        └───────────────────────────┘

        ┌───────────────────────────┐
        │ Background jobs (cron)    │
        │  - overdue scan           │
        │  - deadline reminders     │
        │  - follow-up suggestions  │
        │  - notification digest    │
        └───────────────────────────┘

        Push (later): Firebase Cloud Messaging / APNs-compatible layer
```

## 2.2 Why this stack (mapped to §25 of the brief)

| Concern | Choice | Why |
|---|---|---|
| Web frontend | Next.js (App Router) | SSR for fast first paint on dashboards, React Server Components reduce API round-trips for read-heavy views, one deploy target for MVP. |
| Mobile | React Native + Expo | Per brief; built later against the same `packages/shared` contracts. |
| Backend | Node.js + TypeScript, hosted as Next.js Route Handlers | Avoids standing up a second service for the MVP (over-engineering warning in §25); the service layer underneath is framework-agnostic so it can be lifted into a standalone Node/Express or Fastify service later without rewriting business logic. |
| API style | REST, versioned `/api/v1/...` | Per brief; simplest to reason about for permission-per-endpoint auditing. GraphQL/tRPC not ruled out later but adds complexity not justified yet. |
| Database | PostgreSQL via Supabase | Relational integrity for the assignment-chain and audit-log models (heavy on FKs and constraints); Supabase gives managed Postgres + Auth + Storage without three separate vendors. |
| ORM | Prisma | Strong TypeScript inference end-to-end into Zod schemas and the service layer; migrations are declarative and reviewable. |
| Auth | Supabase Auth | Handles password hashing, session/JWT issuance, email verification, and future OAuth/SSO (extension point, §Future Extensibility) without us custom-building auth. |
| Storage | Supabase Storage | Attachments or checklist file uploads, bucket-per-org isolation. |
| Validation | Zod | Single schema definition shared between API input validation, AI-output validation (AI extraction is validated through the *same* Zod schema as a manual form submit — this is what prevents AI from producing an invalid/inventing entity, per Rule 13), and TS types. |
| AI | Claude API, called only from server-side service (`AIService`) | Prompt + API key never reach the client; every call is logged to `ai_interactions` (doc 03) for audit and cost tracking. |
| Push | Firebase Cloud Messaging-compatible | Deferred to the phase mobile ships; architecture reserves a `notifications.delivery_channel` field now so it's additive later. |

## 2.3 Multi-tenancy (§23) — defense in depth

Two independent layers enforce tenant isolation; neither is trusted alone:

1. **Application layer (primary, always enforced):** every service method that touches
   an org-scoped table requires an explicit `organizationId` in its input context, derived
   server-side from the authenticated session + the resource being acted on — never from a
   client-supplied "current org" header taken at face value without membership
   verification. `PermissionService.assertCanAccessOrg(userId, orgId)` runs before any
   org-scoped query.
2. **Database layer (defense in depth):** Postgres Row-Level Security (RLS) policies on
   every org-scoped table, keyed on `organization_id = current_setting('app.current_org_id')`
   set per-request via the Supabase/Postgres session. This means even a bug in the service
   layer cannot leak cross-tenant rows — the DB itself refuses them.

Personal-workspace data (`organization_id IS NULL`) is isolated by `owner_user_id` instead,
under the same two-layer model.

## 2.4 Background jobs

MVP: a single scheduled Route Handler (`/api/internal/cron/tick`) invoked by an external
scheduler (e.g. Supabase Scheduled Functions or Vercel Cron) every few minutes, running:
overdue detection, deadline-approaching notification triggers, and (Phase 3) follow-up
draft generation. This avoids introducing a queue/worker system before it's needed. If
volume later demands it, this is the extension point to swap in a real job queue
(pg-boss, BullMQ+Redis) — no business logic changes, only the trigger mechanism.

## 2.5 Environments & config

- `local` / `staging` / `production` Supabase projects, fully isolated.
- Secrets (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, Firebase
  server key) live in server-only env vars, never in `NEXT_PUBLIC_*` variables.
- Feature flags (e.g. `AI_FEATURES_ENABLED`) allow disabling the entire AI layer per
  environment or per organization, satisfying "AI must not be mandatory."
