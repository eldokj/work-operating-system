import { Prisma, type PrismaClient } from "@ai-task-manager/db";
import { PERMISSIONS, type CreateCalendarEventInput, type UpdateCalendarEventInput } from "@ai-task-manager/shared";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { localDayBounds, resolveLocalDateString } from "../local-day";
import { AuditService } from "./audit.service";
import { DailyWorkService } from "./daily-work.service";
import { NotificationService, NotificationType } from "./notification.service";
import { PermissionService } from "./permission.service";

const EVENT_DETAIL_INCLUDE = {
  organizer: { select: { id: true, fullName: true, email: true } },
  participants: { select: { id: true, userId: true, user: { select: { id: true, fullName: true, email: true } } } },
  project: { select: { id: true, name: true } },
  workspace: { select: { id: true, type: true, organizationId: true, ownerUserId: true } },
} satisfies Prisma.CalendarEventInclude;

export type CalendarEventWithDetail = Prisma.CalendarEventGetPayload<{ include: typeof EVENT_DETAIL_INCLUDE }>;

const TIMELINE_EVENT_SELECT = {
  id: true,
  title: true,
  startAt: true,
  endAt: true,
  isAllDay: true,
  location: true,
  meetingLink: true,
  organizerId: true,
} satisfies Prisma.CalendarEventSelect;
type TimelineEventSummary = Prisma.CalendarEventGetPayload<{ select: typeof TIMELINE_EVENT_SELECT }>;

// doc 26 §17/§18 — the day timeline's merged shape, declared at module scope (not inside
// getDayTimeline itself) purely so it's a name TypeScript can expose in that exported
// method's public return type declaration.
export interface CalendarDayTimelineEntry {
  type: "EVENT" | "TASK";
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  hasConflict: boolean;
  event: TimelineEventSummary | null;
  task: Awaited<ReturnType<DailyWorkService["listItems"]>>[number] | null;
}
export interface CalendarDayTimeline {
  date: string;
  items: CalendarDayTimelineEntry[];
  unscheduledTaskCount: number;
}

/** Every "which events can this actor see at all" query reuses this exact OR clause — the
 * authorization narrowing happens at the WHERE-clause level (doc 26 §21's explicit
 * requirement: DB-narrowed, never a JS-scale filter pass over a broader fetch), and it is
 * safe specifically because every call site has already confirmed the actor is a member of
 * this workspace's own organization (or owns this personal workspace) before this clause
 * ever runs — the ORGANIZATION_VISIBLE branch never has to re-check membership per row. */
function visibleEventWhere(actorId: string): Prisma.CalendarEventWhereInput {
  return {
    OR: [{ organizerId: actorId }, { participants: { some: { userId: actorId } } }, { visibility: "ORGANIZATION_VISIBLE" }],
  };
}

/**
 * Calendar & Meeting Integration — docs/architecture/26-phase7-calendar-meeting-
 * architecture-report.md. A meeting/time-commitment layer, deliberately separate from
 * DailyPlanItem (task time-blocking reuses DailyPlanItem.scheduledStart/scheduledEnd
 * unchanged, doc 26 §6) — this service owns CalendarEvent CRUD, participant management,
 * and the merged day-timeline read model, never task planning itself.
 */
export class CalendarService {
  private readonly permissions: PermissionService;
  private readonly audit: AuditService;
  private readonly notifications: NotificationService;
  private readonly dailyWork: DailyWorkService;

  constructor(private readonly db: PrismaClient) {
    this.permissions = new PermissionService(db);
    this.audit = new AuditService(db);
    this.notifications = new NotificationService(db);
    this.dailyWork = new DailyWorkService(db);
  }

  // ── Authorization (doc 26 §13 — the central rule) ───────────────────────

  /**
   * Organizer/participant: always full access. ORGANIZATION_VISIBLE: any member of the
   * SAME organization. `REPORTS_VIEW`/reporting scope is never consulted here — that is
   * this method's entire reason for existing as its own predicate rather than reusing
   * canViewTask's REPORTS_VIEW fallback (doc 26 §13's explicit, load-bearing rule: a
   * manager's reporting visibility must never automatically become calendar visibility).
   */
  async canViewEvent(actorId: string, event: CalendarEventWithDetail): Promise<boolean> {
    if (event.organizerId === actorId) return true;
    if (event.participants.some((p) => p.userId === actorId)) return true;
    if (event.visibility === "ORGANIZATION_VISIBLE" && event.workspace.organizationId) {
      return this.permissions.isOrgMember(actorId, event.workspace.organizationId);
    }
    return false;
  }

