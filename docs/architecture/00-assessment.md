# 00 — Repository Assessment

## What exists today

The working directory (`AI TASK MANAGER/`) is **completely empty**: no files, no `.git`,
no package manifests, no prior scaffolding of any kind. This is a greenfield build.

**Implication:** there is no legacy code, schema, or convention to reconcile with. Every
decision below is a fresh proposal, not a migration. That also means nothing is locked in
yet — this is the cheapest possible moment to get the data model and permission model
right, because every table and endpoint in this package is still just a document.

## What this package contains

Per the brief's "First Action" instructions, this phase produces documentation only —
no application code, no `package.json`, no scaffolding. The documents below are saved
under `docs/architecture/` so they remain the source of truth as implementation proceeds
in later phases:

| Doc | Contents |
|---|---|
| [01-product-architecture.md](01-product-architecture.md) | Core loop, workspaces, entity map |
| [02-system-architecture.md](02-system-architecture.md) | Components, stack, multi-tenancy, background jobs |
| [03-database-erd.md](03-database-erd.md) | Full schema proposal + ER diagram |
| [04-rbac-permissions.md](04-rbac-permissions.md) | Roles, permission catalog, scope resolution |
| [05-task-state-machine.md](05-task-state-machine.md) | Task lifecycle states & transitions |
| [06-assignment-ack-state-machine.md](06-assignment-ack-state-machine.md) | Assignment/acknowledgement chain |
| [07-api-architecture.md](07-api-architecture.md) | REST resource map, conventions, auth pipeline |
| [08-screen-map.md](08-screen-map.md) | Screen/route inventory per surface |
| [09-folder-structure.md](09-folder-structure.md) | Monorepo layout |
| [10-phased-roadmap.md](10-phased-roadmap.md) | Phase 1–4 scope, exit criteria, the E2E scenario |
| [11-testing-strategy.md](11-testing-strategy.md) | Unit/integration/E2E approach |
| [12-security-strategy.md](12-security-strategy.md) | AuthN/AuthZ, tenant isolation, secrets |
| [13-risks-and-open-questions.md](13-risks-and-open-questions.md) | Decisions made by assumption, flagged for your review |

## Confirmed decisions

Three foundational questions have been answered and are now locked in (full detail in
doc 13):

1. **Web first.** Next.js web app + shared backend/API/auth/authz contracts are built
   first; React Native + Expo mobile is a later phase, built as a first-class production
   client against those same contracts — not a stripped-down afterthought.
2. **Personal-workspace assignment is self-only.** Assigning work to another person or
   team always implies an organization context, which supports all six assignment
   patterns from §4 of the brief with acknowledgement required throughout.
3. **Task ownership for reporting = the current accountable owner** (the leaf of the
   active assignment chain), not the originating team — while origin (organization,
   department, creator, original assignor, full chain) is preserved separately for audit.

## Other technical decisions made (see doc 13 for full rationale + alternatives)

These remain default, reversible choices made to avoid stalling on open-ended questions.
Flag any of them and they get revisited before Phase 1 starts:

1. **Postgres via Supabase**, accessed through **Prisma** as the ORM, with Supabase Auth
   for authentication and Supabase Storage for attachments.
2. **Next.js Route Handlers as the REST API** rather than a separate Node service — one
   deployable for the MVP, cleanly extractable into a standalone API later since all
   business logic lives in a framework-agnostic service layer.
3. **Claude API called only from server-side route handlers**, never from the client.
4. Real-time UI updates use polling/revalidation for the MVP; Supabase Realtime/websockets
   are a named extension point, not built in Phase 1.

## Next step

Read docs 01–13, then tell me:
- Which of the remaining defaults in doc 13 (#2–8, #10, #13–15) to change, if any.
- Whether to proceed to **Phase 1** implementation as scoped in doc 10.

No code will be written until you confirm.
