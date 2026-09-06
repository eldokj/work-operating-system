# 09 — Folder / Project Structure

Monorepo (pnpm workspaces + Turborepo) so the mobile app and future standalone API can be
added later without restructuring what exists.

```
ai-task-manager/
├── apps/
│   ├── web/                      # Next.js app (MVP surface)
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   ├── (app)/            # authenticated shell: dashboards, tasks, org mgmt
│   │   │   └── api/v1/           # Route Handlers = the REST API (doc 07)
│   │   │       ├── tasks/
│   │   │       ├── assignments/
│   │   │       ├── organizations/
│   │   │       ├── departments/
│   │   │       ├── teams/
│   │   │       ├── ai/
│   │   │       └── internal/
│   │   ├── components/
│   │   ├── lib/                  # thin: session helpers, API client, feature flags
│   │   └── middleware.ts         # authn/rate-limit edge middleware
│   │
│   └── mobile/                   # React Native + Expo — added when mobile phase starts
│
├── packages/
│   ├── db/                       # Prisma schema + migrations (doc 03)
│   │   ├── schema.prisma
│   │   └── migrations/
│   │
│   ├── domain/                   # Framework-agnostic service layer (doc 02 §Service Layer)
│   │   ├── services/
│   │   │   ├── task.service.ts
│   │   │   ├── assignment.service.ts
│   │   │   ├── permission.service.ts
│   │   │   ├── notification.service.ts
│   │   │   ├── audit.service.ts
│   │   │   ├── reporting.service.ts
│   │   │   └── ai.service.ts
│   │   ├── state-machines/
│   │   │   ├── task-status.machine.ts        (doc 05)
│   │   │   └── assignment-status.machine.ts  (doc 06)
│   │   └── permission-engine/
│   │       ├── permissions.catalog.ts        (doc 04 §4.2)
│   │       └── resolve-scope.ts              (doc 04 §4.4)
│   │
│   ├── shared/                   # Zod schemas + TS types shared by web, mobile, and AI I/O
│   │   ├── schemas/
│   │   │   ├── task.schema.ts
│   │   │   ├── assignment.schema.ts
│   │   │   └── ...
│   │   └── types/
│   │
│   ├── api-client/                # Typed fetch client consumed by web + (later) mobile
│   │
│   └── config/                    # shared eslint/tsconfig/tailwind config
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/                       # Playwright — includes the §32 ABC College scenario
│
├── docs/
│   └── architecture/               # this package
│
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## Rationale

- `packages/domain` holds every business rule (state machines, permission resolution,
  assignment chain logic) with **zero** dependency on Next.js or Prisma types directly
  exposed — it depends on a repository interface that `packages/db` implements. This is
  what makes "lift the API into a standalone service later" and "unit test the state
  machine without a database" both cheap.
- `packages/shared` schemas are the single definition used for (a) API request validation,
  (b) AI output validation, (c) frontend form validation — one schema, three consumers,
  which is what prevents drift between what the AI is allowed to produce and what a human
  form is allowed to submit.
- `apps/web/app/api/v1` handlers are thin: parse → call `packages/domain` service → shape
  response. No business logic lives in a route handler file.
