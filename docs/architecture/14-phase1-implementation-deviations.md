# 14 — Phase 1 Implementation Deviations from the Architecture Package

These are the only two deviations from docs 01–13, both forced by the build environment
(no Supabase project, no pnpm write access), not by a design reconsideration. Both are
implemented behind the same interfaces the architecture already specified, so nothing
about the domain/service layer, schema, or API contracts changes.

## 1. Auth & Storage: local implementation behind the same interfaces

Doc 02 specifies Supabase Auth and Supabase Storage. Provisioning a real Supabase project
requires an account/credentials I don't have access to in this session. Rather than
inventing a different architecture, Phase 1 implements:

- **`AuthService`** (in `packages/domain/services/auth.service.ts`): credential
  verification and user creation, implemented locally via bcrypt-hashed passwords stored
  on `users`. The HTTP-layer session itself (`apps/web/lib/session.ts`) is a hand-rolled
  signed JWT in an httpOnly cookie via `jose` — NextAuth/Auth.js was deliberately not used
  here: this environment resolved very recent major versions of Next.js/React/Prisma
  (see #3 below), and NextAuth v4's App Router integration against an unfamiliar Next.js
  minor version was assessed as more version-compatibility risk than a ~40-line
  sign/verify/cookie module we fully control. Every consumer (API route wrapper in
  `apps/web/lib/api.ts`, `PermissionService`, etc.) depends only on
  `getSessionUserId()` returning a user id or null, never on `jose` or cookie details
  directly, so this is just as swappable as the NextAuth option would have been.
- **`StorageService`** (in `packages/domain/services/storage.service.ts`): a
  `put(file) -> { path, url }` / `getSignedUrl(path) -> url` interface, implemented for
  Phase 1 with a local-disk adapter (`storage/local/`, gitignored) scoped per organization
  the same way a Supabase bucket-per-org would be.

**To move to real Supabase later:** implement `SupabaseAuthService` and
`SupabaseStorageService` against the same two interfaces and swap the DI wiring in one
place (`packages/domain/container.ts`). No route handler, service, or UI component
changes.

## 2. Package manager: npm workspaces instead of pnpm

Doc 09 proposed pnpm workspaces + Turborepo. `corepack prepare pnpm` failed in this
environment (`EPERM` writing to `C:\Program Files\nodejs`, a machine permissions issue,
not a project one). Phase 1 uses **npm workspaces** instead — same monorepo shape from
doc 09 (`apps/*`, `packages/*`), same scripts, no code depends on which package manager
ran `install`. Turborepo is deferred (npm's own `--workspaces` scripting covers Phase 1's
build graph; Turborepo can be layered in later without restructuring).

## 3. Prisma version pinned to 6.19.3, not the 7.x/8.x line

`npm`'s `latest` tag for `prisma` currently resolves to an 8.0 release candidate, and even
stable 7.x removed the classic `datasource { url = env(...) }` schema syntax in favor of a
new `prisma.config.ts` + driver-adapter model. Adopting that is a reasonable direction but
is new-enough surface area to add real risk mid-Phase-1 for no functional benefit here.
Phase 1 pins `prisma` / `@prisma/client` to **6.19.3** (latest stable 6.x), which keeps the
schema.prisma file in doc 03 as the single source of truth for the schema. Revisit the 7.x
migration as a deliberate, isolated upgrade later, not bundled into feature work.

## 4. Two Postgres roles instead of Supabase-managed RLS session variables

Doc 02 §2.3's RLS design assumes Supabase's request-scoped `current_setting('app.current_org_id')`
mechanism. Running local Postgres directly, Phase 1 implements the audit-immutability half
of "defense in depth" (doc 12 §12.7) via two Postgres roles instead: a migration/owner role
(`DATABASE_URL`) that only `prisma migrate` uses, and a least-privilege runtime role
(`DATABASE_RUNTIME_URL`, `app_runtime`) that the running application connects as, which is
structurally revoked `UPDATE`/`DELETE` on `audit_logs` — see the migration in
`packages/db/prisma/migrations/20260906072700_constraints_and_audit_immutability/`.
Full multi-tenant row-level-security policies (the org-isolation half of doc 02 §2.3) are
implemented as application-layer checks in `PermissionService` for Phase 1; DB-level RLS
policies are a defined follow-up once a Supabase project (or an equivalent session-variable
mechanism) is provisioned — application-layer checks are exercised by the integration
tests in doc 11 §11.2 in the meantime, so tenant isolation is enforced and tested, just by
one layer instead of two for now.

## 5. `.env` lives in three places, deliberately

Next.js loads `.env` relative to the directory it's actually run from (`apps/web/`), not
the monorepo root — a root-only `.env` is invisible to `next build`/`next dev`. So the
same local values are copied to: repo root `.env` (for root-level scripts and Docker),
`packages/db/.env` (for `prisma migrate`, which needs the migrator-role `DATABASE_URL`),
and `apps/web/.env` (for the running app, which needs `DATABASE_RUNTIME_URL`). All three
are gitignored; `.env.example` at the root is the single source of truth to copy from.

## 6. Prisma native engine resolution under Next.js/webpack on Windows

`packages/db`'s generated Prisma Client (consumed by `apps/web` as a sibling monorepo
package rather than a direct `node_modules` dependency) failed to locate its native
Windows query-engine binary (`query_engine-windows.dll.node`) specifically when loaded
through Next.js's webpack server bundle — `next build`'s build-time page-data-collection
pass logged repeated `PrismaClientInitializationError`s for every route touching the
database, and even though the build itself still completed (Next tolerates errors in that
pass), the affected routes were broken at real runtime too, returning a bare
"Internal Server Error" with no application-level logging. Verified independently outside
webpack (`tsx prisma/seed.ts`, plain `node -e`) that the engine resolves correctly on its
own — this is specifically a webpack/monorepo-symlink path-resolution interaction, not a
Prisma or Windows problem in general.

`next.config.js` sets `serverExternalPackages: ["@prisma/client"]` (the standard Prisma +
Next.js App Router guidance) to stop webpack from bundling it at all, but that alone did
not resolve it here. `apps/web/lib/db.ts` additionally computes the real engine path at
runtime (via `require.resolve("@ai-task-manager/db/package.json")`, so it stays correct if
the repo moves) and sets `PRISMA_QUERY_ENGINE_LIBRARY` before constructing `PrismaClient`,
bypassing Prisma's own (webpack-confused) search heuristics entirely. Confirmed fixed by
directly testing engine load before and after in isolation, then reconfirmed against a
real HTTP request through the built app. This is a local dev/Windows-specific shim; it is
inert (silently skipped) on any platform where the default resolution already works, so it
should not need revisiting when this later runs on Linux-based Supabase/production infra.

Everything else in docs 01–13 stands as approved.
