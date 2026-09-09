// Integration-style tests (real Postgres, not mocked) for Task Dependencies — doc 28,
// mirroring calendar.service.test.ts's and scheduler.service.test.ts's established style:
// a real PrismaClient against the local test database, raw role-grant fixture creation
// where that's simpler than the full HTTP role-grant flow.
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@ai-task-manager/db";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { isBlocked, TaskService } from "./task.service";

const DEFAULT_LOCAL_DB_URL = "postgresql://app:app_dev_password@localhost:5433/ai_task_manager?schema=public";
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? process.env.DATABASE_RUNTIME_URL ?? DEFAULT_LOCAL_DB_URL } },
});
const tasks = new TaskService(prisma);

async function createUser(label: string) {
  const email = `deps-${label}-${randomUUID()}@test.local`;
  return prisma.user.create({ data: { email, fullName: `Deps Test ${label}`, passwordHash: await bcrypt.hash("password123!", 4) } });
}

// This codebase deliberately does NOT auto-grant a role to a new organization member
// (organization.service.ts's own documented rule) — mirrors calendar.service.test.ts's
// identical grantCalendarEventCreate helper, for task.create instead.
async function grantTaskCreate(organizationId: string, userId: string, grantedById: string) {
  const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "task.create" } });
  const role = await prisma.role.create({ data: { organizationId, name: `Deps Test Role ${randomUUID()}`, isSystem: false } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  await prisma.userRole.create({ data: { userId, roleId: role.id, organizationId, scopeType: "ORGANIZATION", grantedById } });
}

async function createOrgWithMembers(labels: string[]) {
  const creator = await createUser(`${labels.join("-")}-creator`);
  const org = await prisma.organization.create({
    data: { name: `Deps Org ${randomUUID()}`, slug: `deps-org-${randomUUID()}`, createdById: creator.id },
  });
  const workspace = await prisma.workspace.create({ data: { type: "ORGANIZATION", organizationId: org.id, name: "Org Workspace" } });
  const users: Record<string, { id: string }> = { creator };
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: creator.id, status: "ACTIVE" } });
  await grantTaskCreate(org.id, creator.id, creator.id);
  for (const label of labels) {
    const u = await createUser(label);
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: u.id, status: "ACTIVE" } });
    await grantTaskCreate(org.id, u.id, creator.id);
    users[label] = u;
  }
  return { org, workspace, users };
}

async function createTask(actorId: string, workspaceId: string, title: string) {
  return tasks.createTask(actorId, { workspaceId, title });
}

