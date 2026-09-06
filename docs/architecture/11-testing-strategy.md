# 11 — Testing Strategy

## 11.1 Unit tests (`tests/unit`, colocated with `packages/domain` where convenient)

- **State machines**: every legal and illegal transition in doc 05 and doc 06, asserted
  directly against `task-status.machine.ts` / `assignment-status.machine.ts` with no DB.
- **Permission engine**: scope-resolution matrix (doc 04 §4.4) — org-scoped grant applies
  everywhere, department-scoped grant applies to nested departments, team-scoped grant
  does not leak to sibling teams, multiple roles union correctly, revoked role stops
  applying immediately.
- **Zod schemas**: boundary cases for every task/assignment input schema, including that
  AI-shaped output failing validation is rejected the same way a malformed form post is.
- **AssignmentService**: the six assignment patterns (§4 of the brief) in isolation with a
  fake repository — especially that team-assignment never creates N member-level rows.

## 11.2 Integration tests (`tests/integration`)

- API route handlers against a real (test-schema) Postgres instance via Prisma, covering:
  authn required, authz denied when permission missing, authz allowed when granted,
  correct audit log row written, correct notification row written.
- Cross-tenant isolation: a user in Org A can never read/write Org B's departments,
  teams, tasks, or audit logs — asserted at the API layer *and* by attempting a raw query
  that would violate RLS, to prove the DB-layer defense (doc 02 §2.3) independently works
  even if an app-layer check were hypothetically removed.
- File upload flow against Supabase Storage (or a local emulator).

## 11.3 End-to-end tests (`tests/e2e`, Playwright)

- **The §32 scenario, verbatim**, run as a named, permanent regression test:
  create org "ABC College" → departments (Management, Finance, Marketing) → users (Eldo,
  Anu, Rahul) → Marketing team → role assignments (Eldo=Management/Org-level assigner,
  Anu=Marketing Team Head, Rahul=Marketing member) → Eldo creates & assigns task to
  Marketing Team → Anu sees PENDING_ACKNOWLEDGEMENT → Anu accepts → Anu assigns to Rahul
  → Rahul sees PENDING_ACKNOWLEDGEMENT → Rahul accepts → status IN_PROGRESS → Rahul
  submits → Anu reviews → Anu approves → status COMPLETED → assert every transition has
  a matching audit log entry queried via the API.
- Decline-path E2E: assignment declined with reason → task returns to UNASSIGNED →
  reassignment succeeds.
- Cross-department E2E: Finance user assigns to Marketing team, permission-gated.
- Personal-workspace E2E: a user with no organization creates, tracks, and completes a
  personal task with zero org-related UI surfaced.

## 11.4 AI-specific tests (from Phase 2 onward)

- Contract tests for `/ai/parse-task` using recorded/mocked Claude responses (never live
  API calls in CI) — asserting the endpoint's output always validates against the same
  Zod task schema used by direct creation, and that ambiguous/unresolved fields are
  surfaced rather than guessed.
- Regression fixtures for known tricky inputs (ambiguous names, relative dates, missing
  fields) captured as the feature matures.

## 11.5 Non-functional

- Load/perf smoke test on the task-list and dashboard queries once real data volume
  exists (Phase 3+), not before it's meaningful.
- Accessibility pass (keyboard nav, screen-reader labels) on the core task-creation and
  acknowledgement flows, given §28's requirement that the app be "easy for non-technical
  users."

## 11.6 CI gate

Every PR runs: typecheck → lint → unit → integration → build. E2E runs on merge to the
main integration branch (and on-demand for PRs touching assignment/permission code,
given how central that path is). A phase is never marked complete in project tracking
while any of these are red — per the brief's explicit instruction not to claim
completion on failing tests/builds.
