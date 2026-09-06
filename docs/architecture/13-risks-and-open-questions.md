# 13 — Architectural Risks & Open Questions

Items #1, #9/#12 (task ownership), and #11 (personal assignment) below are **confirmed**
by you — kept in this list with their resolution recorded, not as open questions. Every
other item is still a default taken for the reasons stated; react to any of them before
Phase 1 starts.

| # | Topic | Decision | Alternative | Notes |
|---|---|---|---|---|
| 1 | Web vs mobile first | **CONFIRMED:** Next.js web app + shared backend/API/auth/authz contracts first. React Native/Expo mobile is a later phase, built as a first-class production client against those same contracts — not a stripped-down afterthought. | — | This is why `packages/shared` (schemas) and `packages/api-client` exist from day one (doc 09) even though only `apps/web` ships in Phase 1: the mobile app in Phase 4 consumes them unchanged rather than needing its own contract layer retrofitted. |
| 2 | ORM | Prisma | Drizzle | Prisma has better DX/migration tooling maturity today; Drizzle is lighter and edge-runtime-friendlier. Revisit only if we later need edge/streaming DB access Prisma can't do well. |
| 3 | Database/hosting | Supabase (managed Postgres+Auth+Storage) | Self-hosted Postgres + custom auth | Brief explicitly allows "Supabase where appropriate"; self-hosting adds ops burden with no stated requirement for it. |
| 4 | API architecture | REST via Next.js Route Handlers, one deployable | Separate standalone Node/Express API service from day one | Brief explicitly warns against over-engineering initial infra (§25); service layer is already extracted (`packages/domain`) so splitting later is low-cost. |
| 5 | Real-time updates | Polling/revalidation for MVP | Websockets/Supabase Realtime from Phase 1 | Not mentioned in the brief's requirements; live-collaboration cursors etc. aren't in scope. Notification-driven refresh covers the stated needs (§21). |
| 6 | Multiple Team Heads per team | Supported (`team_members.is_head` is per-row, not unique) | Exactly one head per team | §5/§9 examples always show one head, but nothing forbids co-heads (e.g. a deputy). Supporting it costs nothing extra in the schema; enforcing exactly-one would need a partial unique index and a "who takes precedence" rule with no basis in the brief. |
| 7 | Multi-org membership | Schema supports a user belonging to N organizations (`organization_members`) from day one | Restrict to one org per user | §34 explicitly lists this as future extensibility to architect for now — done at the schema level; UI (workspace switcher) needed regardless even for the single-org MVP case. |
| 8 | Decline → reassignment | Fully manual: task reverts to UNASSIGNED, assignor picks the next target | Auto-suggest or auto-reassign to a fallback | Rule 14 requires human approval for consequential decisions; auto-reassignment would be exactly that kind of silent decision. |
| 9/12 | "Task Owner" (reporting attribution) | **CONFIRMED:** attribute workload/reporting dashboards to the **current accountable owner** — the leaf of the active assignment chain (e.g. Management → Marketing Team → Marketing Head → Rahul counts as a Marketing/Rahul workload item). Origin (organization, origin department, creator, original assignor, full chain) is preserved separately and unaffected — see doc 01 §1.5 and doc 03 `tasks` table note. | — | Implemented as a derived query (`is_current = true` row), not a stored "owner" column, so it always reflects the live chain state without a second write path to keep in sync. |
| 10 | Voice task creation | Architecture reserves the extension point (an `input_modality` concept on the AI parse endpoint) but is not implemented | Build a voice input prototype now | §16/§34 explicitly say "architecture should support future implementation," not build now. |
| 11 | Personal-workspace assignment | **CONFIRMED:** personal-workspace tasks are self-assignment only. Any assignment to another person or team requires an organization context, which supports all six patterns from §4 (individual↔individual, individual→team, team↔individual, team↔team, cross-department) with acknowledgement required throughout. | — | See doc 01 §1.3 for the updated workspace description. Multi-person personal-project collaboration remains a named future extension point (was item #11 previously), not built now. |
| 13 | Timezones | Store all datetimes UTC; each user has `default_timezone`; org can optionally set an org-default | Org-enforced single timezone for all deadlines | Not specified in the brief; per-user timezone display is the safer default for a multi-department institution with possibly distributed staff. |
| 14 | External collaborators/guests, recurring tasks, automation rules, calendar/email/Slack integrations | Named as extension points only (doc 10 Phase 4), no schema built for them yet beyond what's naturally reusable (e.g. `notifications.delivery_channel`) | Reserve explicit schema columns/tables now | §34 says "do not implement all of these now... build clean extension points," which is what's done — over-building schema for unspecified future features risks guessing wrong and having to migrate anyway. |
| 15 | AI provider | Claude API (per brief §25/§12) | n/a | Not actually a risk — brief is explicit. Noted only to confirm model choice (e.g., which Claude model tier) will be a Phase 2 config decision, not architectural. |

## Remaining items to confirm or override

Items #1, #9/#12, and #11 are settled (above). Everything else (#2–8, #10, #13–15) can
proceed on the stated defaults and be revisited cheaply later — flag any of them now if
you'd rather decide upfront.
