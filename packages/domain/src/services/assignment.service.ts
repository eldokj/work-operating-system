import type { AuditSource, Prisma, PrismaClient } from "@ai-task-manager/db";
import { PERMISSIONS } from "@ai-task-manager/shared";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { classifyAssignmentRelationship, permissionRequiredForAssignment } from "../permission-engine/assignment-authorization";
import { canTransitionAssignment, nextAssignmentStatus } from "../state-machines/assignment-status.machine";
import { canTransitionTask, nextTaskStatus } from "../state-machines/task-status.machine";
import { AuditService } from "./audit.service";
import { NotificationService, NotificationType } from "./notification.service";
import { PermissionService } from "./permission.service";

export interface AssignmentTarget {
  assigneeType: "USER" | "TEAM";
  assigneeUserId?: string | null;
  assigneeTeamId?: string | null;
}

/**
 * The routing/acknowledgement engine — docs/architecture/06-assignment-ack-state-machine.md.
 * This is the highest-blast-radius part of the system (it's what lets a task cross team
 * and department boundaries), so every mutating method here re-derives authorization from
 * first principles rather than trusting the caller.
 */
export class AssignmentService {
  private readonly permissions: PermissionService;
  private readonly audit: AuditService;
  private readonly notifications: NotificationService;

  constructor(private readonly db: PrismaClient) {
    this.permissions = new PermissionService(db);
    this.audit = new AuditService(db);
    this.notifications = new NotificationService(db);
  }

  private async classify(actorId: string, organizationId: string, target: AssignmentTarget) {
    const actorTeams = await this.permissions.getUserOrgTeams(actorId, organizationId);
    const actorTeamIds = actorTeams.map((t) => t.teamId);
    const actorDepartmentIds = [...new Set(actorTeams.map((t) => t.departmentId).filter((d): d is string => !!d))];
    const actorHasNoOriginTeam = actorTeams.length === 0;

    let targetTeamId: string | null = null;
    let targetDepartmentId: string | null = null;

    if (target.assigneeType === "TEAM") {
      const team = await this.db.team.findUnique({ where: { id: target.assigneeTeamId! } });
      if (!team || team.organizationId !== organizationId) throw new NotFoundError("Target team not found");
      targetTeamId = team.id;
      targetDepartmentId = team.departmentId;
    } else {
      const targetUser = await this.db.user.findUnique({ where: { id: target.assigneeUserId! } });
      if (!targetUser) throw new NotFoundError("Target user not found");
      if (!(await this.permissions.isOrgMember(target.assigneeUserId!, organizationId))) {
        throw new ValidationError("Target user is not a member of this organization");
      }
      const targetUserTeams = await this.permissions.getUserOrgTeams(target.assigneeUserId!, organizationId);
      const sameTeam = targetUserTeams.find((t) => actorTeamIds.includes(t.teamId));
      if (sameTeam) {
        targetTeamId = sameTeam.teamId;
        targetDepartmentId = sameTeam.departmentId;
      } else {
        const sameDept = targetUserTeams.find((t) => t.departmentId && actorDepartmentIds.includes(t.departmentId));
        targetDepartmentId = sameDept?.departmentId ?? targetUserTeams[0]?.departmentId ?? null;
      }
    }

    const relationship = classifyAssignmentRelationship({
      actorTeamIds,
      actorDepartmentIds,
      targetTeamId,
      targetDepartmentId,
      actorHasNoOriginTeam,
    });

    return { relationship, targetTeamId, targetDepartmentId };
  }