  private assertMutationAllowed(actorId: string, event: { organizerId: string }): void {
    if (event.organizerId !== actorId) {
      throw new ForbiddenError("Only the organizer can modify this event");
    }
  }

  /** Mirrors TaskService.createTask's exact personal/organization branching (doc 13 #11 —
   * personal workspace requires ownership, organization workspace requires membership). */
  private async assertWorkspaceAccess(
    actorId: string,
    workspace: { type: "PERSONAL" | "ORGANIZATION"; ownerUserId: string | null; organizationId: string | null }
  ): Promise<void> {
    if (workspace.type === "PERSONAL") {
      if (workspace.ownerUserId !== actorId) throw new ForbiddenError("You do not own this personal workspace");
    } else {
      await this.permissions.assertOrgMember(actorId, workspace.organizationId!);
    }
  }

  private async getEventRawOrThrow(eventId: string) {
    const event = await this.db.calendarEvent.findUnique({
      where: { id: eventId },
      include: { workspace: { select: { type: true, organizationId: true, ownerUserId: true } } },
    });
    if (!event) throw new NotFoundError("Calendar event not found");
    return event;
  }

  async getEventByIdOrThrow(actorId: string, eventId: string): Promise<CalendarEventWithDetail> {
    const event = await this.db.calendarEvent.findUnique({ where: { id: eventId }, include: EVENT_DETAIL_INCLUDE });
    if (!event) throw new NotFoundError("Calendar event not found");
    if (!(await this.canViewEvent(actorId, event))) throw new ForbiddenError("You cannot view this event");
    return event;
  }

  // ── Create ────────────────────────────────────────────────────────────

  async createEvent(actorId: string, input: CreateCalendarEventInput): Promise<CalendarEventWithDetail> {
    // Defensive, not just Zod's own refine (doc 26 §12) — the service must be correct on
    // its own regardless of caller, exactly like updateEvent's equivalent check below.
    if (input.endAt.getTime() <= input.startAt.getTime()) {
      throw new ValidationError("endAt must be after startAt");
    }

    const workspace = await this.db.workspace.findUnique({ where: { id: input.workspaceId } });
    if (!workspace) throw new NotFoundError("Workspace not found");
    await this.assertWorkspaceAccess(actorId, workspace);

    if (workspace.type === "PERSONAL") {
      // Personal workspace events are self-only, exactly like personal tasks (doc 13 #11)
      // — no participants, no org-wide visibility (there is no organization to be visible
      // within).
      if (input.participantUserIds?.length) {
        throw new ForbiddenError("Personal workspace events cannot have participants");
      }
      if (input.visibility === "ORGANIZATION_VISIBLE") {
        throw new ValidationError("A personal workspace event cannot be organization-visible");
      }
    } else {
      const organizationId = workspace.organizationId!;
      await this.permissions.assertHasAnyGrantWithPermission(actorId, organizationId, PERMISSIONS.CALENDAR_EVENT_CREATE);
      for (const userId of input.participantUserIds ?? []) {
        if (!(await this.permissions.isOrgMember(userId, organizationId))) {
          throw new ValidationError("A participant must be a member of the same organization");
        }
      }
    }

    if (input.projectId) {
      const project = await this.db.project.findUnique({ where: { id: input.projectId }, select: { workspaceId: true } });
      if (!project || project.workspaceId !== workspace.id) {
        throw new ValidationError("projectId must belong to the same workspace");
      }
    }

    const created = await this.db.$transaction(async (tx) => {
      const event = await tx.calendarEvent.create({
        data: {
          workspaceId: input.workspaceId,
          organizerId: actorId,
          projectId: input.projectId ?? null,
          title: input.title,
          description: input.description ?? null,
          startAt: input.startAt,
          endAt: input.endAt,
          isAllDay: input.isAllDay ?? false,
          location: input.location ?? null,
          meetingLink: input.meetingLink ?? null,
          visibility: input.visibility ?? "PRIVATE",
        },
      });

      if (input.participantUserIds?.length) {
        await tx.calendarEventParticipant.createMany({
          data: input.participantUserIds.map((userId) => ({ eventId: event.id, userId })),
          skipDuplicates: true,
        });
      }

      const txAudit = new AuditService(tx);
      await txAudit.log({
        organizationId: workspace.organizationId ?? null,
        actorId,
        action: "calendar_event.created",
        entityType: "CalendarEvent",
        entityId: event.id,
        calendarEventId: event.id,
        after: { title: event.title, startAt: event.startAt, endAt: event.endAt, visibility: event.visibility },
      });

      return event;
    });

    return this.getEventByIdOrThrow(actorId, created.id);
  }

