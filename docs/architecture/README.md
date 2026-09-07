# AI-Native Task Management Platform — Architecture Package

This is the architecture package for the platform described in the master build prompt.
Phase 1 (core task/assignment/RBAC engine) is implemented and committed; Phase 2A (task
conversations) is implemented on top of it. Docs 00–13 are the original pre-implementation
package; docs 14–15 document what was actually built, including where implementation
forced a deviation from the original plan.

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
14. [13-risks-and-open-questions.md](13-risks-and-open-questions.md) — assumptions, resolved and open
15. [14-phase1-implementation-deviations.md](14-phase1-implementation-deviations.md) — where Phase 1's build forced a deviation from this package, and why
16. [15-task-conversation.md](15-task-conversation.md) — Phase 2A: task conversations, as actually implemented

## Status

**Phase 1**: implemented, tested (21 unit + 23 E2E tests passing), committed
(`2792a89197046be0f2048c7e74e82e769ac5adec`).

**Phase 2A**: implemented on top of Phase 1 with no changes to assignment, RBAC, task
state-machine, notification, or audit architecture — see doc 15. Tested (37 E2E tests
passing, superset of Phase 1's suite). See [../phase-1-completion-report.md](../phase-1-completion-report.md)
for the Phase 1 report; the Phase 2A completion report is delivered in-conversation per
that phase's instructions.