  /**
   * Creates one "hop" of the assignment chain — the only entry point for both the first
   * assignment of a task and a mid-flight full reassignment (doc 05 §5.4). Internal
   * distribution by a Team Head goes through `reassignInternal` instead, which has
   * different authorization semantics (doc 06 §6.3).
   */
  async assign(actorId: string, taskId: string, target: AssignmentTarget, opts: { source?: AuditSource; reason?: string } = {}) {
    const task = await this.db.task.findUnique({ where: { id: taskId }, include: { workspace: true } });
    if (!task) throw new NotFoundError("Task not found");
    if (task.workspace.type === "PERSONAL") {
      throw new ForbiddenError("Personal workspace tasks cannot be assigned to another person or team (doc 13 #11)");
    }
    const organizationId = task.workspace.organizationId!;
    await this.permissions.assertOrgMember(actorId, organizationId);

    const event = task.status === "IN_PROGRESS" || task.status === "CHANGES_REQUESTED" ? "REASSIGNED" : "ASSIGN";
    if (!canTransitionTask(task.status, event)) {
      throw new ConflictError(`Task in status "${task.status}" cannot be assigned/reassigned right now`);
    }

    const { relationship, targetTeamId, targetDepartmentId } = await this.classify(actorId, organizationId, target);
    const requiredPermission = permissionRequiredForAssignment(relationship);
    await this.permissions.assertCan(actorId, organizationId, requiredPermission, {
      teamId: targetTeamId,
      departmentId: targetDepartmentId,
    });

    return this.db.$transaction(async (tx) => {
      const txAudit = new AuditService(tx);
      const txNotify = new NotificationService(tx);
      const txPermissions = new PermissionService(tx);

      const previousCurrent = await tx.taskAssignment.findFirst({ where: { taskId, isCurrent: true } });
      if (previousCurrent && canTransitionAssignment(previousCurrent.status, "SUPERSEDE")) {
        await tx.taskAssignment.update({
          where: { id: previousCurrent.id },
          data: { isCurrent: false, status: nextAssignmentStatus(previousCurrent.status, "SUPERSEDE") },
        });
      } else if (previousCurrent) {
        await tx.taskAssignment.update({ where: { id: previousCurrent.id }, data: { isCurrent: false } });
      }

      const created = await tx.taskAssignment.create({
        data: {
          taskId,
          assigneeType: target.assigneeType,
          assigneeUserId: target.assigneeType === "USER" ? target.assigneeUserId : null,
          assigneeTeamId: target.assigneeType === "TEAM" ? target.assigneeTeamId : null,
          assignedById: actorId,
          parentAssignmentId: previousCurrent?.id ?? null,
          status: "PENDING_ACKNOWLEDGEMENT",
          isCurrent: true,
        },
      });

      const newTaskStatus = nextTaskStatus(task.status, event);
      const taskUpdateData: Prisma.TaskUpdateInput = { status: newTaskStatus };
      // Origin fields are set once, at the very first assignment, and NEVER overwritten
      // afterward (doc 13 #9/#12) — also enforced by a DB trigger as defense in depth.
      if (!task.originOrganizationId) {
        taskUpdateData.originOrganization = { connect: { id: organizationId } };
        if (targetDepartmentId) taskUpdateData.originDepartment = { connect: { id: targetDepartmentId } };
        if (targetTeamId) taskUpdateData.originTeam = { connect: { id: targetTeamId } };
        taskUpdateData.originAssignor = { connect: { id: actorId } };
      }
      await tx.task.update({ where: { id: taskId }, data: taskUpdateData });

      await txAudit.log({
        organizationId,
        actorId,
        action: "task.assignment.created",
        entityType: "TaskAssignment",
        entityId: created.id,
        taskId,
        after: {
          assigneeType: target.assigneeType,
          assigneeUserId: target.assigneeUserId ?? null,
          assigneeTeamId: target.assigneeTeamId ?? null,
          relationship,
        },
        reason: opts.reason,
        source: opts.source ?? "API",
      });

      if (target.assigneeType === "USER") {
        await txNotify.notify(
          target.assigneeUserId!,
          NotificationType.TASK_ASSIGNED,
          { taskId, taskTitle: task.title, assignedBy: actorId },
          taskId
        );
      } else {
        const heads = await txPermissions.getTeamAcknowledgers(target.assigneeTeamId!);
        await txNotify.notifyMany(
          heads,
          NotificationType.TASK_ASSIGNED_TO_TEAM,
          { taskId, taskTitle: task.title, teamId: target.assigneeTeamId, assignedBy: actorId },
          taskId
        );
      }

      return created;
    });
  }

