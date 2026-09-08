// Integration-style tests (real Postgres, not mocked) for the Phase 6 scheduler —
// docs/architecture/24-phase6-notifications-scheduler-architecture-report.md §5-§9/§15.
// Uses a real PrismaClient against the same test database the E2E suite uses, and raw
// fixture creation (bypassing the API layer, same style as
// task-attachment.service.failure.test.ts) since the scheduler is an internal domain
// function with no HTTP surface of its own (doc §7 — deliberately not exposed as a route).
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@ai-task-manager/db";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotificationType } from "./notification.service";
import { runScheduledChecks } from "./scheduler.service";

const DEFAULT_LOCAL_DB_URL = "postgresql://app:app_dev_password@localhost:5433/ai_task_manager?schema=public";
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? process.env.DATABASE_RUNTIME_URL ?? DEFAULT_LOCAL_DB_URL } },
});

const NOW = new Date("2026-06-15T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

async function createUser(label: string) {
  const email = `scheduler-${label}-${randomUUID()}@test.local`;
  return prisma.user.create({ data: { email, fullName: `Scheduler Test ${label}`, passwordHash: await bcrypt.hash("password123!", 4) } });
}

/** A personal-workspace task with a real, ACCEPTED, isCurrent self-assignment — the exact
 * shape TaskService.createTask produces for a personal task (task.service.ts:130-150), so
 * the scheduler's query is exercised against realistic data, not a synthetic shortcut. */
async function createAssignedTask(opts: { assigneeId: string; dueDate: Date | null; status?: string }) {
  const workspace = await prisma.workspace.create({ data: { type: "PERSONAL", ownerUserId: opts.assigneeId, name: "Personal" } });
  const task = await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      title: `Scheduler test task ${randomUUID()}`,
      dueDate: opts.dueDate,
      status: (opts.status as never) ?? "IN_PROGRESS",
      createdById: opts.assigneeId,
      createdVia: "DIRECT",
    },
  });
  await prisma.taskAssignment.create({
    data: {
      taskId: task.id,
      assigneeType: "USER",
      assigneeUserId: opts.assigneeId,
      assignedById: opts.assigneeId,
      status: "ACCEPTED",
      respondedById: opts.assigneeId,
      respondedAt: NOW,
      isCurrent: true,
    },
  });
  return task;
}

