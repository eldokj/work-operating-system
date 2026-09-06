# AI-Native Task Management Platform — Architecture Package

This is the pre-implementation architecture package for the platform described in the
master build prompt. No application code exists yet by design — see
[00-assessment.md](00-assessment.md) for why, and for the next-step approval request.

## Reading order

1. [00-assessment.md](00-assessment.md) — repo state, what's in this package, default decisions
2. [01-product-architecture.md](01-product-architecture.md) — core loop, workspaces, entity map
3. [02-system-architecture.md](02-system-architecture.md) — components, stack, multi-tenancy
4. [03-database-erd.md](03-database-erd.md) — full schema proposal
5. [04-rbac-permissions.md](04-rbac-permissions.md) — roles, permissions, scope resolution
6. [05-task-state-machine.md](05-task-state-machine.md) — task lifecycle
7. [06-assignment-ack-state-machine.md](06-assignment-ack-state-machine.md) — assignment/acknowledgement chain
8. [07-api-architecture.md](07-api-architecture.md) — REST resource map & conventions
9. [08-screen-map.md](08-screen-map.md) — screen inventory
10. [09-folder-structure.md](09-folder-structure.md) — monorepo layout
11. [10-phased-roadmap.md](10-phased-roadmap.md) — Phase 1–4 scope & exit criteria
12. [11-testing-strategy.md](11-testing-strategy.md) — unit/integration/E2E plan
13. [12-security-strategy.md](12-security-strategy.md) — authn/authz/tenant-isolation/secrets
14. [13-risks-and-open-questions.md](13-risks-and-open-questions.md) — assumptions to confirm

## Status

**Awaiting approval to begin Phase 1 implementation.** See doc 13 for the specific
assumptions worth your explicit sign-off before code is written.
