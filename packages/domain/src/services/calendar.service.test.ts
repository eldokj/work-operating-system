// Integration-style tests (real Postgres, not mocked) for CalendarService — doc 26,
// mirroring task-attachment.service.failure.test.ts's and scheduler.service.test.ts's
// established style: a real PrismaClient against the local test database, raw fixture
// creation bypassing the API layer where that's simpler than a full org/RBAC setup.
//
// The single most important authorization scenario in this whole phase — "REPORTS_VIEW
// must never imply calendar detail visibility" — is deliberately tested in the E2E suite
// instead (tests/e2e/abc-college.e2e.test.ts, Phase 7 section), where the full role-grant
// machinery (Team Head / REPORTS_VIEW grants) already exists from the ABC College
// narrative, rather than rebuilt from scratch here.
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@ai-task-manager/db";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { CalendarService } from "./calendar.service";
import { DailyWorkService } from "./daily-work.service";
import { NotificationType } from "./notification.service";

const DEFAULT_LOCAL_DB_URL = "postgresql://app:app_dev_password@localhost:5433/ai_task_manager?schema=public";
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? process.env.DATABASE_RUNTIME_URL ?? DEFAULT_LOCAL_DB_URL } },
});
const calendar = new CalendarService(prisma);

async function createUser(label: string) {
  const email = `calendar-${label}-${randomUUID()}@test.local`;
  return prisma.user.create({ data: { email, fullName: `Calendar Test ${label}`, passwordHash: await bcrypt.hash("password123!", 4) } });
}

// This codebase deliberately does NOT auto-grant a role to a new organization member
// (organization.service.ts's own documented rule: "an admin always makes a deliberate
// choice"), so every fixture user who needs to create a calendar event needs an explicit
// role grant — mirroring exactly what the E2E suite's role-grant API calls do, just via
// raw Prisma instead of HTTP.
async function grantCalendarEventCreate(organizationId: string, userId: string, grantedById: string) {
  const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "calendar_event.create" } });
  const role = await prisma.role.create({ data: { organizationId, name: `Calendar Test Role ${randomUUID()}`, isSystem: false } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  await prisma.userRole.create({ data: { userId, roleId: role.id, organizationId, scopeType: "ORGANIZATION", grantedById } });
}

async function createOrgWithMembers(labels: string[]) {
  const creator = await createUser(`${labels.join("-")}-creator`);
  const org = await prisma.organization.create({
    data: { name: `Calendar Org ${randomUUID()}`, slug: `calendar-org-${randomUUID()}`, createdById: creator.id },
  });
  const workspace = await prisma.workspace.create({ data: { type: "ORGANIZATION", organizationId: org.id, name: "Org Workspace" } });
  const users: Record<string, { id: string }> = { creator };
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: creator.id, status: "ACTIVE" } });
  await grantCalendarEventCreate(org.id, creator.id, creator.id);
  for (const label of labels) {
    const u = await createUser(label);
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: u.id, status: "ACTIVE" } });
    await grantCalendarEventCreate(org.id, u.id, creator.id);
    users[label] = u;
  }
  return { org, workspace, users };
}

const HOUR = 60 * 60 * 1000;
const START = new Date("2026-07-06T09:00:00.000Z"); // a Monday, well within any reasonable working-hours window

