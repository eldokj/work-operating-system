# Phase 7 Calendar & Meeting Integration Architecture

**Base commit:** `051ac12f18f87623ec137379d7585761f50450fb` (branch `master`, `origin/master` synchronized). **Status:** architecture only — no code, schema, migration, API, UI, config, dependency, or test change exists yet for anything in this document. Follows the same process as docs 17/19/21/24: investigation → proposal → explicit approval required before any implementation. Builds directly on [doc 25](25-phase7-product-capability-and-roadmap-assessment.md)'s conclusion (Calendar = highest-priority next capability, 7.10/10).

**Product framing, restated precisely:** this is not a calendar application. The goal is *"make the Work Operating System aware of the user's actual working day."* Every design decision below is judged against that one sentence, not against "what would a standalone calendar product need."

---

## 1. Fresh Codebase Inspection — What Actually Exists

Verified this session, not assumed from any prior document.

| Area | Status | Evidence |
|---|---|---|
| `User.defaultTimezone` | **IMPLEMENTED** | `schema.prisma:141`, `String @default("UTC")` — per-user, real, used throughout Phase 3/4 |
| Org/Department/Team timezone | **MISSING** | `grep -in timezone schema.prisma` returns only `User.defaultTimezone` and its own doc comments — no org/dept/team-level timezone field exists |
| `User.workingHours` | **IMPLEMENTED (advisory)** | `schema.prisma:143-147`, `Json?`, per-weekday `{start,end}`, "advisory input to capacity math only — never an enforcement boundary" (own doc comment, unchanged) |
| `local-day.ts` timezone utility | **IMPLEMENTED** | `resolveLocalDateString`/`resolveLocalDate` via `Intl.DateTimeFormat`, UTC fallback for invalid zones, 7 passing tests including a DST case |
| `Workday` (one row per user per local day) | **IMPLEMENTED** | `schema.prisma:944-970`, status derived from `startedAt`/`closedAt`, never stored |
| **`DailyPlanItem.scheduledStart`/`scheduledEnd`** | **PARTIALLY IMPLEMENTED — backend-complete, zero UI** | `schema.prisma:992-996` ("a hook a future Calendar phase can plot against with zero schema change"); accepted on create AND update (`daily-work.schema.ts:26-27`, `updateDailyPlanItemSchema`), persisted (`daily-work.service.ts:223-224,335-336`), returned by the API, even typed in `today/page.tsx`'s `DailyPlanItem` interface (line 24-25) — **but never read or rendered anywhere in that page's JSX.** This is the single most important finding in this report — see §4. |
| `ProjectDate` | **IMPLEMENTED (deliberately minimal)** | `schema.prisma:454-468` — `title`, `date` (`@db.Date`, no time-of-day), `notes`. Own doc comment: "deliberately not the Calendar module (no recurrence, no reminders, no time-of-day)" |
| `Project.kind = EVENT` | **IMPLEMENTED (label only)** | A `ProjectKind` enum value on `Project`, not a calendar entity |
| `TaskDependency` | **ARCHITECTED ONLY** (unchanged, not touched by this phase) | Confirmed unused again this session — relevant only to §12 |
| `NotificationService` / scheduler | **IMPLEMENTED** | Phase 6, unchanged — see §8 for reuse plan |
| `ReportingService` / scope engine | **IMPLEMENTED** | `resolveEffectivePermissions(grants, {departmentPathIds?, teamId?})` — pure, DB-free, reused by every resource type |
| **Privacy precedent for schedule data** | **IMPLEMENTED, binding precedent** | `tests/e2e/abc-college.e2e.test.ts:1791-1797` — an explicit, passing E2E assertion that `scheduledStart`/`scheduledEnd` (alongside `reflectionNote`) **never appear in any team report response today** (doc 21 §8's rule: personal planning order is private, never team-relevant). Any Calendar design that changes this must do so deliberately — see §7. |
| Calendar/Meeting model of any kind | **MISSING** | No `Meeting`/`CalendarEvent`/`Attendee`/`TimeBlock`/`Availability` model anywhere |
| App nav | **No Calendar entry** | `apps/web/app/(app)/layout.tsx:94-101` — Today, Dashboard, Tasks, Projects, Teams, Organization, Audit history, Notifications. Today page (`today/page.tsx`) is a three-tab Plan/Work/Close screen — the existing START→PLAN→EXECUTE→CLOSE hub |
| Task time-block API | **IMPLEMENTED, unused** | `PATCH /api/v1/workday-items/:itemId` already accepts `scheduledStart`/`scheduledEnd` via `updateDailyPlanItemSchema` — **zero new API needed for task time-blocking** |

**The single most consequential finding:** Phase 3 already built the entire backend for task time-blocking (`DailyPlanItem.scheduledStart`/`scheduledEnd`, full create/update support, zero schema change needed) specifically so a "future Calendar phase" wouldn't have to. Phase 7's job for *tasks* is almost entirely UI + capacity-math integration, not new backend. Phase 7's real new backend work is entirely about *meetings* — the one thing that has no existing representation at all.

---

## 2. Product Objective, Restated as Data Questions

| Question | Answered by |
|---|---|
| 1. What work exists? | `Task` (existing, unchanged) |
| 2. What work is due? | `Task.dueDate` (existing, unchanged) |
| 3. When is the user available? | `User.workingHours` (existing) **minus** new `CalendarEvent` occupied time (§5) |
| 4. What time is already occupied? | New `CalendarEvent` (meetings) **plus** existing `DailyPlanItem.scheduledStart/scheduledEnd` (task blocks) |
| 5. Which meetings/events consume capacity? | New `CalendarEvent`, scoped to the working-hours window (§7) |
| 6. Which tasks can realistically fit today? | Derived, read-time computation — not a new stored fact (§7) |
| 7. What should appear in the Daily Plan? | Unchanged — still `DailyPlanItem`, now optionally rendered alongside a day's `CalendarEvent`s (§9) |

No new entity is needed for questions 1, 2, 4 (task half), 6, or 7. Exactly one new entity (`CalendarEvent`) answers questions 4 (meeting half) and 5.

---

## 3. Calendar Events (§A) — What a v1 Event Needs

| Field the brief asks about | In v1? | Reasoning |
|---|---|---|
| title | Yes | Core |
| description | Yes | Core, optional |
| start/end time | Yes | Core — `DateTime` instants, never date-only (unlike `ProjectDate`) |
| timezone | Derived, not stored per-event | The organizer's `User.defaultTimezone` at creation time is enough for *display*; the stored instant is timezone-independent (§7) |
| all-day events | Yes, minimal | A boolean flag changes rendering only; still stored as instants (local-day midnight-to-midnight in the organizer's zone) — no parallel date-only column |
| location | Yes | Plain string, optional — a room name or address, not geocoded |
| meeting link | Yes | Plain string, optional — a URL, not validated/parsed |
| organizer | Yes | `organizerId → User`, required |
| participants | Yes, minimal | A join table, but **no per-participant RSVP state in v1** (§3.1) |
| status | Yes, minimal | `CONFIRMED` / `CANCELLED` only — no `TENTATIVE`, no per-participant response status |
| cancellation | Yes | Soft — `status = CANCELLED`, never a hard delete, matching this codebase's existing "tasks are never hard-deleted, only cancelled" convention (doc 05) applied identically here |

### 3.1 Participants — deliberately minimal

The brief's "status" and "participants" could imply full RSVP tracking (accepted/declined/tentative per person, mirroring `TaskAssignment`'s acknowledgement machinery). **Recommendation: do not build this in v1.** A join table (`CalendarEventParticipant`: `eventId`, `userId`) with no response-state column is enough to answer "who does this occupy time for" and "who can see this," which is all Phase 7's stated objective needs. RSVP workflows (accept/decline/tentative, "an event needs enough acceptances to be confirmed," calendar-conflict-aware invitations) are real Outlook/Google-shaped features, not required by "make the system aware of the user's actual working day," and are explicitly deferred (§14).

---

## 4. Calendar Views (§B)

**Recommended MVP: Day view only, embedded inside the existing Today page.** A dedicated `/calendar` route with week/agenda views is a reasonable, small v1.1 addition (see below) but is not required to deliver the core objective.

Reasoning: the product's own existing structure (`today/page.tsx`'s Plan/Work/Close tabs) is *already* the START→PLAN→EXECUTE→CLOSE hub. The highest-leverage Phase 7 UI change is showing a day's meetings **inside that existing screen**, next to the day's planned tasks — this is what directly answers "what does my day actually look like" (START) and "where can my work realistically fit" (PLAN). A separate calendar page that a user has to navigate to *instead of* Today would fragment exactly the "one place to run your day" promise this phase exists to serve.

