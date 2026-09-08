import { Prisma, type PrismaClient } from "@ai-task-manager/db";
import type {
  AddDailyPlanItemInput,
  CloseWorkdayInput,
  TaskListFilter,
  UpdateDailyPlanItemInput,
} from "@ai-task-manager/shared";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { resolveLocalDate } from "../local-day";
import {
  canDeleteDailyPlanItem,
  canTransitionDailyPlanItem,
  isTerminalDailyPlanItemStatus,
  nextDailyPlanItemStatus,
} from "../state-machines/daily-plan-item.machine";
import { AuditService } from "./audit.service";
import { TaskService } from "./task.service";

const ITEM_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  estimatedDurationMinutes: true,
  project: { select: { id: true, name: true, kind: true } },
  workspace: { select: { type: true, organizationId: true } },
  assignments: {
    where: { isCurrent: true },
    select: { assigneeType: true, assigneeUserId: true, status: true },
  },
} satisfies Prisma.TaskSelect;

type ItemWithTask = Prisma.DailyPlanItemGetPayload<{ include: { task: { select: typeof ITEM_TASK_SELECT } } }>;

const DEFAULT_DAILY_CAPACITY_MINUTES = 8 * 60;
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DEFAULT_WORKING_WEEKDAYS = new Set(["mon", "tue", "wed", "thu", "fri"]);

/** doc 19 §16 — advisory input to the capacity indicator only, never an enforcement
 * boundary. `workDate` is a plain UTC-midnight-anchored calendar date (matches @db.Date
 * semantics — see local-day.ts), so getUTCDay() correctly reads its calendar weekday. */
function computeCapacityMinutes(workingHours: Prisma.JsonValue | null | undefined, workDate: Date): number {
  // getUTCDay() is always 0-6 and WEEKDAY_KEYS has exactly 7 entries — the non-null
  // assertion is safe by construction, not a suppressed real possibility of undefined.
  const weekday = WEEKDAY_KEYS[workDate.getUTCDay()]!;
  if (!workingHours || typeof workingHours !== "object" || Array.isArray(workingHours)) {
    return DEFAULT_WORKING_WEEKDAYS.has(weekday) ? DEFAULT_DAILY_CAPACITY_MINUTES : 0;
  }
  const entry = (workingHours as Record<string, { start?: string; end?: string }>)[weekday];
  if (!entry?.start || !entry?.end) return 0;
  const toMinutes = (hhmm: string): number | null => {
    const [h, m] = hhmm.split(":").map(Number);
    if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };
  const startMinutes = toMinutes(entry.start);
  const endMinutes = toMinutes(entry.end);
  if (startMinutes === null || endMinutes === null) {
    return DEFAULT_WORKING_WEEKDAYS.has(weekday) ? DEFAULT_DAILY_CAPACITY_MINUTES : 0;
  }
  return Math.max(0, endMinutes - startMinutes);
}

/**
 * Daily Work Cycle — docs/architecture/19-phase3-daily-work-cycle-architecture-report.md.
 * A thin, personal, reference-only layer over the existing work graph — Task/
 * TaskAssignment/the task lifecycle are never modified here, only read. Daily planning is
 * personal by default and, in Phase 3, exclusively so: every public method below takes
 * only the caller's own `actorId` and operates exclusively on their own Workday/
 * DailyPlanItem rows — there is deliberately no target-user parameter anywhere on this
 * service (doc 19 §27), which is what makes the cross-user IDOR class structurally
 * impossible rather than merely permission-checked.
 */
export class DailyWorkService {
  private readonly tasks: TaskService;
  private readonly audit: AuditService;

  constructor(private readonly db: PrismaClient) {
    this.tasks = new TaskService(db);
    this.audit = new AuditService(db);
  }

  // ── Local day resolution (doc 19 §12/§31) ──────────────────────────────