  async accept(actorId: string, assignmentId: string) {
    const assignment = await this.db.taskAssignment.findUnique({
      where: { id: assignmentId },
      include: { task: { include: { workspace: true } } },
    });
    if (!assignment) throw new NotFoundError("Assignment not found");
    const organizationId = assignment.task.workspace.organizationId!;
    await this.permissions.assertOrgMember(actorId, organizationId);

    if (assignment.assigneeType === "USER") {
      if (assignment.assigneeUserId !== actorId) {
        throw new ForbiddenError("Only the assignee can accept this assignment");
      }
      // Existence check, not scope-matched: eligibility to respond is already established
      // by `assigneeUserId === actorId` above — task.accept is typically granted via a
      // team-scoped role (e.g. MEMBER on one team), which a resource-scoped `can()` check
      // (with no team/department context available here) could never match.
      await this.permissions.assertHasAnyGrantWithPermission(actorId, organizationId, PERMISSIONS.TASK_ACCEPT);
    } else {
      if (!(await this.permissions.canActOnBehalfOfTeam(actorId, organizationId, assignment.assigneeTeamId!))) {
        throw new ForbiddenError("You are not authorized to accept on behalf of this team");
      }
    }

    if (!canTransitionAssignment(assignment.status, "ACCEPT")) {
      throw new ConflictError(`Assignment in status "${assignment.status}" cannot be accepted`);
    }

    return this.db.$transaction(async (tx) => {
      const txAudit = new AuditService(tx);
      const txNotify = new NotificationService(tx);

      const updated = await tx.taskAssignment.update({
        where: { id: assignmentId },
        data: { status: "ACCEPTED", respondedById: actorId, respondedAt: new Date() },
      });

      // doc 06 §6.3: team acceptance alone does NOT move the task to IN_PROGRESS — only
      // an individual's acceptance does.
      if (assignment.assigneeType === "USER") {
        const newStatus = nextTaskStatus(assignment.task.status, "ASSIGNMENT_ACCEPTED");
        await tx.task.update({ where: { id: assignment.taskId }, data: { status: newStatus } });
      }

      await txAudit.log({
        organizationId,
        actorId,
        action: "task.assignment.accepted",
        entityType: "TaskAssignment",
        entityId: assignmentId,
        taskId: assignment.taskId,
        before: { status: assignment.status },
        after: { status: "ACCEPTED" },
      });

      await txNotify.notify(
        assignment.assignedById,
        NotificationType.ASSIGNMENT_ACCEPTED,
        { taskId: assignment.taskId, taskTitle: assignment.task.title, acceptedBy: actorId },
        assignment.taskId
      );

      return updated;
    });
  }

  async decline(actorId: string, assignmentId: string, reason: string) {
    if (!reason || !reason.trim()) throw new ValidationError("A decline reason is required (doc 06 §6.6)");

    const assignment = await this.db.taskAssignment.findUnique({
      where: { id: assignmentId },
      include: { task: { include: { workspace: true } } },
    });
    if (!assignment) throw new NotFoundError("Assignment not found");
    const organizationId = assignment.task.workspace.organizationId!;
    await this.permissions.assertOrgMember(actorId, organizationId);

    if (assignment.assigneeType === "USER") {
      if (assignment.assigneeUserId !== actorId) {
        throw new ForbiddenError("Only the assignee can decline this assignment");
      }
      // Same reasoning as task.accept above.
      await this.permissions.assertHasAnyGrantWithPermission(actorId, organizationId, PERMISSIONS.TASK_DECLINE);
    } else {
      if (!(await this.permissions.canActOnBehalfOfTeam(actorId, organizationId, assignment.assigneeTeamId!))) {
        throw new ForbiddenError("You are not authorized to decline on behalf of this team");
      }
    }

    if (!canTransitionAssignment(assignment.status, "DECLINE")) {
      throw new ConflictError(`Assignment in status "${assignment.status}" cannot be declined`);
    }

    return this.db.$transaction(async (tx) => {
      const txAudit = new AuditService(tx);
      const txNotify = new NotificationService(tx);

      const updated = await tx.taskAssignment.update({
        where: { id: assignmentId },
        data: { status: "DECLINED", declineReason: reason, respondedById: actorId, respondedAt: new Date() },
      });

      const newStatus = nextTaskStatus(assignment.task.status, "ASSIGNMENT_DECLINED");
      await tx.task.update({ where: { id: assignment.taskId }, data: { status: newStatus } });

      await txAudit.log({
        organizationId,
        actorId,
        action: "task.assignment.declined",
        entityType: "TaskAssignment",
        entityId: assignmentId,
        taskId: assignment.taskId,
        before: { status: assignment.status },
        after: { status: "DECLINED" },
        reason,
      });

      await txNotify.notify(
        assignment.assignedById,
        NotificationType.ASSIGNMENT_DECLINED,
        { taskId: assignment.taskId, taskTitle: assignment.task.title, declinedBy: actorId, reason },
        assignment.taskId
      );

      return updated;
    });
  }