describe("CalendarService", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a personal-workspace event owned by the creator, visible only to them", async () => {
    const owner = await createUser("personal-owner");
    const personalWs = await prisma.workspace.create({ data: { type: "PERSONAL", ownerUserId: owner.id, name: "Personal" } });

    const event = await calendar.createEvent(owner.id, {
      workspaceId: personalWs.id,
      title: "Personal focus block",
      startAt: START,
      endAt: new Date(START.getTime() + HOUR),
    });

    expect(event.organizerId).toBe(owner.id);
    expect(event.visibility).toBe("PRIVATE");

    const other = await createUser("personal-outsider");
    await expect(calendar.getEventByIdOrThrow(other.id, event.id)).rejects.toThrow();
  });

  it("rejects participants and ORGANIZATION_VISIBLE on a personal-workspace event", async () => {
    const owner = await createUser("personal-reject-owner");
    const stranger = await createUser("personal-reject-stranger");
    const personalWs = await prisma.workspace.create({ data: { type: "PERSONAL", ownerUserId: owner.id, name: "Personal" } });

    await expect(
      calendar.createEvent(owner.id, {
        workspaceId: personalWs.id,
        title: "Should fail",
        startAt: START,
        endAt: new Date(START.getTime() + HOUR),
        participantUserIds: [stranger.id],
      })
    ).rejects.toThrow();

    await expect(
      calendar.createEvent(owner.id, {
        workspaceId: personalWs.id,
        title: "Should also fail",
        startAt: START,
        endAt: new Date(START.getTime() + HOUR),
        visibility: "ORGANIZATION_VISIBLE",
      })
    ).rejects.toThrow();
  });

  it("an org-workspace event with participants is visible to the organizer and every participant, not to an unrelated org member", async () => {
    const { workspace, users } = await createOrgWithMembers(["organizer", "participant", "unrelated"]);

    const event = await calendar.createEvent(users.organizer!.id, {
      workspaceId: workspace.id,
      title: "Budget review",
      startAt: START,
      endAt: new Date(START.getTime() + HOUR),
      participantUserIds: [users.participant!.id],
    });
    expect(event.participants.map((p) => p.userId)).toContain(users.participant!.id);

    await expect(calendar.getEventByIdOrThrow(users.organizer!.id, event.id)).resolves.toBeTruthy();
    await expect(calendar.getEventByIdOrThrow(users.participant!.id, event.id)).resolves.toBeTruthy();
    await expect(calendar.getEventByIdOrThrow(users.unrelated!.id, event.id)).rejects.toThrow();
  });

  it("a PRIVATE event is invisible to an unrelated org member even though they share an organization", async () => {
    const { workspace, users } = await createOrgWithMembers(["organizer2", "outsider2"]);
    const event = await calendar.createEvent(users.organizer2!.id, {
      workspaceId: workspace.id,
      title: "Private 1:1",
      startAt: START,
      endAt: new Date(START.getTime() + HOUR),
    });
    await expect(calendar.getEventByIdOrThrow(users.outsider2!.id, event.id)).rejects.toThrow();
  });

  it("an ORGANIZATION_VISIBLE event is visible to any member of the SAME organization, never a different one", async () => {
    const { workspace, users } = await createOrgWithMembers(["organizer3", "same-org-member"]);
    const event = await calendar.createEvent(users.organizer3!.id, {
      workspaceId: workspace.id,
      title: "All-hands",
      startAt: START,
      endAt: new Date(START.getTime() + HOUR),
      visibility: "ORGANIZATION_VISIBLE",
    });

    await expect(calendar.getEventByIdOrThrow(users["same-org-member"]!.id, event.id)).resolves.toBeTruthy();

    // A user from a completely different organization must never see it — tenant isolation.
    const outsiderOrg = await createOrgWithMembers(["cross-org-user"]);
    await expect(calendar.getEventByIdOrThrow(outsiderOrg.users["cross-org-user"]!.id, event.id)).rejects.toThrow();
  });

  it("rejects a participant who is not a member of the same organization", async () => {
    const { workspace, users } = await createOrgWithMembers(["org-a-organizer"]);
    const outsiderOrg = await createOrgWithMembers(["org-b-user"]);
    await expect(
      calendar.createEvent(users["org-a-organizer"]!.id, {
        workspaceId: workspace.id,
        title: "Cross-org invite attempt",
        startAt: START,
        endAt: new Date(START.getTime() + HOUR),
        participantUserIds: [outsiderOrg.users["org-b-user"]!.id],
      })
    ).rejects.toThrow();
  });

  it("only the organizer can update or cancel an event — a participant cannot", async () => {
    const { workspace, users } = await createOrgWithMembers(["update-organizer", "update-participant"]);
    const event = await calendar.createEvent(users["update-organizer"]!.id, {
      workspaceId: workspace.id,
      title: "Sprint planning",
      startAt: START,
      endAt: new Date(START.getTime() + HOUR),
      participantUserIds: [users["update-participant"]!.id],
    });

    await expect(calendar.updateEvent(users["update-participant"]!.id, event.id, { title: "Hijacked" })).rejects.toThrow();
    await expect(calendar.cancelEvent(users["update-participant"]!.id, event.id)).rejects.toThrow();

    const updated = await calendar.updateEvent(users["update-organizer"]!.id, event.id, { title: "Sprint planning (updated)" });
    expect(updated.title).toBe("Sprint planning (updated)");
  });

  it("endAt must stay after startAt on both create and partial update", async () => {
    const { workspace, users } = await createOrgWithMembers(["invalid-time-organizer"]);
    await expect(
      calendar.createEvent(users["invalid-time-organizer"]!.id, {
        workspaceId: workspace.id,
        title: "Backwards",
        startAt: new Date(START.getTime() + HOUR),
        endAt: START,
      })
    ).rejects.toThrow();

    const event = await calendar.createEvent(users["invalid-time-organizer"]!.id, {
      workspaceId: workspace.id,
      title: "Valid",
      startAt: START,
      endAt: new Date(START.getTime() + HOUR),
    });
    // Partial update: only endAt given, merged against the existing (later) startAt.
    await expect(
      calendar.updateEvent(users["invalid-time-organizer"]!.id, event.id, { endAt: new Date(START.getTime() - HOUR) })
    ).rejects.toThrow();
  });

  it("cancelling notifies every participant (not the organizer) exactly once, and is idempotent", async () => {
    const { workspace, users } = await createOrgWithMembers(["cancel-organizer", "cancel-participant"]);
    const event = await calendar.createEvent(users["cancel-organizer"]!.id, {
      workspaceId: workspace.id,
      title: "Will be cancelled",
      startAt: START,
      endAt: new Date(START.getTime() + HOUR),
      participantUserIds: [users["cancel-participant"]!.id],
    });

    await calendar.cancelEvent(users["cancel-organizer"]!.id, event.id);
    const notifications = await prisma.notification.findMany({ where: { userId: users["cancel-participant"]!.id } });
    const cancelNotifications = notifications.filter((n) => n.type === NotificationType.CALENDAR_EVENT_CANCELLED);
    expect(cancelNotifications).toHaveLength(1);

    const organizerNotifications = await prisma.notification.findMany({
      where: { userId: users["cancel-organizer"]!.id, type: NotificationType.CALENDAR_EVENT_CANCELLED },
    });
    expect(organizerNotifications).toHaveLength(0);

    // Cancelling again is a harmless no-op — no duplicate notification.
    await calendar.cancelEvent(users["cancel-organizer"]!.id, event.id);
    const stillOne = await prisma.notification.findMany({
      where: { userId: users["cancel-participant"]!.id, type: NotificationType.CALENDAR_EVENT_CANCELLED },
    });
    expect(stillOne).toHaveLength(1);
  });

  it("addParticipant/removeParticipant are organizer-only and audit-logged", async () => {
    const { workspace, users } = await createOrgWithMembers(["participants-organizer", "to-add", "not-organizer"]);
    const event = await calendar.createEvent(users["participants-organizer"]!.id, {
      workspaceId: workspace.id,
      title: "Grows a participant",
      startAt: START,
      endAt: new Date(START.getTime() + HOUR),
    });

    await expect(calendar.addParticipant(users["not-organizer"]!.id, event.id, users["to-add"]!.id)).rejects.toThrow();

    const withParticipant = await calendar.addParticipant(users["participants-organizer"]!.id, event.id, users["to-add"]!.id);
    expect(withParticipant.participants.map((p) => p.userId)).toContain(users["to-add"]!.id);

    const auditRows = await prisma.auditLog.findMany({ where: { calendarEventId: event.id, action: "calendar_event.participant_added" } });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);

    const withoutParticipant = await calendar.removeParticipant(users["participants-organizer"]!.id, event.id, users["to-add"]!.id);
    expect(withoutParticipant.participants.map((p) => p.userId)).not.toContain(users["to-add"]!.id);
  });

  it("getDayTimeline merges a CalendarEvent and a scheduled DailyPlanItem into one chronological, authorization-safe list, with an informational (non-blocking) overlap flag", async () => {
    const { workspace, users } = await createOrgWithMembers(["timeline-user"]);
    const user = users["timeline-user"]!;
    await prisma.user.update({ where: { id: user.id }, data: { defaultTimezone: "UTC" } });

    const dateStr = "2026-07-08";
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);

    const meetingStart = new Date(dayStart.getTime() + 9 * HOUR);
    const meetingEnd = new Date(dayStart.getTime() + 10 * HOUR);
    await calendar.createEvent(user.id, {
      workspaceId: workspace.id,
      title: "Morning standup",
      startAt: meetingStart,
      endAt: meetingEnd,
    });

    // A personal-workspace task — auto-self-assigned on creation (doc 13 #11), so it's
    // immediately plannable without a separate assignment fixture. DailyPlanItem/Workday
    // are user+date scoped, not workspace-scoped (Phase 3's original design), so this task
    // living in the user's personal workspace still merges correctly into the org-
    // workspace-scoped CalendarEvent's day timeline below.
    const personalWs = await prisma.workspace.create({ data: { type: "PERSONAL", ownerUserId: user.id, name: "Personal" } });
    const task = await prisma.task.create({
      data: { workspaceId: personalWs.id, title: "Overlapping task work", createdById: user.id, createdVia: "DIRECT", status: "UNASSIGNED" },
    });
    await prisma.taskAssignment.create({
      data: {
        taskId: task.id,
        assigneeType: "USER",
        assigneeUserId: user.id,
        assignedById: user.id,
        status: "ACCEPTED",
        respondedById: user.id,
        respondedAt: dayStart,
        isCurrent: true,
      },
    });
    const dailyWork = new DailyWorkService(prisma);
    const item = await dailyWork.addItem(user.id, { taskId: task.id, date: dateStr });
    // Deliberately overlaps the meeting (09:30–10:30) — proves the informational conflict
    // flag fires without blocking the write (doc 26 §9's "never enforcement" rule).
    await dailyWork.updateItem(user.id, item.id, {
      scheduledStart: new Date(dayStart.getTime() + 9.5 * HOUR),
      scheduledEnd: new Date(dayStart.getTime() + 10.5 * HOUR),
    });

    const timeline = await calendar.getDayTimeline(user.id, workspace.id, dateStr);
    expect(timeline.items).toHaveLength(2);
    expect(timeline.items[0]!.type).toBe("EVENT");
    expect(timeline.items[1]!.type).toBe("TASK");
    expect(timeline.items[1]!.hasConflict).toBe(true);
    // The meeting itself has nothing scheduled before it — never flagged.
    expect(timeline.items[0]!.hasConflict).toBe(false);
  });

  it("getDayTimeline never includes a PRIVATE event the viewer has no relationship to", async () => {
    const { workspace, users } = await createOrgWithMembers(["timeline-organizer", "timeline-outsider"]);
    await calendar.createEvent(users["timeline-organizer"]!.id, {
      workspaceId: workspace.id,
      title: "Not for the outsider",
      startAt: START,
      endAt: new Date(START.getTime() + HOUR),
    });

    const timeline = await calendar.getDayTimeline(users["timeline-outsider"]!.id, workspace.id, "2026-07-06");
    expect(timeline.items.some((i) => i.title === "Not for the outsider")).toBe(false);
  });
});
