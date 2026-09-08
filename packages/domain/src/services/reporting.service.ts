import type { PrismaClient } from "@ai-task-manager/db";
import { PERMISSIONS, type TaskListFilter } from "@ai-task-manager/shared";
import { DailyWorkService, type TeamMemberDailySignal } from "./daily-work.service";
import { ForbiddenError, NotFoundError } from "../errors";
import { localDayBounds } from "../local-day";
import { isOverdue } from "../state-machines/task-status.machine";
import { PermissionService } from "./permission.service";
import { ProjectService } from "./project.service";
import { TaskService, type TaskWithDetail } from "./task.service";

// docs/architecture/21-phase4-management-visibility-architecture-report.md §6/§25 — a
// named, documented MVP default (not yet configurable per organization; §25 leaves the
// exact value an open product decision, not an architectural one). An assignment is
// "stuck" once it has sat PENDING_ACKNOWLEDGEMENT longer than this.
const STUCK_ACKNOWLEDGEMENT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** doc 21 §6 — a task's current assignment has been awaiting acknowledgement longer than
 * the stuck threshold. Computed over an already-loaded task list (no new query) — the
 * exact same data `unassigned`/`assigned`/etc. buckets already use. Exported for direct
 * unit testing (doc 21 §20 — metric definitions get their own pure-function tests,
 * independent of Prisma, matching resolve-scope.test.ts's style). */
export function isStuckAcknowledgement(
  task: Pick<TaskWithDetail, "assignments">,
  now: Date,
  thresholdMs: number = STUCK_ACKNOWLEDGEMENT_THRESHOLD_MS
): boolean {
  const current = task.assignments.find((a) => a.isCurrent);
  if (!current || current.status !== "PENDING_ACKNOWLEDGEMENT") return false;
  return now.getTime() - current.createdAt.getTime() > thresholdMs;
}

/** doc 21 §6/§22 — a small, fixed set of org/team/department-wide totals surfaced as one
 * "Attention Required" summary, never a full BI breakdown (doc 21 §12/§22's explicit
 * scope boundary). */
export interface AttentionRequiredSummary {
  stuckAcknowledgementCount: number;
  overCapacityCount: number;
  carryForwardRepeatCount: number;
  unplannedCount: number;
}

export function summarizeAttention(stuckCount: number, signals: TeamMemberDailySignal[]): AttentionRequiredSummary {
  return {
    stuckAcknowledgementCount: stuckCount,
    overCapacityCount: signals.filter((s) => s.overCapacity).length,
    carryForwardRepeatCount: signals.reduce((sum, s) => sum + s.carryForwardRepeatCount, 0),
    unplannedCount: signals.reduce((sum, s) => sum + s.unplannedItemCount, 0),
  };
}

// "Today" here now means the VIEWING USER's own local calendar day, not the server's
// clock/zone — docs/architecture/19-phase3-daily-work-cycle-architecture-report.md §2/§31.
// This was a real, pre-existing bug (this function previously used `d.setHours(...)`,
// which reads the server process's own local timezone, not any particular user's) — fixed
// here using the same `localDayBounds` utility Workday.workDate resolution uses (doc 19
// §12), so the dashboard's "Due Today" and the Daily Work Cycle's "today" can never
// disagree about what day it is for a given user.
function bucketByDueDate(tasks: TaskWithDetail[], timezone: string, now = new Date()) {
  const today = localDayBounds(now, timezone);
  const dueToday: TaskWithDetail[] = [];
  const upcoming: TaskWithDetail[] = [];
  const overdue: TaskWithDetail[] = [];
  const completed: TaskWithDetail[] = [];

  for (const t of tasks) {
    if (t.status === "COMPLETED") {
      completed.push(t);
      continue;
    }
    if (isOverdue(t.status, t.dueDate, now)) {
      overdue.push(t);
      continue;
    }
    if (t.dueDate && t.dueDate >= today.start && t.dueDate <= today.end) {
      dueToday.push(t);
      continue;
    }
    if (t.status !== "CANCELLED") upcoming.push(t);
  }
  return { dueToday, upcoming, overdue, completed };
}

/**
 * Dashboard aggregation — docs/architecture/08-screen-map.md "Dashboards", doc 20 (brief).
 * Deliberately built by composing TaskService's already-authorized queries rather than
 * re-deriving visibility rules here.
 */
export class ReportingService {
  private readonly permissions: PermissionService;
  private readonly tasks: TaskService;
  private readonly projects: ProjectService;
  private readonly dailyWork: DailyWorkService;

  constructor(private readonly db: PrismaClient) {
    this.permissions = new PermissionService(db);
    this.tasks = new TaskService(db);
    this.projects = new ProjectService(db);
    this.dailyWork = new DailyWorkService(db);
  }

  async getPersonalDashboard(actorId: string, workspaceId: string) {
    const [myTasks, actor] = await Promise.all([
      this.tasks.listTasks(actorId, workspaceId, { view: "MY_TASKS" } as TaskListFilter),
      this.db.user.findUniqueOrThrow({ where: { id: actorId }, select: { defaultTimezone: true } }),
    ]);
    const buckets = bucketByDueDate(myTasks, actor.defaultTimezone);

    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundError("Workspace not found");

    let pendingAcceptance: TaskWithDetail[] = [];
    let waitingForReview: TaskWithDetail[] = [];
    if (workspace.type === "ORGANIZATION") {
      pendingAcceptance = await this.tasks.listTasks(actorId, workspaceId, {
        view: "PENDING_MY_ACKNOWLEDGEMENT",
      } as TaskListFilter);
      const all = await this.tasks.listTasks(actorId, workspaceId, { view: "ALL" } as TaskListFilter);
      waitingForReview = all.filter(
        (t) =>
          (t.status === "SUBMITTED" || t.status === "UNDER_REVIEW") &&
          t.assignments.some((a) => a.isCurrent && a.assignedById === actorId)
      );
    }

    // Phase 2C (doc 17 §2/§16): was a raw db.project.findMany over the whole workspace —
    // the exact "lists everything" gap the report called out, fixed the same way
    // /workspaces/:id/projects was: filtered to what the caller actually participates in.
    const myProjects = await this.projects.listProjectsForUser(actorId, workspaceId);

    return {
      myTasks,
      dueToday: buckets.dueToday,
      upcoming: buckets.upcoming,
      overdue: buckets.overdue,
      completed: buckets.completed,
      pendingAcceptance,
      waitingForReview,
      myProjects,
    };
  }

  async getTeamDashboard(actorId: string, organizationId: string, teamId: string) {
    await this.permissions.assertOrgMember(actorId, organizationId);
    const team = await this.db.team.findUnique({ where: { id: teamId } });
    if (!team || team.organizationId !== organizationId) throw new NotFoundError("Team not found");

    const canView =
      (await this.db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: actorId } } })) ||
      (await this.permissions.can(actorId, organizationId, PERMISSIONS.REPORTS_VIEW, {
        teamId,
        departmentId: team.departmentId,
      }));
    if (!canView) throw new ForbiddenError("You do not have access to this team's dashboard");

    const orgWorkspace = await this.db.workspace.findFirst({ where: { type: "ORGANIZATION", organizationId } });
    if (!orgWorkspace) throw new NotFoundError("Organization workspace not found");

    const teamTasks = await this.tasks.listTasks(actorId, orgWorkspace.id, { view: "TEAM_TASKS", teamId } as TaskListFilter);
    const incoming = await this.tasks.listTasks(actorId, orgWorkspace.id, { view: "TEAM_INCOMING", teamId } as TaskListFilter);

    const unassigned = teamTasks.filter((t) => t.status === "UNASSIGNED");
    const assigned = teamTasks.filter((t) => t.status === "ASSIGNED");
    const inProgress = teamTasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "CHANGES_REQUESTED");
    const overdue = teamTasks.filter((t) => isOverdue(t.status, t.dueDate));

    const members = await this.db.teamMember.findMany({
      where: { teamId },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });

    // doc 21 §6/§8: today's Daily Work Cycle signal per member (capacity, unplanned
    // ratio, repeat carry-forward) — reused, not redefined, from DailyWorkService.
    const signals = await this.dailyWork.getTeamSignals(members.map((m) => m.userId));
    const signalByUserId = new Map(signals.map((s) => [s.userId, s]));

    const workload = members.map((m) => {
      const signal = signalByUserId.get(m.userId);
      return {
        user: m.user,
        isHead: m.isHead,
        activeTaskCount: teamTasks.filter(
          (t) =>
            t.assignments.some((a) => a.isCurrent && a.assigneeType === "USER" && a.assigneeUserId === m.userId) &&
            t.status !== "COMPLETED" &&
            t.status !== "CANCELLED"
        ).length,
        // doc 21 §6/§12 — extends the existing task-count-only workload figure with
        // today's capacity/unplanned/carry-forward signal for the same person.
        workdayStatus: signal?.workdayStatus ?? "NOT_STARTED",
        capacityMinutes: signal?.capacityMinutes ?? 0,
        plannedMinutes: signal?.plannedMinutes ?? 0,
        overCapacity: signal?.overCapacity ?? false,
        unplannedItemCount: signal?.unplannedItemCount ?? 0,
        carryForwardRepeatCount: signal?.carryForwardRepeatCount ?? 0,
      };
    });

    // doc 21 §6 — "stuck" acknowledgement: the team's current-assignment-pending tasks,
    // filtered to those older than the threshold. Computed over teamTasks (already
    // loaded above), not a new query.
    const now = new Date();
    const stuckAcknowledgement = teamTasks.filter((t) => isStuckAcknowledgement(t, now));

    return {
      team,
      teamTasks,
      unassigned,
      assigned,
      inProgress,
      overdue,
      pendingAcceptance: incoming,
      workload,
      stuckAcknowledgement,
      attentionRequired: summarizeAttention(stuckAcknowledgement.length, signals),
    };
  }

  async getOrganizationDashboard(actorId: string, organizationId: string) {
    await this.permissions.assertOrgMember(actorId, organizationId);
    await this.permissions.assertCan(actorId, organizationId, PERMISSIONS.REPORTS_VIEW);

    const orgWorkspace = await this.db.workspace.findFirst({ where: { type: "ORGANIZATION", organizationId } });
    if (!orgWorkspace) throw new NotFoundError("Organization workspace not found");

    const allTasks = await this.tasks.listTasks(actorId, orgWorkspace.id, { view: "ALL" } as TaskListFilter);
    const overdue = allTasks.filter((t) => isOverdue(t.status, t.dueDate));
    const pendingReview = allTasks.filter((t) => t.status === "SUBMITTED" || t.status === "UNDER_REVIEW");
    const completed = allTasks.filter((t) => t.status === "COMPLETED");

    const now = new Date();

    const departments = await this.db.department.findMany({ where: { organizationId } });
    const departmentPerformance = departments.map((dept) => {
      const deptTasks = allTasks.filter((t) => t.originDepartmentId === dept.id);
      return {
        department: dept,
        totalTasks: deptTasks.length,
        completed: deptTasks.filter((t) => t.status === "COMPLETED").length,
        overdue: deptTasks.filter((t) => isOverdue(t.status, t.dueDate)).length,
        // doc 21 §4/§6 — "which teams/departments have acknowledgement bottlenecks."
        stuckAcknowledgementCount: deptTasks.filter((t) => isStuckAcknowledgement(t, now)).length,
      };
    });

    const teams = await this.db.team.findMany({ where: { organizationId } });
    const teamPerformance = teams.map((team) => {
      const teamTasks = allTasks.filter(
        (t) => t.originTeamId === team.id || t.assignments.some((a) => a.isCurrent && a.assigneeTeamId === team.id)
      );
      return {
        team,
        totalTasks: teamTasks.length,
        completed: teamTasks.filter((t) => t.status === "COMPLETED").length,
        overdue: teamTasks.filter((t) => isOverdue(t.status, t.dueDate)).length,
        stuckAcknowledgementCount: teamTasks.filter((t) => isStuckAcknowledgement(t, now)).length,
      };
    });

    // doc 21 §4/§6/§18 — org-wide capacity/unplanned/carry-forward signal, one batched
    // call across every active member (bounded by org headcount, not per-member N+1).
    const activeMembers = await this.db.organizationMember.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { userId: true },
    });
    const orgSignals = await this.dailyWork.getTeamSignals(activeMembers.map((m) => m.userId));
    const stuckAcknowledgementCount = allTasks.filter((t) => isStuckAcknowledgement(t, now)).length;

    return {
      totalTasks: allTasks.length,
      overdue,
      pendingReview,
      completed,
      completionTrend: { completedCount: completed.length, totalCount: allTasks.length },
      departmentPerformance,
      teamPerformance,
      attentionRequired: summarizeAttention(stuckAcknowledgementCount, orgSignals),
    };
  }
}