describe("runScheduledChecks — Phase 6 scheduler", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("fires DEADLINE_APPROACHING exactly once for a task due within the 24h window", async () => {
    const user = await createUser("approaching");
    const task = await createAssignedTask({ assigneeId: user.id, dueDate: new Date(NOW.getTime() + 6 * HOUR) });

    const first = await runScheduledChecks(prisma, NOW);
    expect(first.deadlineApproaching).toBe(1);
    expect(first.overdue).toBe(0);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id, relatedTaskId: task.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe(NotificationType.DEADLINE_APPROACHING);

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(updated.deadlineApproachingNotifiedAt).not.toBeNull();

    // A second tick, even much later, must not duplicate — the marker makes it permanent.
    const second = await runScheduledChecks(prisma, new Date(NOW.getTime() + HOUR));
    expect(second.deadlineApproaching).toBe(0);
    const stillOne = await prisma.notification.findMany({ where: { userId: user.id, relatedTaskId: task.id } });
    expect(stillOne).toHaveLength(1);
  });

  it("does not fire for a task due more than 24h out", async () => {
    const user = await createUser("far-future");
    const task = await createAssignedTask({ assigneeId: user.id, dueDate: new Date(NOW.getTime() + 48 * HOUR) });

    const result = await runScheduledChecks(prisma, NOW);
    expect(result.deadlineApproaching).toBe(0);

    const notifications = await prisma.notification.findMany({ where: { relatedTaskId: task.id } });
    expect(notifications).toHaveLength(0);
  });

  it("fires TASK_OVERDUE exactly once for a task past its due date, and never duplicates on a later tick", async () => {
    const user = await createUser("overdue");
    const task = await createAssignedTask({ assigneeId: user.id, dueDate: new Date(NOW.getTime() - 2 * HOUR) });

    const first = await runScheduledChecks(prisma, NOW);
    expect(first.overdue).toBe(1);
    expect(first.deadlineApproaching).toBe(0);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id, relatedTaskId: task.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe(NotificationType.TASK_OVERDUE);

    // A modest time advance (not a large jump — see date-boundary/lifecycle tests below
    // for why: a large jump risks also sweeping in *other* tests' still-unclaimed fixture
    // tasks sharing this same database, per this project's established no-reset test
    // convention). The per-task-scoped query is what actually proves non-duplication.
    await runScheduledChecks(prisma, new Date(NOW.getTime() + HOUR));
    const stillOne = await prisma.notification.findMany({ where: { relatedTaskId: task.id } });
    expect(stillOne).toHaveLength(1);
  });

  it("never fires for a COMPLETED task, even with a past due date", async () => {
    const user = await createUser("completed");
    const task = await createAssignedTask({ assigneeId: user.id, dueDate: new Date(NOW.getTime() - 2 * HOUR), status: "COMPLETED" });

    const result = await runScheduledChecks(prisma, NOW);
    expect(result.overdue).toBe(0);
    expect(result.deadlineApproaching).toBe(0);
    const notifications = await prisma.notification.findMany({ where: { relatedTaskId: task.id } });
    expect(notifications).toHaveLength(0);
  });

  it("never fires for a CANCELLED task, even with a past due date", async () => {
    const user = await createUser("cancelled");
    const task = await createAssignedTask({ assigneeId: user.id, dueDate: new Date(NOW.getTime() - 2 * HOUR), status: "CANCELLED" });

    const result = await runScheduledChecks(prisma, NOW);
    expect(result.overdue).toBe(0);
    const notifications = await prisma.notification.findMany({ where: { relatedTaskId: task.id } });
    expect(notifications).toHaveLength(0);
  });

  it("never fires for a task with no due date", async () => {
    const user = await createUser("no-due-date");
    const task = await createAssignedTask({ assigneeId: user.id, dueDate: null });

    const result = await runScheduledChecks(prisma, NOW);
    expect(result.overdue).toBe(0);
    expect(result.deadlineApproaching).toBe(0);
    const notifications = await prisma.notification.findMany({ where: { relatedTaskId: task.id } });
    expect(notifications).toHaveLength(0);
  });

  it("skips a team assignment with no individual distributed yet — no notification, no error (authorization: there is no authorized individual to notify)", async () => {
    const creator = await createUser("team-creator");
    const org = await prisma.organization.create({ data: { name: `Sched Org ${randomUUID()}`, slug: `sched-org-${randomUUID()}`, createdById: creator.id } });
    const team = await prisma.team.create({ data: { organizationId: org.id, name: "Scheduler Team", createdById: creator.id } });
    const workspace = await prisma.workspace.create({ data: { type: "ORGANIZATION", organizationId: org.id, name: "Org Workspace" } });
    const task = await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        title: `Team-assigned overdue task ${randomUUID()}`,
        dueDate: new Date(NOW.getTime() - 2 * HOUR),
        status: "ASSIGNED",
        createdById: creator.id,
        createdVia: "DIRECT",
      },
    });
    await prisma.taskAssignment.create({
      data: { taskId: task.id, assigneeType: "TEAM", assigneeTeamId: team.id, assignedById: creator.id, status: "ACCEPTED", isCurrent: true },
    });

    const result = await runScheduledChecks(prisma, NOW);
    const notifications = await prisma.notification.findMany({ where: { relatedTaskId: task.id } });
    expect(notifications).toHaveLength(0);
    // Confirms the tick didn't throw/skip the rest of the batch on encountering this task.
    expect(result.overdue).toBeGreaterThanOrEqual(0);
  });

  it("skips an assignment still PENDING_ACKNOWLEDGEMENT — not yet the current accountable owner (doc 21 §6/§7, reused per doc 24 §5)", async () => {
    const creator = await createUser("pending-creator");
    const assignee = await createUser("pending-assignee");
    const org = await prisma.organization.create({ data: { name: `Sched Org ${randomUUID()}`, slug: `sched-org-${randomUUID()}`, createdById: creator.id } });
    const workspace = await prisma.workspace.create({ data: { type: "ORGANIZATION", organizationId: org.id, name: "Org Workspace" } });
    const task = await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        title: `Pending ack overdue task ${randomUUID()}`,
        dueDate: new Date(NOW.getTime() - 2 * HOUR),
        status: "ASSIGNED",
        createdById: creator.id,
        createdVia: "DIRECT",
      },
    });
    await prisma.taskAssignment.create({
      data: { taskId: task.id, assigneeType: "USER", assigneeUserId: assignee.id, assignedById: creator.id, status: "PENDING_ACKNOWLEDGEMENT", isCurrent: true },
    });

    await runScheduledChecks(prisma, NOW);
    const notifications = await prisma.notification.findMany({ where: { relatedTaskId: task.id } });
    expect(notifications).toHaveLength(0);
  });

  it("notifies only the current assignee — an unrelated user never receives the notification (information-disclosure boundary, doc 24 §9)", async () => {
    const assignee = await createUser("recipient");
    const bystander = await createUser("bystander");
    const task = await createAssignedTask({ assigneeId: assignee.id, dueDate: new Date(NOW.getTime() - HOUR) });

    await runScheduledChecks(prisma, NOW);

    const forAssignee = await prisma.notification.findMany({ where: { userId: assignee.id, relatedTaskId: task.id } });
    expect(forAssignee).toHaveLength(1);
    const forBystander = await prisma.notification.findMany({ where: { userId: bystander.id, relatedTaskId: task.id } });
    expect(forBystander).toHaveLength(0);
  });

  it("idempotency under concurrency: two ticks racing on the same task produce exactly one notification (doc §8's conditional-write guarantee)", async () => {
    const user = await createUser("race");
    const task = await createAssignedTask({ assigneeId: user.id, dueDate: new Date(NOW.getTime() - HOUR) });

    const [a, b] = await Promise.all([runScheduledChecks(prisma, NOW), runScheduledChecks(prisma, NOW)]);
    expect(a.overdue + b.overdue).toBe(1); // exactly one of the two ticks claimed it

    const notifications = await prisma.notification.findMany({ where: { relatedTaskId: task.id } });
    expect(notifications).toHaveLength(1);
  });

  it("date-boundary correctness: a task due exactly at `now` is not yet overdue and not approaching (dueDate < now / dueDate > now are strict, doc §6's timezone-neutral instant comparison)", async () => {
    const user = await createUser("boundary");
    const task = await createAssignedTask({ assigneeId: user.id, dueDate: NOW });

    await runScheduledChecks(prisma, NOW);
    const notifications = await prisma.notification.findMany({ where: { relatedTaskId: task.id } });
    expect(notifications).toHaveLength(0);

    // One millisecond later, the same task is unambiguously overdue.
    await runScheduledChecks(prisma, new Date(NOW.getTime() + 1));
    const afterward = await prisma.notification.findMany({ where: { relatedTaskId: task.id } });
    expect(afterward).toHaveLength(1);
    expect(afterward[0]!.type).toBe(NotificationType.TASK_OVERDUE);
  });

  it("a task can receive both notifications over its lifetime — approaching first, then overdue once it actually passes — never a duplicate of either", async () => {
    const user = await createUser("lifecycle");
    const task = await createAssignedTask({ assigneeId: user.id, dueDate: new Date(NOW.getTime() + 2 * HOUR) });

    const tick1 = await runScheduledChecks(prisma, NOW);
    expect(tick1.deadlineApproaching).toBe(1);

    // Time passes; the same task is now overdue.
    const later = new Date(NOW.getTime() + 3 * HOUR);
    const tick2 = await runScheduledChecks(prisma, later);
    expect(tick2.overdue).toBe(1);
    expect(tick2.deadlineApproaching).toBe(0); // already claimed in tick1, not re-evaluated

    const notifications = await prisma.notification.findMany({ where: { relatedTaskId: task.id }, orderBy: { createdAt: "asc" } });
    expect(notifications).toHaveLength(2);
    expect(notifications[0]!.type).toBe(NotificationType.DEADLINE_APPROACHING);
    expect(notifications[1]!.type).toBe(NotificationType.TASK_OVERDUE);
  });
});