  /** Team Head (or equivalent) distributing an ACCEPTED team assignment to one member (doc 06 §6.3). */
  async reassignInternal(actorId: string, teamAssignmentId: string, targetUserId: string) {
    const teamAssignment = await this.db.taskAssignment.findUnique({
      where: { id: teamAssignmentId },
      include: { task: { include: { workspace: true } } },
    });
    if (!teamAssignment) throw new NotFoundError("Assignment not found");
    if (teamAssignment.assigneeType !== "TEAM") throw new ValidationError("This is not a team assignment");
    if (teamAssignment.status !== "ACCEPTED" || !teamAssignment.isCurrent) {
      throw new ConflictError("The team assignment must be currently ACCEPTED before internal distribution");
    }

    const organizationId = teamAssignment.task.workspace.organizationId!;
    await this.permissions.assertOrgMember(actorId, organizationId);

    const team = await this.db.team.findUnique({ where: { id: teamAssignment.assigneeTeamId! } });
    if (!team) throw new NotFoundError("Team not found");
    await this.permissions.assertCan(actorId, organizationId, PERMISSIONS.TASK_REASSIGN_INTERNAL, {
      teamId: team.id,
      departmentId: team.departmentId,
    });

    const targetMembership = await this.db.teamMember.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: targetUserId } },
    });
    if (!targetMembership) throw new ValidationError("Target user is not a member of this team");

    return this.db.$transaction(async (tx) => {
      const txAudit = new AuditService(tx);
      const txNotify = new NotificationService(tx);

      await tx.taskAssignment.update({
        where: { id: teamAssignmentId },
        data: { status: nextAssignmentStatus("ACCEPTED", "SUPERSEDE"), isCurrent: false },
      });

      const child = await tx.taskAssignment.create({
        data: {
          taskId: teamAssignment.taskId,
          assigneeType: "USER",
          assigneeUserId: targetUserId,
          assignedById: actorId,
          parentAssignmentId: teamAssignment.id,
          status: "PENDING_ACKNOWLEDGEMENT",
          isCurrent: true,
        },
      });

      // Task stays ASSIGNED — team acceptance never moved it to IN_PROGRESS (doc 06 §6.3);
      // only the individual's own acceptance does that, in accept() above.

      await txAudit.log({
        organizationId,
        actorId,
        action: "task.assignment.reassigned_internal",
        entityType: "TaskAssignment",
        entityId: child.id,
        taskId: teamAssignment.taskId,
        after: { fromTeamAssignmentId: teamAssignmentId, assigneeUserId: targetUserId },
      });

      await txNotify.notify(
        targetUserId,
        NotificationType.TASK_ASSIGNED,
        { taskId: teamAssignment.taskId, taskTitle: teamAssignment.task.title, assignedBy: actorId },
        teamAssignment.taskId
      );

      return child;
    });
  }

  /** Full lineage of a task's routing, oldest first — doc 06 §6.2. */
  async getChain(taskId: string) {
    return this.db.taskAssignment.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
      include: {
        assigneeUser: { select: { id: true, fullName: true, email: true } },
        assigneeTeam: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, fullName: true, email: true } },
        respondedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  async getCurrent(taskId: string) {
    return this.db.taskAssignment.findFirst({
      where: { taskId, isCurrent: true },
      include: {
        assigneeUser: { select: { id: true, fullName: true, email: true } },
        assigneeTeam: { select: { id: true, name: true } },
      },
    });
  }
}
