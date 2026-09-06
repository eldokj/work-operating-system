# 10 — Phased Implementation Plan

Each phase ends only when its quality gates (doc 11/12, and §31 of the brief) pass —
type check, lint, unit tests, integration tests, build, security/authz review. No phase
is claimed "done" on partial results.

## Phase 1 — Core platform (no AI)

**Scope**
- Auth (Supabase Auth), personal workspace auto-provisioned per user
- Organization creation, departments, teams, team membership, Team Head designation
- Roles & permissions engine (doc 04) with seeded templates, custom role editing
- Direct task creation (Quick + Advanced forms), projects, checklists
- Full assignment/acknowledgement chain (doc 06): individual↔individual, individual→team,
  team-head-distributes-internally, cross-team, cross-department — all six patterns in §4
- Task state machine (doc 05) end to end through COMPLETED
- Comments, progress updates, attachments (Supabase Storage)
- Review flow (submit → approve/request changes)
- In-app notifications
- Dashboards: personal, team, and a basic management view
- Audit log (write path + viewer)

**Exit criteria**
- The full §32 E2E scenario (ABC College / Eldo / Anu / Rahul, Management → Marketing
  Team → Team Head accept → internal assignment to Rahul → accept → in progress → submit
  → review → approve → completed) passes as an automated Playwright test, **and** every
  transition in it has a corresponding `audit_logs` row.
- All Phase 1 quality gates (doc 11) green.

## Phase 2 — AI creation & assistance (assistive only)

- `POST /ai/parse-task` natural-language → structured draft + confirmation UI
- AI checklist generation (suggest, human accepts/edits before save)
- AI task description generation/expansion
- AI assignee recommendation (surfaced as a suggestion panel in the Advanced Task form,
  never auto-assigns)
- Deadline "sanity check" using simple heuristics/rules (not yet historical-data-driven —
  §15 explicitly forbids pretending to have historical intelligence before enough data
  exists)
- `ai_interactions` logging for every call

**Exit criteria:** AI features fully removable via feature flag with zero impact on
Phase 1 functionality (proves the "AI is a layer" architecture, doc 01 §1.6).

## Phase 3 — AI-assisted operations

- Progress-summary generation from update/comment threads
- Smart follow-up drafting (approaching deadline / no update / overdue / blocked /
  pending acknowledgement / pending review triggers) — draft only, requires explicit
  Send/Edit/Dismiss by a human (§17, never auto-send by default)
- AI review pre-check (checklist/attachment/description completeness signal shown to the
  human reviewer, who still makes the approve/reject call)
- AI-generated reporting summaries

## Phase 4 — Intelligence & scale

- AI command center
- Cross-team bottleneck detection, workload optimization, predictive deadline risk
  (now justified by the historical data accumulated since Phase 1)
- Advanced analytics dashboards
- Integration extension points (calendar, email, Slack/Teams-style)
- Mobile app (React Native + Expo) build-out against the existing `packages/shared` /
  `api-client` contracts
- Recurring tasks, automation rules, external collaborators/guests (doc 13 extension
  points)

## Sequencing note

Phases run **incrementally within Phase 1 itself** too — the brief's §30 methodology
applies recursively. The suggested internal slice order for Phase 1:
1. DB schema + migrations + seed permissions/roles
2. Auth + personal workspace
3. Organizations/departments/teams/membership + permission engine
4. Task CRUD (no assignment yet) + projects/checklists
5. Assignment/acknowledgement engine (the highest-risk piece — built and tested against
   doc 06 in isolation before wiring to UI)
6. Review/completion flow
7. Comments/updates/attachments
8. Notifications
9. Dashboards
10. Audit log viewer
11. The §32 E2E test, run against the full slice stack

Each numbered slice gets its own review/gate pass before the next starts.