  // ── Update / cancel / participants — organizer-only (doc 26 §13/§20) ────

  async updateEvent(actorId: string, eventId: string, input: UpdateCalendarEventInput): Promise<CalendarEventWithDetail> {
    const event = await this.getEventRawOrThrow(eventId);
    this.assertMutationAllowed(actorId, event);

    const nextStart = input.startAt ?? event.startAt;
    const nextEnd = input.endAt ?? event.endAt;
    if (nextEnd.getTime() <= nextStart.getTime()) {
      throw new ValidationError("endAt must be after startAt");
    }
    if (input.visibility === "ORGANIZATION_VISIBLE" && event.workspace.type === "PERSONAL") {
      throw new ValidationError("A personal workspace event cannot be organization-visible");
    }

    const before = {
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      location: event.location,
      meetingLink: event.meetingLink,
      visibility: event.visibility,
    };

    const updated = await this.db.calendarEvent.update({
      where: { id: eventId },
      data: {
        title: input.title,
        description: input.description,
        startAt: input.startAt,
        endAt: input.endAt,
        isAllDay: input.isAllDay,
        location: input.location,
        meetingLink: input.meetingLink,
        visibility: input.visibility,
      },
    });

    await this.audit.log({
      organizationId: event.workspace.organizationId ?? null,
      actorId,
      action: "calendar_event.updated",
      entityType: "CalendarEvent",
      entityId: eventId,
      calendarEventId: eventId,
      before,
      after: {
        title: updated.title,
        startAt: updated.startAt,
        endAt: updated.endAt,
        location: updated.location,
        meetingLink: updated.meetingLink,
        visibility: updated.visibility,
      },
    });

    return this.getEventByIdOrThrow(actorId, eventId);
  }

  /** Soft-cancel only — matches the codebase's existing "cancelled, never hard-deleted"
   * convention for Task (doc 05), applied identically here (doc 26 §3). Idempotent: a
   * second cancel of an already-cancelled event is a harmless no-op, not an error. */
  async cancelEvent(actorId: string, eventId: string): Promise<CalendarEventWithDetail> {
    const event = await this.getEventRawOrThrow(eventId);
    this.assertMutationAllowed(actorId, event);

    if (event.status !== "CANCELLED") {
      const participantIds = await this.db.calendarEventParticipant.findMany({ where: { eventId }, select: { userId: true } });

      await this.db.$transaction(async (tx) => {
        await tx.calendarEvent.update({ where: { id: eventId }, data: { status: "CANCELLED" } });
        const txAudit = new AuditService(tx);
        await txAudit.log({
          organizationId: event.workspace.organizationId ?? null,
          actorId,
          action: "calendar_event.cancelled",
          entityType: "CalendarEvent",
          entityId: eventId,
          calendarEventId: eventId,
          before: { status: event.status },
          after: { status: "CANCELLED" },
        });
      });

      if (participantIds.length > 0) {
        await this.notifications.notifyMany(
          participantIds.map((p) => p.userId),
          NotificationType.CALENDAR_EVENT_CANCELLED,
          { eventId, eventTitle: event.title, startAt: event.startAt }
        );
      }
    }

    return this.getEventByIdOrThrow(actorId, eventId);
  }

  async addParticipant(actorId: string, eventId: string, userId: string): Promise<CalendarEventWithDetail> {
    const event = await this.getEventRawOrThrow(eventId);
    this.assertMutationAllowed(actorId, event);

    if (event.workspace.type === "PERSONAL") {
      throw new ForbiddenError("Personal workspace events cannot have participants");
    }
    const organizationId = event.workspace.organizationId!;
    if (!(await this.permissions.isOrgMember(userId, organizationId))) {
      throw new ValidationError("A participant must be a member of the same organization");
    }

    await this.db.calendarEventParticipant.upsert({
      where: { eventId_userId: { eventId, userId } },
      update: {},
      create: { eventId, userId },
    });

    await this.audit.log({
      organizationId,
      actorId,
      action: "calendar_event.participant_added",
      entityType: "CalendarEvent",
      entityId: eventId,
      calendarEventId: eventId,
      after: { userId },
    });

    return this.getEventByIdOrThrow(actorId, eventId);
  }