- **Day view (in Today page):** MUST HAVE — a simple vertical timeline or a "meetings today" list alongside the existing Plan tab's task list.
- **Week view:** SHOULD HAVE, not MUST HAVE — useful for looking ahead, but not required to prove the core capacity-accuracy value. A candidate for a fast-follow within Phase 7 or the very next phase.
- **Agenda view (flat chronological list, meetings + tasks with due times mixed):** COULD HAVE — genuinely nice, low-cost once day/week views exist, not required for v1.
- **Month view:** explicitly **NOT in scope**. A month grid is a "calendar app" feature, not a "run your day" feature — it doesn't serve any of the five Daily Work Cycle stages directly, and building it would be exactly the "generic calendar application" the product objective explicitly says this phase is not.

---

## 5. Meetings — Representation Choice (§C)

**Recommendation: a dedicated `CalendarEvent` model, not a `Project` subtype and not overloading `ProjectDate`.**

Three options were weighed:
1. **Generic calendar events with a `type` discriminator** (e.g., `CalendarEvent.type = MEETING | BLOCK | REMINDER`) — rejected for v1 as premature generality; Phase 7 has exactly one kind of event (a meeting/time-block), and a discriminator column with one live value is speculative complexity with no current payoff. If a second event type appears later (e.g., a synced external calendar's "focus time" block), the model can grow a `type` column additively then — this is explicitly not a decision that needs to be made now.
2. **A dedicated `Meeting` model, separate from a generic event concept** — rejected as an unnecessary distinction; there is no Phase 7 behavior that differs between "a meeting" and "a calendar event" — they're the same thing under this MVP's scope. Keeping one model avoids a false conceptual split.
3. **`CalendarEvent` as its own model — chosen.** It is not `Project` (a `Project` is a durable unit of *work* with tasks, members, a lifecycle, a conversation; a meeting is a *time commitment*, with no task-like lifecycle) and it is not `ProjectDate` (a labeled milestone marker with no time-of-day, no attendees, no duration — extending it to carry all of Calendar's needs would break its own documented "deliberately not the Calendar module" contract and conflate two different concepts under one name).

**Naming/conceptual conflict check (explicitly requested):** `Project.kind = EVENT` is a real naming collision risk — a "Project (kind: EVENT)" and a "CalendarEvent" are two different things that could easily be confused by a future reader. Recommendation: keep `CalendarEvent`'s name exactly that (not `Event`) to stay unambiguous, and document the distinction once, prominently, in the eventual schema comment: *a Project with kind=EVENT is a multi-day, multi-task unit of organized work (e.g., "Annual Fundraiser"); a CalendarEvent is a single time-bounded meeting/commitment (e.g., "Budget Review Call, 2pm–3pm")*. A `CalendarEvent` MAY optionally reference a `Project` (`projectId`, nullable) — e.g., a meeting that's part of an Event-project's planning — but a `Project` never *contains* `CalendarEvent`s as a required relationship; the link is opportunistic context, not structural nesting.

---

## 6. Task ↔ Calendar (§D)

**Do not create a `TaskTimeBlock` model.** Activate `DailyPlanItem.scheduledStart`/`scheduledEnd` instead — they already exist, are already fully read/write-capable through `PATCH /api/v1/workday-items/:itemId`, and were purpose-built for exactly this (§1's key finding).

| Concept | Answer |
|---|---|
| Task scheduled time / task time block | `DailyPlanItem.scheduledStart`/`scheduledEnd` — reused, not duplicated |
| Calendar block linked to task | The same fields, on the same row that already links the task to a specific day (`DailyPlanItem.taskId`) — no separate "block" entity, no separate FK |
| Task deadline vs. scheduled execution time | Two already-distinct, already-correct fields on two different models: `Task.dueDate` (when it's due, task-level, permanent) vs. `DailyPlanItem.scheduledStart/scheduledEnd` (when I intend to work on it *today*, plan-level, per-occurrence) — this distinction already exists and needs no new design |
| Moving a task block / rescheduling | `PATCH /api/v1/workday-items/:itemId` with new `scheduledStart`/`scheduledEnd` — already supported |
| Task completion | Unchanged — `DailyPlanItem.status`/`completedAt`, independent of whether the item had a scheduled time |
| Planned vs. actual | Explicitly out of scope for Phase 7 (this is doc 25's Time Tracking territory — `startedAt`/`completedAt` already give a coarse actual-time signal; a real "planned vs. actual duration" comparison is deferred with Time Tracking, not built here) |

**What Phase 7 actually needs to add here:** a UI to set/see/drag a task's `scheduledStart`/`scheduledEnd` inside the Today page's Plan/Work views, and folding already-scheduled task blocks into the capacity calculation (§7) — no schema, no new API.

---

## 7. Daily Work Cycle Integration (§E)

| Stage | Question | How Calendar changes it |
|---|---|---|
| **START** | "What does my day actually look like?" | The Today page's opening view gains a merged timeline: today's `CalendarEvent`s (meetings) + today's scheduled `DailyPlanItem`s (task blocks) + today's unscheduled plan items — a single, honest picture, not a task list pretending meetings don't exist |
| **PLAN** | "Where can my work realistically fit?" | `computeCapacityMinutes` (existing function, `daily-work.service.ts:46`) gains one more subtraction term: meeting-occupied minutes within the working-hours window. Capacity becomes `workingHours-derived total − CalendarEvent overlap − already-planned DailyPlanItem minutes` (the last term already happens today) |
| **EXECUTE** | "What should I work on now?" | The Work tab can highlight the next scheduled block (task or meeting) chronologically — a UI ordering enhancement, no new data |
| **CLOSE** | "What remains unfinished and where should it go?" | Unchanged from Phase 3 — carry-forward/backlog/drop logic doesn't need to know about meetings; a meeting isn't a `DailyPlanItem` and has no "unfinished" state (it either happened or was cancelled) |

No change is needed to `Workday`'s own open/close semantics — a day's meetings are read-only context for planning/execution, never part of the open/close disposition flow.

---

## 8. Work Hours (§F)

**Reuse `User.workingHours` and `local-day.ts` unchanged.** No org-level timezone, no shift model, no holiday calendar.

- **Working hours:** already exists, already advisory-only (never an enforcement boundary — doc 19 §16/§22's own rule, correctly unchanged here). Calendar capacity math treats it exactly as `computeCapacityMinutes` already does today.
- **Time zones:** the organizer's `User.defaultTimezone` at creation determines how an event's stored instant is *displayed* to them; every other viewer sees the same instant converted to *their own* `defaultTimezone`, using the existing `local-day.ts` utilities — no new timezone abstraction (§10 goes deeper).
- **Weekends:** already handled by `workingHours`' per-weekday shape (a weekend day's entry can already express zero capacity) — nothing new needed.
- **Holidays:** explicitly **out of scope**. An organization-wide or region-specific holiday calendar is a real feature but has zero current signal of need, would require its own data model (a holiday calendar per org/region), and doesn't serve the "aware of the user's actual working day" objective any more precisely than a user simply not creating plan items that day. Defer indefinitely, revisit only if requested.
- **Shifts:** explicitly **out of scope** — multi-shift/rotating-schedule support is workforce-scheduling territory, not "run your day" territory. `workingHours`' existing per-weekday shape is sufficient for Phase 7's entire ambition.

---

## 9. Conflict Detection (§G)

**Recommendation: visual overlap indication only — YES. Enforcement/blocking — NO.**

This is a precise distinction, not a single yes/no:

- **YES, cheaply:** once a day view exists (§4), rendering two overlapping events/blocks stacked or flagged is nearly free — the query that builds the day's timeline already has every event's start/end; detecting overlap is a client-side or trivial server-side pass over data already being fetched. This should ship in v1 as a passive visual signal ("these overlap"), because it directly serves PLAN ("where can my work realistically fit") with near-zero added cost.
- **NO, deliberately, for enforcement:** actively preventing a user from creating an overlapping event/task-block (hard validation, rejecting the write) is explicitly **not** in scope for v1. Real calendars allow double-booking on purpose all the time (a tentative hold, a "I'll figure it out" block); enforcing non-overlap would be presumptuous and would require a whole "override this warning" UX Phase 7 doesn't need to build. **Event/event, task/event, and task/task overlap are all treated identically: shown, never blocked.**

---

## 10. Capacity (§H)

**Phase 7 calculates:**

```
Available minutes (today) =
  workingHours-derived capacity minutes (existing computeCapacityMinutes)
  − sum(CalendarEvent duration, clipped to the working-hours window, for CONFIRMED events the user organizes or participates in)
  − sum(DailyPlanItem.plannedDurationMinutes) [already computed today, unchanged]
```

**Deferred to Phase 8 (Time Tracking, per doc 25):** anything requiring *actual* elapsed time — planned-vs-actual variance, historical "how long did this really take" learning, utilization percentages. Phase 7's capacity number stays exactly what it is today (an advisory planning aid), just less fictional, because it now subtracts real meeting time instead of ignoring it. It does not become a tracked/measured/enforced figure — matching `workingHours`' own existing "advisory, never enforcement" principle, extended consistently rather than broken.

---

## 11. External Calendar Integration

**Not in the Phase 7 core MVP.** Evaluated individually, as required:

| Provider | Dependency | Complexity | Auth | Sync model | Webhooks | Security | Phase 7? |
|---|---|---|---|---|---|---|---|
| **Google Calendar** | Google Calendar API client, OAuth library | High — token storage, refresh, scope management, rate limits, mapping Google's recurrence/exception model onto whatever internal model exists | OAuth 2.0, per-user consent, refresh-token storage (a new sensitive-data category this codebase has never handled — no OAuth token storage exists anywhere today) | Push (webhook/watch channel) preferred over polling at scale, but push requires a publicly reachable HTTPS endpoint — which this product doesn't have (doc 25 §3G: no deployment target, no public URL) | Requires a stable public webhook receiver — blocked on the same missing production infrastructure doc 25 already flagged | New: token theft/leak risk, scope-creep risk (Google Calendar OAuth scopes often request more than strictly needed), a new external data-residency/compliance surface | **No** |
| **Microsoft Outlook/365** | Microsoft Graph API client, MSAL | High — comparable to Google's, plus Graph's own delta-query/subscription model | OAuth 2.0 via Microsoft identity platform, same refresh-token storage problem as Google | Delta queries or webhook subscriptions — same public-endpoint requirement as Google | Same blocker as Google | Same class of risk as Google | **No** |
| **ICS import/export** | None (a well-known text format, no external API) | Low — a one-way export (generate a `.ics` file/URL for a user's own events) is genuinely simple; two-way *import* (parsing arbitrary external `.ics` feeds, reconciling with internal events) is meaningfully harder | None for export; none for import beyond fetching a URL | One-way export: trivial (regenerate on request). One-way import: periodic poll of a subscribed `.ics` URL — no webhook needed | Not required | Low — no OAuth, no token storage, worst case is malformed input parsing (bounded, sanitizable) | **Plausible fast-follow, still not core MVP** — export specifically is cheap enough to consider immediately after v1 lands, but is not required to prove the core objective |

**Verdict, per the brief's explicit instruction:** none of Google/Microsoft sync is essential to the MVP's stated goal — "aware of the user's actual working day" is fully served by an internal calendar that captures meetings *created in this system*. Real dependency evidence (no OAuth infrastructure, no public webhook endpoint, no production deployment target — all independently confirmed in doc 25 §3G) makes external sync **actively blocked**, not merely deferred by preference. **Design choice for forward-compatibility, at near-zero cost:** reserve two nullable columns on `CalendarEvent` now — `externalProvider` (string, e.g. `"google"`/`"outlook"`, null for internally-created events) and `externalEventId` (string, null unless synced) — architected exactly like `DeliveryChannel.PUSH`/`.EMAIL` already are in this codebase: declared, unused, a named extension point, not wired to anything. This avoids a future migration purely to distinguish synced-vs-native events without building any sync logic now.

---

## 12. Data Model

**Two new tables. Nothing else.**

```
CalendarEvent
  id                String   @id
  workspaceId       String            // tenant scope — same pattern as Task/Project
  organizerId       String            // → User
  projectId         String?           // optional context link, never structural nesting (§5)
  title             String
  description       String?
  startAt           DateTime          // instant, not date-only (unlike ProjectDate)
  endAt             DateTime
  isAllDay          Boolean  @default(false)
  location          String?
  meetingLink       String?
  status            CalendarEventStatus @default(CONFIRMED)  // CONFIRMED | CANCELLED
  visibility        CalendarEventVisibility @default(PRIVATE) // PRIVATE | ORGANIZATION_VISIBLE — §13
  externalProvider  String?           // reserved, unused — §11
  externalEventId   String?           // reserved, unused — §11
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  workspace   Workspace
  organizer   User
  project     Project?
  participants CalendarEventParticipant[]

  @@index([workspaceId, startAt])   // day/week range queries — §16
  @@index([organizerId, startAt])

CalendarEventParticipant
  id       String @id
  eventId  String
  userId   String

  event CalendarEvent @relation(..., onDelete: Cascade)
  user  User

  @@unique([eventId, userId])
  @@index([userId])                 // "my events" queries
```

**Explicitly not created:** a `Calendar` container model (v1 is "one implicit calendar per workspace," matching the existing "one Workday per user per day" simplicity principle — a `Calendar` entity only earns its place once multiple source calendars per user exist, i.e., once external sync is real, which §11 shows is not now); `TaskTimeBlock` (§6 — reuses `DailyPlanItem` instead); `EventRecurrence` (§14 — Phase 8's job); a dedicated `Meeting` model distinct from `CalendarEvent` (§5).

**Ownership / scope:**
- `CalendarEvent.workspaceId` scopes it to a workspace exactly like `Task`/`Project` — an organization-workspace event is visible only within that org's authorization boundary; a personal-workspace event (a solo user's own meeting/block) follows the same personal-workspace rules already established for tasks (doc 13 #11 — self-only, no cross-user assignment).
- `organizerId` is the accountable owner — the one role every event has, unconditionally (parallel to `Task.createdById`).
- `participants` is a flat list — no team/department-level "invite a whole team" shortcut in v1 (a team-targeted meeting invite is a reasonable future enhancement, not required now — participants are always individual users).
- A `CalendarEvent` may reference a `Project` for context (§5) but a `Project` has no reciprocal required field — the relationship is optional and one-directional in practice (queried from the event's side).

---

## 13. Authorization

**Core principle, stated once and enforced everywhere in this design, directly generalizing Phase 6's "a notification is a disclosure" rule: a calendar event — including the mere fact that someone is busy at a given time — is a disclosure.**

Two independent, composable layers, exactly as the brief demands ("reporting visibility must not automatically imply calendar visibility"):

1. **Full detail access:** the organizer and every listed participant can always see an event's full detail (title, description, location, link, other participants) — the same "if you're a party to it, you can see it" rule `canViewTask`/`canAccessConversation` already apply to tasks and conversations.
2. **Visibility flag (`PRIVATE` default / `ORGANIZATION_VISIBLE`):** a `PRIVATE` event (the default — opt-in exposure, never opt-out) is visible in full **only** to organizer + participants, full stop — not even to an `ORG_ADMIN` with unscoped `REPORTS_VIEW`. An `ORGANIZATION_VISIBLE` event (explicitly marked so by its organizer) is visible in full to anyone who could already see the organizer's work through existing task/project authorization at that scope.

**The specific rule the brief asks for by name — reporting visibility must not automatically become calendar visibility:** a manager holding `REPORTS_VIEW` at team scope (the exact grant Phase 4's dashboards already use) gains **no automatic access to event titles/descriptions/participants of a team member's `PRIVATE` events.** The most `REPORTS_VIEW` alone should ever unlock — and only as a *new, explicitly separate* capability check, never bundled into `REPORTS_VIEW` itself — is a coarse **free/busy** signal (a boolean "occupied 2–3pm," no title, no attendees) for capacity-reporting purposes (e.g., a future "team capacity today" view). This mirrors real calendar systems' own free/busy federation model and is the direct, evidence-grounded answer to the brief's caution.

**Binding precedent this design must not silently break (§1's key finding):** `scheduledStart`/`scheduledEnd` on `DailyPlanItem` are *already*, today, excluded from every report response (the passing E2E test at `abc-college.e2e.test.ts:1791-1797`). Phase 7 does not change this. A person's task time-blocks stay exactly as private as they are today; only genuinely new data (`CalendarEvent`) gets the visibility model above. If a future phase wants task-block-aware team capacity views, that is a deliberate, separate decision to revisit doc 21 §8's rule — not a side effect of this phase.

**Concretely, per role, applying the visibility model above (not a new hardcoded role check — the same capability-key + scope-resolution engine every other resource uses, per doc 21 §9's own non-negotiable rule):**

| Role | Own events | Others' `PRIVATE` events | Others' `ORGANIZATION_VISIBLE` events | Free/busy (new, separate capability) |
|---|---|---|---|---|
| Anyone (self) | Full | N/A | N/A | N/A |
| Organizer/participant of a specific event | Full | Full, for that event only | Full | N/A |
| `TEAM_HEAD`/`MANAGER`/`DEPARTMENT_HEAD`/`ORG_ADMIN` with `REPORTS_VIEW` at matching scope | Full (own) | **None** | Full, if the org-visible event's organizer is within their scope | Possible, only via a distinct future capability key — not built in Phase 7's MVP; noted as the natural extension point |

**API/tenant isolation:** every new route re-derives `workspaceId`/organization membership from the authenticated session exactly like every existing route (`assertOrgMember` first, always) — no client-supplied workspace/org id is ever trusted at face value, matching the unbroken pattern across all prior phases.

**Future external OAuth (§11):** flagged, not designed — token storage would be a wholly new sensitive-data category requiring its own security review before implementation, independent of and in addition to everything in this section.

**Auditability:** see §15.

---

## 14. Timezone / Date-Time Strategy

**One rule, reused unchanged from doc 19/21: every stored instant is a plain UTC-backed `DateTime`; every timezone decision happens at read/display time, resolved per-viewer via their own `User.defaultTimezone` through the existing `local-day.ts` utilities. No second time abstraction is introduced.**

- **Database timestamps:** `CalendarEvent.startAt`/`endAt` are `DateTime` (instants), exactly like `Task.dueDate` — never `@db.Date` like `ProjectDate`/`Workday.workDate` (those intentionally have no time component; an event's whole reason for existing is its time component).
- **User timezone:** the organizer's `defaultTimezone` at creation time is used only to interpret what the *organizer* meant by "2pm" when creating the event through a UI that collects a local wall-clock time — the stored value is the resulting instant, timezone-free. Every subsequent viewer's UI converts that same instant into *their own* `defaultTimezone` for display — this is definitionally how a cross-timezone meeting is supposed to work, and it falls out of the existing model with no new code.
- **Organization timezone:** not introduced, matching doc 21 §10's explicit, already-validated finding that no org/team-wide clock has ever been needed anywhere in this system — every date-sensitive computation resolves to an individual `User`, and Calendar does not change that.
- **All-day events:** stored as instants at local-day midnight-to-midnight *in the organizer's timezone* (reusing `resolveLocalDate` from `local-day.ts` at creation time), with `isAllDay = true` changing only how it's *rendered* (a full-day bar, not a timed slot) — never a parallel date-only storage path.
- **DST:** handled for free by storing instants and using `Intl.DateTimeFormat`-backed conversion at display time (exactly as `local-day.ts` already does, DST-tested) — no manual offset math anywhere, matching the existing, unbroken discipline.
- **Cross-timezone meetings:** no special handling needed beyond the above — an event has one true instant; "what time does this look like to me" is purely a per-viewer display computation, never stored per-participant.

---

## 15. Notification Strategy

**Reuse `NotificationService`/`NotificationType` and the Phase 6 scheduler exactly as they exist. No second notification system.**

Evaluated candidates, applying Phase 6's own explicit lesson ("do not add unnecessary notification types"):

| Candidate | Phase 7? | Reasoning |
|---|---|---|
| Meeting starting soon | **Yes** | Directly mirrors `DEADLINE_APPROACHING`'s existing pattern — same scheduler shape (a bounded, indexed, idempotent-marker-based tick), same "current accountable party" recipient rule (organizer + participants), same 15-minute cadence. One new `NotificationType` value (`MEETING_STARTING_SOON`), one new scheduled check function alongside the two Phase 6 already built — not a new subsystem. |
| Event cancelled | **Yes** | A genuine information-disclosure-relevant change (someone planned around this time) with a clear, bounded recipient set (participants) — cheap, high-value, mirrors `TASK_REASSIGNED`'s "tell the affected party" pattern. |
| Event changed (time/location edited) | **Defer** (COULD HAVE) | Real value, but adds scope (diffing what changed, deciding which edits are notify-worthy) without being required to prove the core objective; a fast-follow once the base event CRUD exists. |
| Participant added | **Defer** (COULD HAVE) | Same reasoning — genuinely useful, not required for v1, easy to add later using the exact same `notify()` call shape once it's prioritized. |

**Scheduler integration:** `MEETING_STARTING_SOON` reuses `runScheduledChecks`'s existing tick shape (§ in doc 24) — one more bounded query (`CalendarEvent` where `startAt` is within a short lookahead window, e.g. 10-15 minutes, status `CONFIRMED`, not yet notified) plus one more idempotency marker column (`startingSoonNotifiedAt`, nullable, same conditional-claim pattern doc 24 §8 already established) — not a new execution model.

---

## 16. Audit Strategy

**Reuse `AuditService`/`AuditLog` exactly.** New `entityType: "CalendarEvent"`, same `before`/`after`/`reason`/`source` shape every other mutation already uses.

Actions requiring an audit entry, mirroring the existing task/assignment granularity:
- `calendar_event.created`
- `calendar_event.updated` (time/location/link/description changes)
- `calendar_event.cancelled`
- `calendar_event.participant_added` / `calendar_event.participant_removed`
- Task rescheduling (`scheduledStart`/`scheduledEnd` changes on `DailyPlanItem`) — **already covered**: `DailyPlanItem` updates do not currently emit a dedicated audit action distinct from the item's own existence (per Phase 3's design, its full history is reconstructable from the row itself plus the existing audit trail for the underlying task) — Phase 7 does not need to change this; a scheduled-time edit is a low-stakes, frequently-changing planning detail, not the kind of accountability-relevant event the audit log exists to capture (consistent with `reflectionNote` and `position` also not being individually audited today).

`AuditLog.taskId`/`.projectId` nullable-additive-column pattern (already used twice, Phase 2A and 2C) extends a third time: a nullable `AuditLog.calendarEventId` column, following the exact precedent, giving a `CalendarEvent`'s full activity history as one indexed query, never a parallel event-sourcing table.

---

## 17. Daily Plan Integration — Source of Truth

**Explicit answer, as required:** `CalendarEvent` and `DailyPlanItem` remain **separate, never merged, reconciled only at read time.**

- `CalendarEvent` is the sole source of truth for meetings/non-task time commitments.
- `DailyPlanItem` (with its existing `scheduledStart`/`scheduledEnd`) is the sole source of truth for task work blocks.
- **Calendar blocks do not create `DailyPlanItem`s** — a meeting is not a task and gets no task-shaped representation (no status, no carry-forward, no completion).
- **`DailyPlanItem`s do not create `CalendarEvent`s** — a task time-block is not a meeting and doesn't need attendees/location/a meeting link.
- **They "become one" only in a read-time view**: a new query (`GET /api/v1/calendar/day?date=`, §18) merges both into one chronological timeline for display — the merge exists in the API response shape, never in storage. This is the same discipline `ReportingService` already applies (doc 21 §11: "reporting visibility is a projection of the Work Graph, never a second source of truth") — generalized here to a day's timeline being a projection over two sources, not a new source itself.

This avoids every category of duplicated-state bug (two rows disagreeing about the same commitment) by construction — there is structurally only ever one row representing any given fact.

---

## 18. API Architecture (Design Only)

Following the existing `withAuth`/`parseJsonBody`/`parseQuery` convention (`apps/web/lib/api.ts`) exactly — every handler is a thin wrapper delegating to a new `CalendarService` in `packages/domain`, which itself follows every existing service's shape (`assertOrgMember` first, `PermissionService.assertCan`/predicate check second, mutation third, audit fourth, notify fifth).

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/v1/calendar/events?workspaceId=&from=&to=` | Bounded range query (day/week/agenda) — the one range-query endpoint this phase needs; not paginated (a day/week's event count is human-scale, same reasoning doc 19 §29 already applied to a day's plan) |
| `POST` | `/api/v1/calendar/events` | Create |
| `GET` | `/api/v1/calendar/events/:eventId` | Detail |
| `PATCH` | `/api/v1/calendar/events/:eventId` | Update (time/location/link/description/visibility) |
| `POST` | `/api/v1/calendar/events/:eventId/cancel` | Soft-cancel, never `DELETE` (§3) |
| `POST` | `/api/v1/calendar/events/:eventId/participants` | Add participant(s) |
| `DELETE` | `/api/v1/calendar/events/:eventId/participants/:userId` | Remove a participant |
| `GET` | `/api/v1/calendar/day?workspaceId=&date=` | The merged day-timeline read (§17) — events + scheduled `DailyPlanItem`s + capacity figure, one response, the actual thing the Today page renders |

**Explicitly not built:** an availability/conflict-check endpoint (§9 — conflict is a client-side rendering concern over data already fetched, not a server-side computation worth its own route); any endpoint for external-provider sync (§11); any recurrence-related endpoint (§14/doc 25 Phase 8).

**Task scheduling itself needs zero new endpoint** — `PATCH /api/v1/workday-items/:itemId` already accepts `scheduledStart`/`scheduledEnd` (§1, §6).

---

## 19. UI Architecture (Design Only)

- **Navigation:** no new top-level nav item required for v1 — the day view lives inside the existing **Today** page (`apps/web/app/(app)/layout.tsx`'s nav stays unchanged for the MVP). If/when a week/agenda view is built (§4, SHOULD HAVE), *that* is the point a `Calendar` nav entry earns its place, placed adjacent to `Today` — not before.
- **Day view:** a new section within Today's existing Plan/Work tabs — a simple vertical timeline rendering `CalendarEvent`s and scheduled `DailyPlanItem`s from the new merged `/api/v1/calendar/day` response, with unscheduled plan items shown separately (as today), exactly matching this page's existing "sections, not a second task system" design principle (its own doc comment, `today/page.tsx:55-57`, unchanged as a governing constraint for this addition too).
- **Event creation/editing:** a lightweight modal/form (title, start/end, location, link, participants, visibility) — reuses this app's existing form patterns (matching `QuickTaskBar`'s existing lightweight-creation precedent), not a new design language.
- **Task time-block visualization:** dragging/setting a plan item's time within the existing Plan tab — an incremental addition to an existing component, not a new page.
- **Mobile/responsive:** the existing app is already responsive (Tailwind-based, per `apps/web/app/globals.css`/component conventions); a day timeline is one of the more mobile-friendly UI shapes (a vertical list), so no special-casing is anticipated — full responsive verification happens at implementation time, not architecture time.
- **Explicitly not built:** any month-grid component, any drag-and-drop cross-day rescheduling UI (single-day-at-a-time is enough for v1), any dedicated settings page for calendar preferences beyond what `workingHours` already covers.

**Governing constraint, restated:** Calendar supports the Today page; it does not become a competing destination. If a future need for a dedicated `/calendar` page grows past what fits inside Today, that is a v1.1/Phase-8-adjacent decision, not a Phase 7 one.

---

## 20. Security

- **Tenant isolation:** `CalendarEvent.workspaceId` + `assertOrgMember` on every route, identical to every existing resource — no new isolation mechanism, no new risk class.
- **Private calendar data:** the default-`PRIVATE` visibility model (§13) is the load-bearing protection — must be implemented before any read path ships, not added after.
- **Participant authorization:** every read of an event's full detail must re-check organizer-or-participant membership (or `ORGANIZATION_VISIBLE` + matching scope) server-side, never trust a client-supplied "I'm a participant" claim.
- **Task-linked calendar visibility:** unchanged — a task's own `canViewTask` rule governs the task; the *scheduling* fields on `DailyPlanItem` stay under the existing, more restrictive "owner only" rule (§13's binding precedent), not the task's own broader visibility.
- **Organization/manager/department/cross-department visibility:** governed entirely by §13's table — no `REPORTS_VIEW`-implies-calendar-access shortcut anywhere.
- **API authorization:** identical pattern to every existing route (§18).
- **Future external OAuth:** flagged as a distinct future security review (§11/§13) — token storage is new sensitive-data territory this codebase has never had to handle, and must not be treated as "just another integration" when it's actually designed.
- **Auditability:** §16.
- **Security prerequisite before implementation:** none of doc 25's flagged items (RLS, production hardening) block Phase 7 specifically — Calendar's own visibility model (§13) is self-contained and reuses the existing, already-tested authorization engine. The one true prerequisite is disciplinary, not infrastructural: whoever implements this must treat §13 as non-negotiable from the first commit, the same way Phase 6's "notification is a disclosure" principle was treated — not bolted on after a working prototype.

---

## 21. Performance

- **Day/week queries:** `@@index([workspaceId, startAt])` and `@@index([organizerId, startAt])` make both "everything in this workspace during range X" and "my own events during range X" indexed range scans — the same shape as `@@index([dueDate])` Phase 6 already added to `Task`.
- **Large organizations / many events:** at v1 scope (no external sync, no recurrence, human-created meetings only), event volume per workspace is bounded the same way task volume already is — no different order of magnitude than what `ReportingService` already handles comfortably (doc 21 §18's own scale reasoning applies unchanged).
- **Overlapping events:** detected client-side or in a cheap in-memory pass over an already-fetched day's events (§9) — not a database-level computation, so no special index/query concern.
- **Pagination:** the day/week range endpoint is unpaginated by design (§18), matching the same "human-scale, unpaginated" precedent doc 19 §29 and Phase 5's search already established for bounded, per-day/per-view result sets.
- **Timezone conversion:** happens client-side at display time (per-viewer), or via the same cheap `Intl.DateTimeFormat` calls `local-day.ts` already makes server-side when needed — no new performance surface.
- **Recurring future queries:** not applicable — no recurrence in Phase 7 (§14/doc 25).
- **Task/calendar joins:** the merged day view (§17/§18) does two independent, already-indexed queries (`CalendarEvent` by workspace+range, `DailyPlanItem` by workday) and merges in application code — never a SQL join across the two tables, avoiding any risk of an expensive cross-model query plan.

No premature optimization (materialized views, caching layers, denormalization) is proposed — matching doc 21 §11's explicit precedent that real-time queries are preferred until a demonstrated need exists.

---

## 22. Testing Strategy (Design Only)

- **Domain unit tests:** `CalendarService` method-level tests (create/update/cancel/participant management) mirroring `assignment-authorization.test.ts`'s pure-logic style where possible; capacity-calculation tests (working hours minus meeting overlap minus planned minutes) as pure-function tests, mirroring `daily-work.service.ts`'s own `computeCapacityMinutes` test style.
- **API tests:** covered by the E2E suite (this codebase's established pattern — no separate API-only test layer exists today, and Phase 7 shouldn't introduce one).
- **Authorization tests:** the full §13 matrix as explicit E2E scenarios — organizer/participant full access; unrelated org member denied; `PRIVATE` event invisible to a `REPORTS_VIEW`-holding manager (the single most important test in this whole phase, directly proving the brief's own stated caution); `ORGANIZATION_VISIBLE` event visible to matching scope; cross-tenant denial (mirroring every prior phase's cross-tenant 403 pattern).
- **Timezone tests:** extending `local-day.test.ts`'s existing non-UTC/DST fixtures to a cross-timezone meeting scenario (organizer in one zone, participant in another, both see the correct local time for the same instant); an all-day event's midnight-to-midnight boundary in a non-UTC zone.
- **Overlap/conflict tests:** confirm the day-view response correctly flags overlapping entries without rejecting/blocking their creation (§9).
- **Task/calendar integration tests:** confirm `PATCH /api/v1/workday-items/:itemId` still behaves exactly as today for `scheduledStart`/`scheduledEnd` (regression — this is pre-existing, untouched functionality being activated in the UI, not changed at the API layer) plus a new test that the merged day view correctly includes a scheduled plan item alongside calendar events.
- **DailyPlan integration tests:** confirm the private-schedule-data exclusion from reporting (`abc-college.e2e.test.ts:1791-1797`) still passes unmodified — this is the binding regression guard for §13's precedent.
- **Tenant isolation tests:** cross-org calendar event access denied, matching every prior phase's pattern exactly.
- **Browser tests:** manual/exploratory verification of the Today page's new day-timeline rendering, responsive behavior, and event-creation modal — this codebase has no existing automated browser-UI test layer (E2E tests drive the HTTP API directly, not a browser), so Phase 7 doesn't introduce one either, consistent with every prior phase.

---

## 23. Phase 7 Implementation Boundary

**IN SCOPE:**
- `CalendarEvent`/`CalendarEventParticipant` models (§12), with reserved-but-unused `externalProvider`/`externalEventId` columns (§11).
- Full CRUD + cancel + participant management via `CalendarService` and the API surface in §18.
- Day-view merge endpoint (`GET /api/v1/calendar/day`) combining `CalendarEvent`s and scheduled `DailyPlanItem`s.
- Visibility model (`PRIVATE`/`ORGANIZATION_VISIBLE`) and its full authorization enforcement (§13).
- Capacity formula extension (§10) — one new subtraction term in the existing capacity computation.
- `MEETING_STARTING_SOON` and event-cancelled notifications, reusing `NotificationService`/the scheduler (§15).
- Audit logging for all calendar mutations, reusing `AuditService` (§16).
- Today-page UI: day timeline (meetings + scheduled task blocks), event creation/edit modal, task time-block setting UI activating the already-existing `scheduledStart`/`scheduledEnd` fields.
- Visual (non-blocking) overlap indication (§9).

**OUT OF SCOPE (explicit non-goals):**
- Google Calendar / Microsoft Outlook / any external sync (§11) — blocked on missing OAuth infrastructure and a public deployment target, not merely deprioritized.
- ICS export/import — plausible near-term fast-follow, not core MVP.
- Meeting/event recurrence of any kind (Phase 8's job, per doc 25).
- Per-participant RSVP tracking (accept/decline/tentative) — §3.1.
- Conflict *enforcement*/blocking (only visual indication ships, §9).
- Week/agenda/month calendar views — week is a plausible fast-follow; month is explicitly rejected as out of the product's stated ambition (§4).
- A `Calendar` container model (multiple calendars per user) — only relevant once external sync is real (§12).
- `TaskTimeBlock` or any parallel task-scheduling entity — reuses `DailyPlanItem` (§6).
- Team-targeted meeting invites (inviting a whole team as a unit, mirroring `TaskAssignment`'s team-assignment pattern) — participants stay individual-only in v1.
- Any free/busy manager-facing capability (§13's table names it as a future extension point, not built now).
- Holidays, shifts, multi-timezone organization-wide scheduling policy (§8).
- Any AI or voice interaction with calendar data (Phases 10/11, per doc 25 — see §24).
- Any change to `TaskDependency`/recurring-work infrastructure (Phases 8/9, untouched by this phase, per §24/§25).

---

## 24. Dependencies

- **None blocking.** Every reused piece (`local-day.ts`, `PermissionService`/scope engine, `NotificationService`, the Phase 6 scheduler, `AuditService`, the `withAuth`/`parseJsonBody` API convention, `DailyPlanItem.scheduledStart/scheduledEnd`) already exists and is already in production-quality shape within this codebase.
- **Soft dependency, not blocking:** doc 25's flagged Production Infrastructure gap (no deployment target, no public endpoint) blocks *external* calendar sync specifically (§11) but does not block the internal-MVP scope defined here.

---

## 25. Risks

| Risk | Mitigation |
|---|---|
| Calendar visibility model implemented loosely (e.g., `REPORTS_VIEW` accidentally treated as sufficient for event detail) | §13's explicit table + a dedicated, first-class E2E test proving a manager cannot see a `PRIVATE` event's detail — treat this as a launch-blocking test, not a nice-to-have |
| `DailyPlanItem.scheduledStart`/`scheduledEnd` exposure inadvertently changes when Calendar UI starts using them (e.g., a new endpoint accidentally surfaces them in a report) | The existing regression test (`abc-college.e2e.test.ts:1791-1797`) must be kept green throughout implementation — it is the concrete tripwire for this exact risk |
| Naming confusion between `Project.kind=EVENT` and `CalendarEvent` | Resolved at design time (§5) with explicit, distinct naming and a documented schema comment — implementation should not deviate from this naming decision |
| Scope creep toward a "real" calendar product (month view, external sync, recurrence) mid-implementation | §23's explicit non-goals list exists specifically to be pointed at during implementation-time scope discussions |
| Capacity formula double-counting (e.g., a task block inside a meeting time both being subtracted) | The formula (§10) subtracts meeting time and planned-item time as two independent terms over disjoint time categories (meetings vs. task work) — if a task block is scheduled *during* a meeting (a real possibility with no enforcement, per §9), this is a legitimate double-booking the UI should visually flag (§9), not a math bug to silently correct |

---

## 26. AI/Voice Future Readiness

AI is not built in Phase 7 (doc 25). This design ensures Calendar data is safely AI-ready when Phase 10 arrives, without building anything AI-specific now:

- **`CalendarService`'s methods are the future AI tools, unmodified.** A future "what does my day look like" AI answer calls the exact same `GET /api/v1/calendar/day` logic (or its underlying service method) a human's own UI calls — same authorization, same visibility rules, same data. No parallel "AI calendar reader" is ever built.
- **"When can I do this task?" / "Can I fit this task in today?"** are answerable by composing two already-designed pieces: the capacity formula (§10) and the day view (§17) — a future AI tool is a *caller* of these, never a reimplementation.
- **"What should I move?"** requires reasoning across `DailyPlanItem`s and `CalendarEvent`s together — exactly the shape the merged day-view response (§18) already produces, so a future AI tool consumes one existing endpoint's output rather than needing new backend work.
- **"Plan my day"** (a write action) must, per doc 25 §13's own governing pipeline, go through `PROPOSE → CONFIRM → EXECUTE → VERIFY → AUDIT` — `EXECUTE` here means calling the exact same `CalendarService`/`DailyWorkService` mutation methods a human's own click would call, and `AUDIT` means the already-reserved `AuditSource.AI` value (confirmed unused today, §1) — Phase 7 introduces nothing that would need to change for this to work later.
- **Nothing in this design requires AI-specific schema.** The reserved `externalProvider`/`externalEventId` columns (§11) are the only "for later" additions, and they're about external sync, not AI.

Voice (Phase 11, per doc 25) needs nothing further from Calendar specifically beyond what Phase 10's AI tool architecture already provides — Calendar data reaches voice exactly the way it reaches AI, which is exactly the way it reaches a human's own UI: through the same authorization-checked service methods, never a shortcut.

---

## 27. Recommended Implementation Sequence

1. **Schema** — `CalendarEvent`/`CalendarEventParticipant` + two enums (`CalendarEventStatus`, `CalendarEventVisibility`) + the nullable `AuditLog.calendarEventId` column (§16) + the two reserved external-sync columns (§11); additive migration, hand-written per this project's established pattern.
2. **`CalendarService`** — CRUD, cancel, participant management, each method starting with `assertOrgMember`/personal-workspace-ownership check, then the §13 visibility/authorization logic, mirroring `AssignmentService`'s own structure.
3. **Capacity formula extension** — add the meeting-overlap subtraction term to `computeCapacityMinutes`'s call sites (or the function itself, decided at implementation time), unit-tested in isolation first.
4. **API routes** (§18) — thin wrappers, identical convention to every existing route.
5. **Day-view merge endpoint** — composes `CalendarService` + existing `DailyWorkService` reads, no new authorization logic of its own (delegates entirely to the two services it composes).
6. **Notifications** — `MEETING_STARTING_SOON` scheduled check (extends `scheduler.service.ts` with one more tick function, reusing its exact idempotency pattern) + event-cancelled trigger inside `CalendarService.cancel`.
7. **Audit** — wire every mutation through `AuditService`, matching §16.
8. **UI** — Today page day-timeline section, event creation/edit modal, task time-block UI activating existing fields.
9. **Tests** — the full matrix from §22, with the §13 authorization scenarios and the §1/§25 regression guard (private schedule data exclusion) treated as launch-blocking.
10. **Security review** — a dedicated self-review pass against §20/§13, matching every prior phase's pre-commit discipline (Phase 6's own audit process is the direct precedent).
11. **Production build, full test suite, final diff audit, commit, push** — only following this project's established, unchanged process (approval gates at each step, never automatic).

---

## 28. Final Architecture Decision

1. **Recommended Calendar architecture:** an internal-only `CalendarEvent`/`CalendarEventParticipant` model, authorization-composed with the existing capability/scope engine, reusing `DailyPlanItem.scheduledStart/scheduledEnd` for task-side time-blocking rather than duplicating it — no external sync, no recurrence, no month view.
2. **Recommended data model:** exactly the two tables in §12, plus two Prisma enums — nothing else, and explicitly not a `Calendar` container, `TaskTimeBlock`, or dedicated `Meeting` model.
3. **Recommended API surface:** the eight routes in §18, all following the existing `withAuth` convention — no availability/conflict-check endpoint, no sync endpoint.
4. **Recommended UI:** a day timeline embedded in the existing Today page (§19) — no new top-level nav item, no dedicated calendar page in v1.
5. **Authorization model:** organizer/participant full access + default-`PRIVATE`/opt-in-`ORGANIZATION_VISIBLE` visibility, with `REPORTS_VIEW` explicitly never implying calendar detail access (§13) — the single most important decision in this report.
6. **Timezone strategy:** instants stored, per-viewer display conversion via existing `local-day.ts`/`User.defaultTimezone` — no new time abstraction, no org-level timezone (§14).
7. **DailyPlan integration strategy:** `CalendarEvent` and `DailyPlanItem` stay permanently separate sources of truth, reconciled only in a read-time merged view (§17) — never synchronized/duplicated state.
8. **Notification strategy:** two new types (`MEETING_STARTING_SOON`, event-cancelled) reusing `NotificationService` and one more scheduler tick function — event-changed and participant-added deferred (§15).
9. **Audit strategy:** reuse `AuditService` with a new `entityType`/nullable `calendarEventId` column, following the exact Phase 2A/2C precedent (§16).
10. **Phase 7 MVP:** §23's IN SCOPE list — internal events, participants (no RSVP), day view inside Today, capacity integration, visual-only conflict indication, two notification types, full audit.
11. **Explicit Phase 7 non-goals:** §23's OUT OF SCOPE list — external sync, recurrence, RSVP tracking, conflict enforcement, week/month views, a `Calendar` container model, team-targeted invites, free/busy manager views, holidays/shifts, any AI/voice touch.
12. **Dependencies:** none blocking (§24).
13. **Risks:** §25 — the visibility-model discipline and the existing privacy-regression test are the two risks that matter most.
14. **Testing strategy:** §22, with the authorization matrix and the private-schedule-data regression test treated as launch-blocking, not optional.
15. **AI/Voice future readiness:** §26 — every future AI/voice calendar capability is a caller of `CalendarService`'s existing, authorization-checked methods; nothing AI-specific is built or scaffolded now.
16. **Recommended implementation sequence:** §27.

This is an architecture design only. Implementation should not begin until this report is explicitly approved, matching the process used for every phase so far.

READY FOR IMPLEMENTATION
