# 01 — Product Architecture

## 1.1 Core loop

Every unit of work in the system, regardless of who creates it or how, flows through the
same pipeline:

```
CREATE → ASSIGN → ACKNOWLEDGE → EXECUTE → UPDATE → SUBMIT/REVIEW → COMPLETE → REPORT
```

This is deliberately a single pipeline. A solo user doing personal to-dos and a college
running a 40-department task program are running the *same* engine — the difference is
how many of the optional stages are exercised (a personal task has no assignment/
acknowledgement step; an org task with team routing exercises all of them) and which
permissions gate each transition. There is no separate "personal task" or "org task"
entity — see §1.3.

## 1.2 Two creation paths, one entity

```
Direct Form Entry  ──┐
                      ├──► Task (structured entity) ──► same pipeline
AI Natural Language ──┘
```

The AI path is a *parser*, not a different feature. `POST /tasks` accepts the same
structured payload whether it was typed into a form or extracted by Claude from a
sentence. The AI layer's only job is producing that payload (plus a confirmation step —
see doc 04 §AI guardrails and doc 10 Phase 2). This guarantees the core system works with
AI fully disabled, satisfying Rule 12/13/14.

## 1.3 Workspaces: Personal vs. Organization

A **Workspace** is the container a Task or Project lives in. Every workspace is exactly
one of:

- **Personal workspace** — owned by a single `user_id`, no organization involved. Created
  automatically for every user at signup. **Personal-workspace tasks are self-assignment
  only** (confirmed decision, doc 13 §11) — there is no other person to accept/decline in
  this context. Assigning work to someone else always means the task lives in an
  Organization workspace instead; multi-person collaboration on personal projects is a
  named future extension point (doc 13), not built now.
- **Organization workspace** — scoped to one `organization_id`. Contains departments,
  teams, projects, and tasks belonging to that org. A user can belong to zero, one, or
  many organizations (doc 13 flags multi-org membership as a forward-compatible design
  point already built into the schema).

Both workspace types share: Projects, Tasks, Checklists, Comments, Attachments,
Notifications, Audit Logs. Only the organization workspace additionally has: Departments,
Teams, Roles/Permissions beyond the owner, cross-team/cross-department assignment, and
Team-Head acknowledgement routing.

```
User
 ├── Personal Workspace (always exactly one)
 │      └── Projects / Tasks (owner = user, no org)
 └── Organization Membership (0..N)
        └── Organization
             ├── Departments
             │     └── Teams
             │           ├── Team Head(s)
             │           └── Members
             ├── Projects / Tasks (org-scoped)
             └── Roles & Permissions (scoped to org/department/team)
```

## 1.4 Entity map (conceptual, not the physical schema — see doc 03)

| Entity | Purpose |
|---|---|
| User | A person. Global identity; auth lives here. |
| Organization | A tenant (e.g. "ABC College"). |
| Department | Sub-division of an organization. Can nest (parent department). |
| Team | A working group, optionally under a department. Has one or more Team Heads. |
| Workspace | Personal or Organization container for Projects/Tasks. |
| Project | Optional grouping of tasks with milestones/dependencies. |
| Task | The unit of work. Has one lifecycle status (doc 05). |
| Task Assignment | One "hop" of routing a task to a user or team, with its own acknowledgement state (doc 06). A task can have a *chain* of these. |
| Role / Permission | Configurable RBAC (doc 04). |
| Notification | Event-driven message to a user. |
| Audit Log | Immutable record of every state-changing action. |
| AI Interaction | Logged record of every AI call (input, output, feature, cost) for traceability and future model training/analytics. |

## 1.5 Ownership roles on a single Task (Rule: never collapse these)

| Field | Meaning |
|---|---|
| `created_by` | Who authored the task (may differ from assignor). |
| Current assignment chain | Ordered list of `task_assignments` rows — see doc 06. Each has its own assignor/assignee/status. |
| `current_assignee` (derived) | The leaf of the active assignment chain — whoever is actually expected to execute right now. |
| Reviewer | Set per-task (or defaulted to the assignor above the executor) — recorded on `task_reviews`. |
| Task Owner (derived) | The **current accountable** team/user — i.e. the leaf of the active assignment chain (doc 06 §6.2), used for workload/reporting dashboards. Example: Management → Marketing Team → Marketing Head → Rahul counts as a Marketing/Rahul workload item. The origin (organization, origin department, original assignor, and the full chain) is preserved separately and is never overwritten — reporting can always answer both "who owns this now" and "where did this actually come from." |

These are distinct **fields/rows**, not one "assignee" column, so the UI can always answer
"who assigned this, who accepted it, who is actually doing it, and who reviews it" as four
separate, correct answers — this is what makes cross-department chains (doc 10 §11) and
team routing (doc 06) auditable.

## 1.6 What AI is and isn't

AI is a **layer on top of** the core loop, not a stage inside it. Concretely, in the
architecture: AI features call into the *same* service layer (`TaskService`,
`AssignmentService`, etc.) that the UI's direct-entry forms call — see doc 02 §Service
Layer. This is what makes Rule 12 ("AI is assistive, not mandatory") structurally true
rather than just a policy statement: disabling the AI feature flag removes a menu item,
not a code path the rest of the system depends on.