  async removeParticipant(actorId: string, eventId: string, userId: string): Promise<CalendarEventWithDetail> {
    const event = await this.getEventRawOrThrow(eventId);
    this.assertMutationAllowed(actorId, event);

    await this.db.calendarEventParticipant.deleteMany({ where: { eventId, userId } });

    await this.audit.log({
      organizationId: event.workspace.organizationId ?? null,
      actorId,
      action: "calendar_event.participant_removed",
      entityType: "CalendarEvent",
      entityId: eventId,
      calendarEventId: eventId,
      before: { userId },
    });

    return this.getEventByIdOrThrow(actorId, eventId);
  }

  // ── Reads (doc 26 §18/§21 — authorization-safe by construction, no N+1) ─

  /** A day/week/agenda range query — narrowed entirely at the WHERE-clause level
   * (visibleEventWhere), never a JS-scale filter over a broader fetch. */
  async listEvents(actorId: string, workspaceId: string, from: Date, to: Date): Promise<CalendarEventWithDetail[]> {
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundError("Workspace not found");
    await this.assertWorkspaceAccess(actorId, workspace);

    return this.db.calendarEvent.findMany({
      where: { workspaceId, status: "CONFIRMED", startAt: { lte: to }, endAt: { gte: from }, ...visibleEventWhere(actorId) },
      include: EVENT_DETAIL_INCLUDE,
      orderBy: { startAt: "asc" },
    });
  }

  /**
   * The Today page's merged timeline (doc 26 §17/§18): today's CalendarEvents + today's
   * *scheduled* DailyPlanItems, sorted chronologically, with an informational (never
   * blocking) overlap flag — doc 26 §9. CalendarEvent and DailyPlanItem remain permanently
   * separate sources of truth; this method only ever reads both and merges the result in
   * memory, never writes either into the other.
   */
  async getDayTimeline(actorId: string, workspaceId: string, dateStr?: string): Promise<CalendarDayTimeline> {
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundError("Workspace not found");
    await this.assertWorkspaceAccess(actorId, workspace);

    const user = await this.db.user.findUniqueOrThrow({ where: { id: actorId }, select: { defaultTimezone: true } });
    // For an explicit dateStr, noon UTC is used as the anchor instant for localDayBounds —
    // safe for the vast majority of IANA offsets; the same narrow accepted limitation
    // local-day.ts's own localDayBounds already documents for extreme (+14/-12) offsets on
    // the rare day this matters, not a new limitation introduced here.
    const anchor = dateStr ? new Date(`${dateStr}T12:00:00.000Z`) : new Date();
    const { start, end } = localDayBounds(anchor, user.defaultTimezone);

    const [events, planItems] = await Promise.all([
      this.db.calendarEvent.findMany({
        where: { workspaceId, status: "CONFIRMED", startAt: { lte: end }, endAt: { gte: start }, ...visibleEventWhere(actorId) },
        select: TIMELINE_EVENT_SELECT,
        orderBy: { startAt: "asc" },
      }),
      this.dailyWork.listItems(actorId, dateStr),
    ]);

    const scheduledTaskItems = planItems.filter(
      (i): i is typeof i & { scheduledStart: Date; scheduledEnd: Date } => i.scheduledStart !== null && i.scheduledEnd !== null
    );

    const merged: CalendarDayTimelineEntry[] = [
      ...events.map(
        (e): CalendarDayTimelineEntry => ({
          type: "EVENT",
          id: e.id,
          title: e.title,
          startAt: e.startAt,
          endAt: e.endAt,
          hasConflict: false,
          event: e,
          task: null,
        })
      ),
      ...scheduledTaskItems.map(
        (i): CalendarDayTimelineEntry => ({
          type: "TASK",
          id: i.id,
          title: i.task.title,
          startAt: i.scheduledStart,
          endAt: i.scheduledEnd,
          hasConflict: false,
          event: null,
          task: i,
        })
      ),
    ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    // doc 26 §9 — informational only, checked pairwise against every earlier item (day-
    // scale n, so O(n^2) is negligible — never a query, never a write).
    for (let i = 0; i < merged.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = merged[i]!;
        const b = merged[j]!;
        if (a.startAt.getTime() < b.endAt.getTime() && b.startAt.getTime() < a.endAt.getTime()) {
          a.hasConflict = true;
          break;
        }
      }
    }

    return {
      date: dateStr ?? resolveLocalDateString(new Date(), user.defaultTimezone),
      items: merged,
      unscheduledTaskCount: planItems.length - scheduledTaskItems.length,
    };
  }
}