  /** An explicit, already-validated `dateStr` (YYYY-MM-DD) is used as-is — it's already
   * unambiguous. Otherwise "today" is computed from the actor's own
   * User.defaultTimezone, never the server's clock/zone — the fix for the pre-existing
   * bug in ReportingService's bucketByDueDate (doc 19 §2/§31). */
  private async resolveWorkDate(actorId: string, dateStr?: string): Promise<Date> {
    if (dateStr) return new Date(`${dateStr}T00:00:00.000Z`);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actorId }, select: { defaultTimezone: true } });
    return resolveLocalDate(new Date(), user.defaultTimezone);
  }

  /**
   * `upsert` alone is not enough here: two near-simultaneous first-touches of the same
   * user+day (e.g. a double-fired effect, or two tabs) can both attempt the CREATE branch
   * and race — Postgres's unique constraint on (userId, workDate) then rejects the loser
   * with P2002 rather than Prisma silently falling back to the UPDATE branch for it. That
   * race is expected and harmless (both callers wanted the same row); recover by simply
   * re-reading the row the winner created, instead of surfacing a 500.
   */
  private async getOrCreateWorkday(actorId: string, workDate: Date) {
    try {
      return await this.db.workday.upsert({
        where: { userId_workDate: { userId: actorId, workDate } },
        update: {},
        create: { userId: actorId, workDate },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return this.db.workday.findUniqueOrThrow({ where: { userId_workDate: { userId: actorId, workDate } } });
      }
      throw err;
    }
  }

  // ── Workday ──────────────────────────────────────────────────────────

  /**
   * Read-only — never creates a row (doc 19 §5). Status is always derived
   * (NOT_STARTED/OPEN/CLOSED — doc 19 §22), never a stored column. Includes the capacity
   * summary (doc 19 §16) in the same read to avoid a second round-trip for the Today
   * screen's single most important number (doc 19 §29).
   */
  async getWorkday(actorId: string, dateStr?: string) {
    const workDate = await this.resolveWorkDate(actorId, dateStr);
    const [workday, user] = await Promise.all([
      this.db.workday.findUnique({ where: { userId_workDate: { userId: actorId, workDate } } }),
      this.db.user.findUniqueOrThrow({ where: { id: actorId }, select: { workingHours: true } }),
    ]);

    let plannedMinutes = 0;
    if (workday) {
      const items = await this.db.dailyPlanItem.findMany({
        where: { workdayId: workday.id, status: { in: ["PLANNED", "IN_PROGRESS"] } },
        select: { plannedDurationMinutes: true, task: { select: { estimatedDurationMinutes: true } } },
      });
      plannedMinutes = items.reduce((sum, i) => sum + (i.plannedDurationMinutes ?? i.task.estimatedDurationMinutes ?? 0), 0);
    }

    return {
      workDate: workDate.toISOString().slice(0, 10),
      status: (!workday ? "NOT_STARTED" : workday.closedAt ? "CLOSED" : "OPEN") as "NOT_STARTED" | "OPEN" | "CLOSED",
      id: workday?.id ?? null,
      startedAt: workday?.startedAt ?? null,
      closedAt: workday?.closedAt ?? null,
      reflectionNote: workday?.reflectionNote ?? null,
      capacityMinutes: computeCapacityMinutes(user.workingHours, workDate),
      plannedMinutes,
    };
  }

  /** Idempotent: lazily creates the Workday if absent, sets startedAt if unset (doc 19
   * §5/§22) — "starting the day" is an implicit side effect of engaging with it, not a
   * button the user must remember to press first. */
  async startWorkday(actorId: string, dateStr?: string) {
    const workDate = await this.resolveWorkDate(actorId, dateStr);
    const workday = await this.getOrCreateWorkday(actorId, workDate);
    if (!workday.startedAt) {
      await this.db.workday.update({ where: { id: workday.id }, data: { startedAt: new Date() } });
      // Only logged on the actual first start, not every idempotent re-call.
      await this.audit.log({
        actorId,
        action: "workday.started",
        entityType: "Workday",
        entityId: workday.id,
        workdayId: workday.id,
      });
    }
    return this.getWorkday(actorId, dateStr);
  }

  // ── Inbox (derived, doc 19 §10/§20) ─────────────────────────────────

  /**
   * Current accepted individual assignments (the existing, unchanged "My Tasks"
   * definition — TaskService.listTasks view=MY_TASKS) minus tasks already on THIS day's
   * plan. Scoped to one workspace at a time, matching every other "My Tasks"-shaped view
   * already in the app (dashboard, /tasks) — not an aggregate across every workspace the
   * user belongs to.
   */
  async getInbox(actorId: string, workspaceId: string, dateStr?: string) {
    const workDate = await this.resolveWorkDate(actorId, dateStr);
    const [myTasks, workday] = await Promise.all([
      this.tasks.listTasks(actorId, workspaceId, { view: "MY_TASKS" } as TaskListFilter),
      this.db.workday.findUnique({ where: { userId_workDate: { userId: actorId, workDate } } }),
    ]);
    if (!workday) return myTasks;

    const activeTaskIds = new Set(
      (
        await this.db.dailyPlanItem.findMany({
          where: { workdayId: workday.id, status: { in: ["PLANNED", "IN_PROGRESS"] } },
          select: { taskId: true },
        })
      ).map((i) => i.taskId)
    );
    return myTasks.filter((t) => !activeTaskIds.has(t.id));
  }

  // ── Plan items ───────────────────────────────────────────────────────

  private toItemDTO(item: ItemWithTask, actorId: string) {
    const current = item.task.assignments[0];
    // Ownership can only silently shift for an organization-workspace task (reassignment)
    // — a personal-workspace task is always self-owned and can never leave the creator's
    // hands (doc 19 §14/§27). Surfaced, never silently hidden or auto-removed.
    const ownershipLost =
      item.task.workspace.type === "ORGANIZATION" &&
      !(current?.assigneeType === "USER" && current.assigneeUserId === actorId && current.status === "ACCEPTED");

    return {
      id: item.id,
      status: item.status,
      position: item.position,
      isUnplanned: item.isUnplanned,
      plannedDurationMinutes: item.plannedDurationMinutes,
      scheduledStart: item.scheduledStart,
      scheduledEnd: item.scheduledEnd,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      carriedFromItemId: item.carriedFromItemId,
      task: {
        id: item.task.id,
        title: item.task.title,
        status: item.task.status,
        priority: item.task.priority,
        dueDate: item.task.dueDate,
        project: item.task.project,
      },
      ownershipLost,
    };
  }

  async listItems(actorId: string, dateStr?: string) {
    const workDate = await this.resolveWorkDate(actorId, dateStr);
    const workday = await this.db.workday.findUnique({ where: { userId_workDate: { userId: actorId, workDate } } });
    if (!workday) return [];
    const items = await this.db.dailyPlanItem.findMany({
      where: { workdayId: workday.id },
      orderBy: { position: "asc" },
      include: { task: { select: ITEM_TASK_SELECT } },
    });
    return items.map((i) => this.toItemDTO(i, actorId));
  }

  /** doc 19 §27: only the task's current, ACCEPTED, individual assignee may plan it — a
   * plain view/REPORTS_VIEW-derived visibility is not enough. A personal-workspace task
   * is always self-owned (TaskService.getTaskByIdOrThrow already gates on
   * canViewTask=workspace ownership for personal tasks, so no further check is needed). */
  private isCurrentOwner(actorId: string, task: { workspace: { type: string }; assignments: Array<{ assigneeType: string; assigneeUserId: string | null; status: string }> }): boolean {
    if (task.workspace.type === "PERSONAL") return true;
    const current = task.assignments[0]; // already filtered to isCurrent:true — at most one row
    return !!current && current.assigneeType === "USER" && current.assigneeUserId === actorId && current.status === "ACCEPTED";
  }

  async addItem(actorId: string, input: AddDailyPlanItemInput) {
    const task = await this.tasks.getTaskByIdOrThrow(actorId, input.taskId);
    const current = task.assignments.find((a) => a.isCurrent) ?? null;
    if (!this.isCurrentOwner(actorId, { workspace: task.workspace, assignments: current ? [current] : [] })) {
      throw new ForbiddenError("You can only plan tasks you are the current accepted assignee of");
    }

    const workDate = await this.resolveWorkDate(actorId, input.date);
    const workday = await this.getOrCreateWorkday(actorId, workDate);

    const existing = await this.db.dailyPlanItem.findUnique({
      where: { workdayId_taskId: { workdayId: workday.id, taskId: input.taskId } },
    });
    if (existing) throw new ConflictError("This task is already on the plan for this day");

    const maxPosition = await this.db.dailyPlanItem.aggregate({ where: { workdayId: workday.id }, _max: { position: true } });
    let item: ItemWithTask;
    try {
      item = await this.db.dailyPlanItem.create({
        data: {
          workdayId: workday.id,
          taskId: input.taskId,
          position: (maxPosition._max.position ?? -1) + 1,
          isUnplanned: input.isUnplanned ?? false,
          plannedDurationMinutes: input.plannedDurationMinutes ?? null,
        },
        include: { task: { select: ITEM_TASK_SELECT } },
      });
    } catch (err) {
      // Same benign double-fire race as getOrCreateWorkday above, one layer down — the
      // pre-check just above this can itself lose a race between two near-simultaneous
      // add attempts; surface it as the same clean 409 the pre-check was meant to give,
      // not a raw 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictError("This task is already on the plan for this day");
      }
      throw err;
    }

    await this.audit.log({
      organizationId: task.workspace.organizationId,
      actorId,
      action: "daily_plan_item.added",
      entityType: "DailyPlanItem",
      entityId: item.id,
      taskId: task.id,
      workdayId: workday.id,
      after: { taskTitle: task.title, isUnplanned: item.isUnplanned },
    });

    return this.toItemDTO(item, actorId);
  }

  /** Flat item route (matches /project-dates/:id) — resolves its own owning
   * Workday/user server-side from the item id, never trusting a client-supplied
   * ownership claim (doc 19 §20/§27). */
  private async loadOwnedItem(actorId: string, itemId: string): Promise<ItemWithTask & { workday: { id: string; userId: string; workDate: Date } }> {
    const item = await this.db.dailyPlanItem.findUnique({
      where: { id: itemId },
      include: { task: { select: ITEM_TASK_SELECT }, workday: { select: { id: true, userId: true, workDate: true } } },
    });
    if (!item) throw new NotFoundError("Daily plan item not found");
    if (item.workday.userId !== actorId) throw new ForbiddenError("You do not have access to this daily plan item");
    return item;
  }

  async updateItem(actorId: string, itemId: string, input: UpdateDailyPlanItemInput) {
    const item = await this.loadOwnedItem(actorId, itemId);
    const updated = await this.db.dailyPlanItem.update({
      where: { id: itemId },
      data: {
        position: input.position,
        plannedDurationMinutes: input.plannedDurationMinutes,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
      },
      include: { task: { select: ITEM_TASK_SELECT } },
    });
    await this.audit.log({
      organizationId: item.task.workspace.organizationId,
      actorId,
      action: "daily_plan_item.updated",
      entityType: "DailyPlanItem",
      entityId: itemId,
      taskId: item.taskId,
      workdayId: item.workdayId,
      after: input,
    });
    return this.toItemDTO(updated, actorId);
  }

  async startItem(actorId: string, itemId: string) {
    const item = await this.loadOwnedItem(actorId, itemId);
    if (this.toItemDTO(item, actorId).ownershipLost) {
      throw new ForbiddenError("You are no longer the current assignee of this task — resolve it via a Close disposition instead");
    }
    if (!canTransitionDailyPlanItem(item.status, "START")) {
      throw new ConflictError(`Item in status "${item.status}" cannot be started`);
    }
    const updated = await this.db.dailyPlanItem.update({
      where: { id: itemId },
      data: { status: nextDailyPlanItemStatus(item.status, "START"), startedAt: item.startedAt ?? new Date() },
      include: { task: { select: ITEM_TASK_SELECT } },
    });
    await this.audit.log({
      organizationId: item.task.workspace.organizationId,
      actorId,
      action: "daily_plan_item.started",
      entityType: "DailyPlanItem",
      entityId: itemId,
      taskId: item.taskId,
      workdayId: item.workdayId,
    });
    return this.toItemDTO(updated, actorId);
  }

  async completeItem(actorId: string, itemId: string) {
    const item = await this.loadOwnedItem(actorId, itemId);
    if (!canTransitionDailyPlanItem(item.status, "COMPLETE")) {
      throw new ConflictError(`Item in status "${item.status}" cannot be completed`);
    }
    const updated = await this.db.dailyPlanItem.update({
      where: { id: itemId },
      data: { status: nextDailyPlanItemStatus(item.status, "COMPLETE"), completedAt: new Date() },
      include: { task: { select: ITEM_TASK_SELECT } },
    });
    await this.audit.log({
      organizationId: item.task.workspace.organizationId,
      actorId,
      action: "daily_plan_item.completed",
      entityType: "DailyPlanItem",
      entityId: itemId,
      taskId: item.taskId,
      workdayId: item.workdayId,
    });
    return this.toItemDTO(updated, actorId);
  }

  /** Un-planning is only permitted while PLANNED and untouched (doc 19 §8/§20) — once
   * execution has begun, removal must go through an explicit Close disposition instead of
   * disappearing outright. */
  async deleteItem(actorId: string, itemId: string): Promise<void> {
    const item = await this.loadOwnedItem(actorId, itemId);
    if (!canDeleteDailyPlanItem(item.status, item.startedAt)) {
      throw new ConflictError("This item has already been started or resolved — use a Close disposition instead of deleting it");
    }
    await this.db.dailyPlanItem.delete({ where: { id: itemId } });
    await this.audit.log({
      organizationId: item.task.workspace.organizationId,
      actorId,
      action: "daily_plan_item.removed",
      entityType: "DailyPlanItem",
      entityId: itemId,
      taskId: item.taskId,
      workdayId: item.workdayId,
    });
  }

  // ── Close (doc 19 §8) ────────────────────────────────────────────────

  /**
   * Transactional and complete: every non-terminal item whose underlying task hasn't
   * already resolved itself (COMPLETED/CANCELLED — auto-exempted, doc 19 §8/§14) must
   * have an explicit disposition, or the whole close is rejected — never a partial close,
   * never a silent carry-forward.
   */
  async closeWorkday(actorId: string, input: CloseWorkdayInput) {
    const workDate = await this.resolveWorkDate(actorId, input.date);
    const workday = await this.db.workday.findUnique({ where: { userId_workDate: { userId: actorId, workDate } } });
    if (!workday) throw new NotFoundError("No workday exists for this date yet");
    if (workday.closedAt) throw new ConflictError("This day has already been closed");

    const items = await this.db.dailyPlanItem.findMany({
      where: { workdayId: workday.id },
      include: { task: { select: { status: true, workspaceId: true } } },
    });

    const needsDisposition = items.filter(
      (i) => !isTerminalDailyPlanItemStatus(i.status) && i.task.status !== "COMPLETED" && i.task.status !== "CANCELLED"
    );

    const dispositionByItemId = new Map(input.dispositions.map((d) => [d.itemId, d]));
    const missing = needsDisposition.filter((i) => !dispositionByItemId.has(i.id));
    if (missing.length > 0) {
      throw new ValidationError("Every unfinished item needs an explicit disposition before closing the day", {
        unresolvedItemIds: missing.map((i) => i.id),
      });
    }
    // Never trust a client-supplied itemId at face value — every disposition must target
    // a real item on THIS exact workday that actually needs one.
    for (const d of input.dispositions) {
      if (!needsDisposition.some((i) => i.id === d.itemId)) {
        throw new ValidationError(`Item ${d.itemId} does not require a disposition on this workday, or does not belong to it`);
      }
    }

    await this.db.$transaction(async (tx) => {
      // Re-check inside the transaction: guards against two concurrent close requests
      // for the same day both passing the outer check before either commits (the actor
      // could only ever race against their own second request — still worth closing).
      const fresh = await tx.workday.findUniqueOrThrow({ where: { id: workday.id } });
      if (fresh.closedAt) throw new ConflictError("This day has already been closed");

      const txAudit = new AuditService(tx);
      for (const d of input.dispositions) {
        const item = needsDisposition.find((i) => i.id === d.itemId)!;

        if (d.action === "COMPLETE") {
          await tx.dailyPlanItem.update({
            where: { id: item.id },
            data: { status: nextDailyPlanItemStatus(item.status, "COMPLETE"), completedAt: new Date() },
          });
        } else if (d.action === "CARRY_FORWARD") {
          const targetDate = d.targetDate
            ? new Date(`${d.targetDate}T00:00:00.000Z`)
            : new Date(workDate.getTime() + 24 * 60 * 60 * 1000);
          const targetWorkday = await tx.workday.upsert({
            where: { userId_workDate: { userId: actorId, workDate: targetDate } },
            update: {},
            create: { userId: actorId, workDate: targetDate },
          });
          const alreadyOnTarget = await tx.dailyPlanItem.findUnique({
            where: { workdayId_taskId: { workdayId: targetWorkday.id, taskId: item.taskId } },
          });
          if (alreadyOnTarget) {
            // Edge case: the task is somehow already planned on the target day (e.g. the
            // user separately re-added it mid-day) — fall back to backlog rather than
            // violating the one-item-per-task-per-day invariant.
            await tx.dailyPlanItem.update({
              where: { id: item.id },
              data: { status: nextDailyPlanItemStatus(item.status, "MOVE_TO_BACKLOG") },
            });
          } else {
            const maxPos = await tx.dailyPlanItem.aggregate({ where: { workdayId: targetWorkday.id }, _max: { position: true } });
            await tx.dailyPlanItem.create({
              data: {
                workdayId: targetWorkday.id,
                taskId: item.taskId,
                position: (maxPos._max.position ?? -1) + 1,
                carriedFromItemId: item.id,
              },
            });
            await tx.dailyPlanItem.update({
              where: { id: item.id },
              data: { status: nextDailyPlanItemStatus(item.status, "CARRY_FORWARD") },
            });
          }
        } else if (d.action === "MOVE_TO_BACKLOG") {
          await tx.dailyPlanItem.update({
            where: { id: item.id },
            data: { status: nextDailyPlanItemStatus(item.status, "MOVE_TO_BACKLOG") },
          });
        } else if (d.action === "DROP") {
          await tx.dailyPlanItem.update({
            where: { id: item.id },
            data: { status: nextDailyPlanItemStatus(item.status, "DROP") },
          });
        }
      }

      await tx.workday.update({
        where: { id: workday.id },
        data: { closedAt: new Date(), reflectionNote: input.reflectionNote ?? null },
      });
      await txAudit.log({
        actorId,
        action: "workday.closed",
        entityType: "Workday",
        entityId: workday.id,
        workdayId: workday.id,
        after: { dispositionCount: input.dispositions.length, itemCount: items.length },
      });
    });

    return this.getWorkday(actorId, input.date);
  }

  // ── History (doc 19 §20/§26) ─────────────────────────────────────────

  async listHistory(actorId: string, opts: { limit?: number; cursor?: string } = {}) {
    const limit = opts.limit ?? 30;
    const rows = await this.db.workday.findMany({
      where: { userId: actorId },
      orderBy: { workDate: "desc" },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
  }
}