describe("TaskService — dependencies (Phase 8)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a BLOCKS dependency and lists it from both directions with full detail for an authorized viewer", async () => {
    const { workspace, users } = await createOrgWithMembers(["depA-owner"]);
    const a = await createTask(users["depA-owner"]!.id, workspace.id, "Task A");
    const b = await createTask(users["depA-owner"]!.id, workspace.id, "Task B (blocker)");

    await tasks.addDependency(users["depA-owner"]!.id, a.id, { dependsOnTaskId: b.id, type: "BLOCKS" });

    const fromA = await tasks.listDependencies(users["depA-owner"]!.id, a.id);
    expect(fromA.dependencies).toHaveLength(1);
    expect(fromA.dependencies[0]!.relatedTask).toMatchObject({ visible: true, id: b.id, title: "Task B (blocker)" });

    const fromB = await tasks.listDependencies(users["depA-owner"]!.id, b.id);
    expect(fromB.dependedOnBy).toHaveLength(1);
    expect(fromB.dependedOnBy[0]!.relatedTask).toMatchObject({ visible: true, id: a.id, title: "Task A" });
  });

  it("rejects a task depending on itself", async () => {
    const { workspace, users } = await createOrgWithMembers(["self-owner"]);
    const a = await createTask(users["self-owner"]!.id, workspace.id, "Self-dependent task");
    await expect(tasks.addDependency(users["self-owner"]!.id, a.id, { dependsOnTaskId: a.id, type: "BLOCKS" })).rejects.toThrow();
  });

  it("rejects a dependency across two different workspaces", async () => {
    const { workspace: wsA, users: usersA } = await createOrgWithMembers(["cross-a"]);
    const { workspace: wsB, users: usersB } = await createOrgWithMembers(["cross-b"]);
    const a = await createTask(usersA["cross-a"]!.id, wsA.id, "In workspace A");
    const b = await createTask(usersB["cross-b"]!.id, wsB.id, "In workspace B");
    // usersA["cross-a"] can view b (task-level visibility check passes for the creator of
    // a totally separate task? No — cross-org member can't even view it) — the workspace
    // check must reject before that even matters, but confirm it's rejected either way.
    await expect(tasks.addDependency(usersA["cross-a"]!.id, a.id, { dependsOnTaskId: b.id, type: "BLOCKS" })).rejects.toThrow();
  });

  it("rejects a duplicate dependency (unique constraint)", async () => {
    const { workspace, users } = await createOrgWithMembers(["dup-owner"]);
    const a = await createTask(users["dup-owner"]!.id, workspace.id, "Dup A");
    const b = await createTask(users["dup-owner"]!.id, workspace.id, "Dup B");
    await tasks.addDependency(users["dup-owner"]!.id, a.id, { dependsOnTaskId: b.id, type: "BLOCKS" });
    await expect(tasks.addDependency(users["dup-owner"]!.id, a.id, { dependsOnTaskId: b.id, type: "BLOCKS" })).rejects.toThrow();
  });

  it("rejects a dependency that would create a cycle (A→B→C, then C→A)", async () => {
    const { workspace, users } = await createOrgWithMembers(["cycle-owner"]);
    const owner = users["cycle-owner"]!.id;
    const a = await createTask(owner, workspace.id, "Cycle A");
    const b = await createTask(owner, workspace.id, "Cycle B");
    const c = await createTask(owner, workspace.id, "Cycle C");

    await tasks.addDependency(owner, a.id, { dependsOnTaskId: b.id, type: "BLOCKS" }); // A depends on B
    await tasks.addDependency(owner, b.id, { dependsOnTaskId: c.id, type: "BLOCKS" }); // B depends on C

    // C depends on A would close the loop A→B→C→A.
    await expect(tasks.addDependency(owner, c.id, { dependsOnTaskId: a.id, type: "BLOCKS" })).rejects.toThrow();
  });

  it("does not reject a RELATES_TO edge that would be a cycle if it were BLOCKS (RELATES_TO never contributes to cycle detection)", async () => {
    const { workspace, users } = await createOrgWithMembers(["relates-owner"]);
    const owner = users["relates-owner"]!.id;
    const a = await createTask(owner, workspace.id, "Relates A");
    const b = await createTask(owner, workspace.id, "Relates B");
    await tasks.addDependency(owner, a.id, { dependsOnTaskId: b.id, type: "BLOCKS" });
    // b -> a as RELATES_TO is fine even though a already (BLOCKS) depends on b — doc 28 §2's
    // explicit rule that RELATES_TO carries no product behavior, including no cycle check.
    await expect(tasks.addDependency(owner, b.id, { dependsOnTaskId: a.id, type: "RELATES_TO" })).resolves.toBeTruthy();
  });

  it("only the creator/current-assignee/current-assignor can add or remove a dependency — an unrelated org member cannot", async () => {
    const { workspace, users } = await createOrgWithMembers(["edit-owner", "edit-outsider"]);
    const owner = users["edit-owner"]!.id;
    const outsider = users["edit-outsider"]!.id;
    const a = await createTask(owner, workspace.id, "Edit-gated A");
    const b = await createTask(owner, workspace.id, "Edit-gated B");

    await expect(tasks.addDependency(outsider, a.id, { dependsOnTaskId: b.id, type: "BLOCKS" })).rejects.toThrow();

    const dependency = await tasks.addDependency(owner, a.id, { dependsOnTaskId: b.id, type: "BLOCKS" });
    await expect(tasks.removeDependency(outsider, a.id, dependency.id)).rejects.toThrow();
    await expect(tasks.removeDependency(owner, a.id, dependency.id)).resolves.toBeUndefined();
  });

  it("rejects creating a dependency on a task the actor cannot view (the disclosure rule bites at creation time too)", async () => {
    const { workspace, users } = await createOrgWithMembers(["disc-a-owner", "disc-b-owner"]);
    const aOwner = users["disc-a-owner"]!.id;
    const bOwner = users["disc-b-owner"]!.id;
    const a = await createTask(aOwner, workspace.id, "Disclosure A");
    // Task B is created by a different user and never shared with aOwner in any way
    // (no assignment, no REPORTS_VIEW) — canViewTask(aOwner, B) is false.
    const b = await createTask(bOwner, workspace.id, "Disclosure B — private to its own creator");

    await expect(tasks.addDependency(aOwner, a.id, { dependsOnTaskId: b.id, type: "BLOCKS" })).rejects.toThrow();
  });

  it("the disclosure rule at READ time: a related task the viewer cannot see is returned as a minimal, non-detailed placeholder — never leaked", async () => {
    const { workspace, users } = await createOrgWithMembers(["disc2-owner", "disc2-assignee"]);
    const owner = users["disc2-owner"]!.id;
    const assignee = users["disc2-assignee"]!.id;

    const a = await createTask(owner, workspace.id, "Disclosure2 A");
    const b = await createTask(owner, workspace.id, "Disclosure2 B — never shared with the assignee");
    // owner can see both a and b (creator of both), so the dependency itself is created
    // legitimately.
    await tasks.addDependency(owner, a.id, { dependsOnTaskId: b.id, type: "BLOCKS" });

    // Now a third party gains legitimate access to A ONLY (current accepted individual
    // assignee — the same "current accountable owner" rule used everywhere in this
    // codebase), with zero relationship to B.
    await prisma.taskAssignment.create({
      data: {
        taskId: a.id,
        assigneeType: "USER",
        assigneeUserId: assignee,
        assignedById: owner,
        status: "ACCEPTED",
        respondedById: assignee,
        respondedAt: new Date(),
        isCurrent: true,
      },
    });

    const fromAssignee = await tasks.listDependencies(assignee, a.id);
    expect(fromAssignee.dependencies).toHaveLength(1);
    expect(fromAssignee.dependencies[0]!.relatedTask).toEqual({ id: b.id, visible: false });
    // Confirms no title/status/priority leaked through — the object has no other keys.
    expect(Object.keys(fromAssignee.dependencies[0]!.relatedTask)).toEqual(["id", "visible"]);
  });

  describe("isBlocked (pure function)", () => {
    it("is false with no dependencies", () => {
      expect(isBlocked({ dependencies: [] })).toBe(false);
    });
    it("is true when a BLOCKS dependency's target is not terminal", () => {
      expect(isBlocked({ dependencies: [{ dependsOnTask: { status: "IN_PROGRESS" as const } }] })).toBe(true);
    });
    it("is false once the blocking task is COMPLETED", () => {
      expect(isBlocked({ dependencies: [{ dependsOnTask: { status: "COMPLETED" as const } }] })).toBe(false);
    });
    it("is false once the blocking task is CANCELLED", () => {
      expect(isBlocked({ dependencies: [{ dependsOnTask: { status: "CANCELLED" as const } }] })).toBe(false);
    });
    it("is true if ANY of several blockers is still unresolved", () => {
      expect(
        isBlocked({
          dependencies: [{ dependsOnTask: { status: "COMPLETED" as const } }, { dependsOnTask: { status: "UNASSIGNED" as const } }],
        })
      ).toBe(true);
    });
  });
});
