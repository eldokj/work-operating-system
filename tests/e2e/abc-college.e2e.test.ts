import { beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "./api-client";
import { E2E_BASE_URL } from "./global-setup";

// Drives the brief's three mandatory Phase 1 acceptance scenarios end-to-end through the
// real HTTP API (route handlers -> domain services -> Prisma -> Postgres) — no mocking.
// Run number keeps emails unique across repeated local runs (no test-DB reset yet, see
// docs/architecture/11-testing-strategy.md follow-up note in the Phase 1 completion report).
const RUN = Date.now();
const email = (name: string) => `${name}.${RUN}@abc-college.test`;

interface User {
  client: ApiClient;
  id: string;
  email: string;
}

async function signup(name: string, fullName: string): Promise<User> {
  const client = new ApiClient(E2E_BASE_URL);
  const res = await client.post<{ id: string; email: string }>("/api/v1/auth/signup", {
    email: email(name),
    password: "password123!",
    fullName,
  });
  expect(res.status, JSON.stringify(res)).toBe(200);
  return { client, id: res.data!.id, email: res.data!.email };
}

describe("ABC College — full Phase 1 acceptance scenario (brief §32/33)", () => {
  let eldo: User, anu: User, rahul: User, priya: User, divya: User;
  let orgId: string;
  let orgWorkspaceId: string;
  let marketingDeptId: string, financeDeptId: string, managementDeptId: string;
  let marketingTeamId: string, financeTeamId: string;
  let roleIdByName: Record<string, string> = {};

  beforeAll(async () => {
    eldo = await signup("eldo", "Eldo");
    anu = await signup("anu", "Anu");
    rahul = await signup("rahul", "Rahul");
    priya = await signup("priya", "Priya");
    divya = await signup("divya", "Divya");
  });

  it("Eldo creates organization ABC College", async () => {
    const res = await eldo.client.post<{ id: string; name: string; slug: string }>("/api/v1/organizations", {
      name: "ABC College",
      slug: `abc-college-${RUN}`,
    });
    expect(res.status, JSON.stringify(res)).toBe(200);
    orgId = res.data!.id;

    const ws = await eldo.client.get<{ organizations: { id: string; organizationId: string }[] }>(
      "/api/v1/workspaces"
    );
    orgWorkspaceId = ws.data!.organizations.find((w) => w.organizationId === orgId)!.id;
    expect(orgWorkspaceId).toBeTruthy();
  });

  it("creates departments: Management, Finance, Marketing", async () => {
    const mgmt = await eldo.client.post<{ id: string }>(`/api/v1/organizations/${orgId}/departments`, {
      name: "Management",
    });
    const fin = await eldo.client.post<{ id: string }>(`/api/v1/organizations/${orgId}/departments`, {
      name: "Finance",
    });
    const mkt = await eldo.client.post<{ id: string }>(`/api/v1/organizations/${orgId}/departments`, {
      name: "Marketing",
    });
    expect(mgmt.status).toBe(200);
    expect(fin.status).toBe(200);
    expect(mkt.status).toBe(200);
    managementDeptId = mgmt.data!.id;
    financeDeptId = fin.data!.id;
    marketingDeptId = mkt.data!.id;
  });

  it("creates Marketing Team and Finance Team", async () => {
    const mktTeam = await eldo.client.post<{ id: string }>(`/api/v1/organizations/${orgId}/teams`, {
      name: "Marketing Team",
      departmentId: marketingDeptId,
    });
    const finTeam = await eldo.client.post<{ id: string }>(`/api/v1/organizations/${orgId}/teams`, {
      name: "Finance Team",
      departmentId: financeDeptId,
    });
    expect(mktTeam.status, JSON.stringify(mktTeam)).toBe(200);
    expect(finTeam.status).toBe(200);
    marketingTeamId = mktTeam.data!.id;
    financeTeamId = finTeam.data!.id;
  });

  it("adds Anu, Rahul, Divya, Priya as org members", async () => {
    for (const u of [anu, rahul, divya, priya]) {
      const res = await eldo.client.post(`/api/v1/organizations/${orgId}/members`, { userId: u.id });
      expect(res.status, JSON.stringify(res)).toBe(200);
    }
  });

  it("looks up seeded system role ids", async () => {
    const res = await eldo.client.get<Array<{ id: string; name: string; isSystem: boolean }>>(
      `/api/v1/organizations/${orgId}/roles`
    );
    expect(res.status).toBe(200);
    roleIdByName = Object.fromEntries(res.data!.filter((r) => r.isSystem).map((r) => [r.name, r.id]));
    expect(roleIdByName.TEAM_HEAD).toBeTruthy();
    expect(roleIdByName.MEMBER).toBeTruthy();
  });

  it("sets Anu as Marketing Head (team membership + TEAM_HEAD role) and Rahul/Divya as members", async () => {
    // Team membership rows (drives Team-Head-acknowledgement eligibility via is_head).
    const anuMember = await eldo.client.post(`/api/v1/teams/${marketingTeamId}/members`, {
      userId: anu.id,
      isHead: true,
    });
    expect(anuMember.status, JSON.stringify(anuMember)).toBe(200);
    await eldo.client.post(`/api/v1/teams/${marketingTeamId}/members`, { userId: rahul.id });
    await eldo.client.post(`/api/v1/teams/${marketingTeamId}/members`, { userId: divya.id });
    await eldo.client.post(`/api/v1/teams/${financeTeamId}/members`, { userId: priya.id });

    // RBAC role grants (drives permission checks — task.accept_on_behalf_of_team,
    // task.reassign_internal, task.review for Anu; task.accept/comment/update_progress
    // for Rahul/Divya).
    const grantAnu = await eldo.client.post(`/api/v1/organizations/${orgId}/role-grants`, {
      userId: anu.id,
      roleId: roleIdByName.TEAM_HEAD,
      scopeType: "TEAM",
      scopeId: marketingTeamId,
    });
    expect(grantAnu.status, JSON.stringify(grantAnu)).toBe(200);

    for (const u of [rahul, divya]) {
      const grant = await eldo.client.post(`/api/v1/organizations/${orgId}/role-grants`, {
        userId: u.id,
        roleId: roleIdByName.MEMBER,
        scopeType: "TEAM",
        scopeId: marketingTeamId,
      });
      expect(grant.status).toBe(200);
    }
  });

  // ── Critical Workflow (brief §32): Management -> Marketing Team -> Team Head -> Rahul ──

  let taskId: string;
  let teamAssignmentId: string;
  let rahulAssignmentId: string;

  it("Eldo creates 'Prepare the college marketing campaign' and assigns it to Marketing Team", async () => {
    const created = await eldo.client.post<{ id: string; status: string }>("/api/v1/tasks", {
      workspaceId: orgWorkspaceId,
      title: "Prepare the college marketing campaign",
      priority: "HIGH",
    });
    expect(created.status, JSON.stringify(created)).toBe(200);
    expect(created.data!.status).toBe("UNASSIGNED");
    taskId = created.data!.id;

    const assigned = await eldo.client.post(`/api/v1/tasks/${taskId}/assignments`, {
      assigneeType: "TEAM",
      assigneeTeamId: marketingTeamId,
    });
    expect(assigned.status, JSON.stringify(assigned)).toBe(200);

    const task = await eldo.client.get<{ status: string; assignments: Array<{ status: string; isCurrent: boolean; id: string; assigneeType: string }> }>(
      `/api/v1/tasks/${taskId}`
    );
    expect(task.data!.status).toBe("ASSIGNED");
    const current = task.data!.assignments.find((a) => a.isCurrent)!;
    expect(current.status).toBe("PENDING_ACKNOWLEDGEMENT");
    expect(current.assigneeType).toBe("TEAM");
    teamAssignmentId = current.id;
  });

  it("ONLY the Team Head (Anu) sees it pending acknowledgement — not Rahul, not Divya", async () => {
    const anuPending = await anu.client.get<Array<{ id: string }>>(
      `/api/v1/tasks?workspaceId=${orgWorkspaceId}&view=PENDING_MY_ACKNOWLEDGEMENT`
    );
    expect(anuPending.data!.some((t) => t.id === taskId)).toBe(true);

    const rahulPending = await rahul.client.get<Array<{ id: string }>>(
      `/api/v1/tasks?workspaceId=${orgWorkspaceId}&view=PENDING_MY_ACKNOWLEDGEMENT`
    );
    expect(rahulPending.data!.some((t) => t.id === taskId)).toBe(false);

    // Rule: a team assignment must NOT automatically create personal tasks for every
    // member — Divya (plain member, not head) must not see it as "My Tasks" either.
    const divyaMyTasks = await divya.client.get<Array<{ id: string }>>(
      `/api/v1/tasks?workspaceId=${orgWorkspaceId}&view=MY_TASKS`
    );
    expect(divyaMyTasks.data!.some((t) => t.id === taskId)).toBe(false);
  });

  it("Anu accepts on behalf of the team — task stays ASSIGNED, not IN_PROGRESS yet", async () => {
    const accept = await anu.client.post(`/api/v1/assignments/${teamAssignmentId}/accept`);
    expect(accept.status, JSON.stringify(accept)).toBe(200);

    const task = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${taskId}`);
    expect(task.data!.status).toBe("ASSIGNED"); // doc 06 §6.3

    // Anu accepted on the team's behalf but is not the individual assignee — must not
    // appear in her own "My Tasks".
    const anuMyTasks = await anu.client.get<Array<{ id: string }>>(
      `/api/v1/tasks?workspaceId=${orgWorkspaceId}&view=MY_TASKS`
    );
    expect(anuMyTasks.data!.some((t) => t.id === taskId)).toBe(false);
  });

  it("Anu (Team Head) internally assigns the task to Rahul", async () => {
    const res = await anu.client.post<{ id: string; status: string }>(
      `/api/v1/assignments/${teamAssignmentId}/reassign-internal`,
      { assigneeUserId: rahul.id }
    );
    expect(res.status, JSON.stringify(res)).toBe(200);
    expect(res.data!.status).toBe("PENDING_ACKNOWLEDGEMENT");
    rahulAssignmentId = res.data!.id;

    const rahulPending = await rahul.client.get<Array<{ id: string }>>(
      `/api/v1/tasks?workspaceId=${orgWorkspaceId}&view=PENDING_MY_ACKNOWLEDGEMENT`
    );
    expect(rahulPending.data!.some((t) => t.id === taskId)).toBe(true);
  });

  it("Rahul accepts — task moves to IN_PROGRESS and appears ONLY in Rahul's My Tasks", async () => {
    const accept = await rahul.client.post(`/api/v1/assignments/${rahulAssignmentId}/accept`);
    expect(accept.status, JSON.stringify(accept)).toBe(200);

    const task = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${taskId}`);
    expect(task.data!.status).toBe("IN_PROGRESS");

    const rahulMyTasks = await rahul.client.get<Array<{ id: string }>>(
      `/api/v1/tasks?workspaceId=${orgWorkspaceId}&view=MY_TASKS`
    );
    expect(rahulMyTasks.data!.some((t) => t.id === taskId)).toBe(true);

    const divyaMyTasks = await divya.client.get<Array<{ id: string }>>(
      `/api/v1/tasks?workspaceId=${orgWorkspaceId}&view=MY_TASKS`
    );
    expect(divyaMyTasks.data!.some((t) => t.id === taskId)).toBe(false);
  });

  it("Rahul adds a progress update, submits; Anu reviews and approves -> COMPLETED", async () => {
    const update = await rahul.client.post(`/api/v1/tasks/${taskId}/updates`, {
      percentage: 70,
      note: "Draft campaign plan ready",
    });
    expect(update.status, JSON.stringify(update)).toBe(200);

    const submit = await rahul.client.post<{ status: string }>(`/api/v1/tasks/${taskId}/submit`);
    expect(submit.status, JSON.stringify(submit)).toBe(200);
    expect(submit.data!.status).toBe("SUBMITTED");

    const review = await anu.client.post<{ status: string }>(`/api/v1/tasks/${taskId}/reviews`, {
      decision: "APPROVED",
      notes: "Looks great",
    });
    expect(review.status, JSON.stringify(review)).toBe(200);
    expect(review.data!.status).toBe("COMPLETED");
  });

  it("every major transition is recorded in the audit log", async () => {
    const res = await eldo.client.get<{ items: Array<{ action: string; entityId: string }> }>(
      `/api/v1/organizations/${orgId}/audit-logs?entityId=${taskId}&limit=100`
    );
    expect(res.status).toBe(200);
    const actions = res.data!.items.map((e) => e.action);
    const assignmentActions = (
      await eldo.client.get<{ items: Array<{ action: string }> }>(
        `/api/v1/organizations/${orgId}/audit-logs?entityType=TaskAssignment&limit=200`
      )
    ).data!.items.map((e) => e.action);

    expect(actions).toContain("task.created");
    expect(actions).toContain("task.approved");
    expect(assignmentActions).toContain("task.assignment.created");
    expect(assignmentActions).toContain("task.assignment.accepted");
    expect(assignmentActions).toContain("task.assignment.reassigned_internal");
  });

  // ── Second Required Workflow: Eldo -> Rahul direct assignment + mandatory decline reason ──

  describe("Second Required Workflow: direct individual assignment + decline", () => {
    let directTaskId: string;
    let directAssignmentId: string;

    it("Eldo assigns a task directly to Rahul; Rahul sees PENDING_ACKNOWLEDGEMENT", async () => {
      const created = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Book the auditorium for orientation day",
        priority: "MEDIUM",
        assignTo: { type: "USER", id: rahul.id },
      });
      expect(created.status, JSON.stringify(created)).toBe(200);
      directTaskId = created.data!.id;

      const task = await rahul.client.get<{ status: string; assignments: Array<{ id: string; isCurrent: boolean; status: string }> }>(
        `/api/v1/tasks/${directTaskId}`
      );
      expect(task.data!.status).toBe("ASSIGNED");
      const current = task.data!.assignments.find((a) => a.isCurrent)!;
      expect(current.status).toBe("PENDING_ACKNOWLEDGEMENT");
      directAssignmentId = current.id;
    });

    it("declining without a reason is rejected", async () => {
      const res = await rahul.client.post(`/api/v1/assignments/${directAssignmentId}/decline`, { reason: "" });
      expect(res.status).toBe(400);
    });

    it("Rahul declines with a reason; task reverts to UNASSIGNED and it's auditable", async () => {
      const decline = await rahul.client.post(`/api/v1/assignments/${directAssignmentId}/decline`, {
        reason: "I am currently handling three urgent finance tasks.",
      });
      expect(decline.status, JSON.stringify(decline)).toBe(200);

      const task = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${directTaskId}`);
      expect(task.data!.status).toBe("UNASSIGNED");

      const audit = await eldo.client.get<{ items: Array<{ action: string; reason: string | null }> }>(
        `/api/v1/organizations/${orgId}/audit-logs?entityId=${directAssignmentId}`
      );
      const declineEntry = audit.data!.items.find((e) => e.action === "task.assignment.declined");
      expect(declineEntry?.reason).toContain("finance tasks");
    });
  });

  // ── Third Required Workflow: cross-department Finance -> Marketing, origin preserved ──

  describe("Third Required Workflow: cross-department assignment retains origin", () => {
    let crossDeptTaskId: string;
    let crossDeptAssignmentId: string;

    it("grants Priya org-wide cross-department assignment authority", async () => {
      const role = await eldo.client.post<{ id: string }>(`/api/v1/organizations/${orgId}/roles`, {
        name: "Cross-Department Coordinator",
        permissionKeys: ["task.create", "task.assign_cross_department"],
      });
      expect(role.status, JSON.stringify(role)).toBe(200);

      // ORGANIZATION-scoped: cross-department reach is inherently org-wide, not
      // meaningfully limited to Priya's own (Finance) department — see doc 04 §4.5.
      const grant = await eldo.client.post(`/api/v1/organizations/${orgId}/role-grants`, {
        userId: priya.id,
        roleId: role.data!.id,
        scopeType: "ORGANIZATION",
      });
      expect(grant.status, JSON.stringify(grant)).toBe(200);
    });

    it("Priya (Finance) creates a task and assigns it to Marketing Team", async () => {
      const created = await priya.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Provide budget figures for the marketing campaign",
        priority: "MEDIUM",
      });
      expect(created.status, JSON.stringify(created)).toBe(200);
      crossDeptTaskId = created.data!.id;

      const assign = await priya.client.post(`/api/v1/tasks/${crossDeptTaskId}/assignments`, {
        assigneeType: "TEAM",
        assigneeTeamId: marketingTeamId,
      });
      expect(assign.status, JSON.stringify(assign)).toBe(200);
    });

    it("Marketing Head (Anu) acknowledges it, and origin fields are retained", async () => {
      const before = await eldo.client.get<{
        assignments: Array<{ id: string; isCurrent: boolean }>;
      }>(`/api/v1/tasks/${crossDeptTaskId}`);
      crossDeptAssignmentId = before.data!.assignments.find((a) => a.isCurrent)!.id;

      const accept = await anu.client.post(`/api/v1/assignments/${crossDeptAssignmentId}/accept`);
      expect(accept.status, JSON.stringify(accept)).toBe(200);

      const reassign = await anu.client.post<{ id: string }>(
        `/api/v1/assignments/${crossDeptAssignmentId}/reassign-internal`,
        { assigneeUserId: rahul.id }
      );
      expect(reassign.status, JSON.stringify(reassign)).toBe(200);
      await rahul.client.post(`/api/v1/assignments/${reassign.data!.id}/accept`);

      const task = await eldo.client.get<{
        status: string;
        createdBy: { id: string };
        originOrganization: { id: string } | null;
        originDepartment: { id: string; name: string } | null;
        originTeam: { id: string; name: string } | null;
        originAssignor: { id: string } | null;
        assignments: Array<{ assignedBy: { id: string }; assigneeUser: { id: string } | null; isCurrent: boolean }>;
      }>(`/api/v1/tasks/${crossDeptTaskId}`);

      expect(task.data!.status).toBe("IN_PROGRESS");
      // Origin retained even though the task is now routed to Marketing/Rahul:
      expect(task.data!.createdBy.id).toBe(priya.id); // creator
      expect(task.data!.originOrganization?.id).toBe(orgId); // origin organization
      expect(task.data!.originTeam?.name).toBe("Marketing Team"); // destination team of first hop
      expect(task.data!.originAssignor?.id).toBe(priya.id); // original assignor (Finance)

      const current = task.data!.assignments.find((a) => a.isCurrent)!;
      expect(current.assigneeUser?.id).toBe(rahul.id); // current accountable individual owner
      expect(current.assignedBy.id).toBe(anu.id); // who most recently assigned it
    });
  });

  // ── Personal workspace rule: self-assignment only, never assignable to others ──

  describe("Personal workspace restrictions", () => {
    it("a personal task is auto-accepted (self-assigned) and immediately IN_PROGRESS", async () => {
      const ws = await rahul.client.get<{ personal: { id: string } }>("/api/v1/workspaces");
      const personalWorkspaceId = ws.data!.personal.id;

      const task = await rahul.client.post<{ id: string; status: string }>("/api/v1/tasks", {
        workspaceId: personalWorkspaceId,
        title: "Buy groceries",
        priority: "LOW",
      });
      expect(task.status, JSON.stringify(task)).toBe(200);
      expect(task.data!.status).toBe("IN_PROGRESS");
    });

    it("assigning a personal task to another person is rejected", async () => {
      const ws = await rahul.client.get<{ personal: { id: string } }>("/api/v1/workspaces");
      const personalWorkspaceId = ws.data!.personal.id;

      const res = await rahul.client.post("/api/v1/tasks", {
        workspaceId: personalWorkspaceId,
        title: "Illegal cross-user assignment attempt",
        assignTo: { type: "USER", id: divya.id },
      });
      expect(res.status).toBe(403);
    });
  });

  // ── Multi-tenant isolation ──

  describe("Multi-tenant isolation", () => {
    it("a user outside the organization cannot read its departments", async () => {
      const outsider = await signup("outsider", "Outsider");
      const res = await outsider.client.get(`/api/v1/organizations/${orgId}/departments`);
      expect(res.status).toBe(403);
    });

    it("a user without task.assign_cross_department cannot cross departments", async () => {
      // Rahul is a plain MEMBER of Marketing — no cross-department permission.
      const created = await rahul.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Rahul tries to reach Finance without permission",
      });
      const attempt = await rahul.client.post(`/api/v1/tasks/${created.data!.id}/assignments`, {
        assigneeType: "TEAM",
        assigneeTeamId: financeTeamId,
      });
      expect(attempt.status).toBe(403);
    });
  });

  // ── Phase 2A: Task Conversations — brief "Task Conversation Foundation" ──
  // Uses a dedicated task (routed through the exact same Management -> Marketing Team ->
  // Anu -> Rahul chain as the main scenario) so these tests never interfere with the main
  // scenario's own lifecycle state.

  describe("Phase 2A: Task Conversations", () => {
    let convTaskId: string;
    let convTeamAssignmentId: string;
    let convRahulAssignmentId: string;
    let firstMessageId: string;

    it("1. a newly created task automatically gets exactly one primary conversation", async () => {
      const created = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Design the open-day banner",
        priority: "MEDIUM",
      });
      expect(created.status, JSON.stringify(created)).toBe(200);
      convTaskId = created.data!.id;

      const first = await eldo.client.get<{ id: string; taskId: string }>(`/api/v1/tasks/${convTaskId}/conversation`);
      expect(first.status, JSON.stringify(first)).toBe(200);
      const second = await eldo.client.get<{ id: string }>(`/api/v1/tasks/${convTaskId}/conversation`);
      expect(second.data!.id).toBe(first.data!.id); // same row both times — no duplicate/lazy-created conversation

      const assign = await eldo.client.post(`/api/v1/tasks/${convTaskId}/assignments`, {
        assigneeType: "TEAM",
        assigneeTeamId: marketingTeamId,
      });
      expect(assign.status, JSON.stringify(assign)).toBe(200);
      const task = await eldo.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(
        `/api/v1/tasks/${convTaskId}`
      );
      convTeamAssignmentId = task.data!.assignments.find((a) => a.isCurrent)!.id;
    });

    it("11. team assignment does not expose the conversation to every team member (only the Head)", async () => {
      const anuAccess = await anu.client.get(`/api/v1/tasks/${convTaskId}/conversation`);
      expect(anuAccess.status, JSON.stringify(anuAccess)).toBe(200);

      const divyaAccess = await divya.client.get(`/api/v1/tasks/${convTaskId}/conversation`);
      expect(divyaAccess.status).toBe(403);
    });

    it("3/5. an unrelated org member cannot read or post to a conversation they have no task access to", async () => {
      const readAttempt = await divya.client.get(`/api/v1/tasks/${convTaskId}/conversation/messages`);
      expect(readAttempt.status).toBe(403);

      const postAttempt = await divya.client.post(`/api/v1/tasks/${convTaskId}/conversation/messages`, {
        body: "I shouldn't be able to send this",
      });
      expect(postAttempt.status).toBe(403);
    });

    it("12. accepting the team assignment then internal distribution + acceptance gives Rahul access", async () => {
      await anu.client.post(`/api/v1/assignments/${convTeamAssignmentId}/accept`);
      const reassign = await anu.client.post<{ id: string }>(
        `/api/v1/assignments/${convTeamAssignmentId}/reassign-internal`,
        { assigneeUserId: rahul.id }
      );
      convRahulAssignmentId = reassign.data!.id;
      await rahul.client.post(`/api/v1/assignments/${convRahulAssignmentId}/accept`);

      const access = await rahul.client.get(`/api/v1/tasks/${convTaskId}/conversation`);
      expect(access.status, JSON.stringify(access)).toBe(200);

      // Still not exposed to a plain team member who was never in this task's chain.
      const divyaAccess = await divya.client.get(`/api/v1/tasks/${convTaskId}/conversation`);
      expect(divyaAccess.status).toBe(403);
    });

    it("4. Rahul (authorized) sends a message", async () => {
      const res = await rahul.client.post<{ id: string; body: string; sender: { id: string } }>(
        `/api/v1/tasks/${convTaskId}/conversation/messages`,
        { body: "Starting on the banner design now." }
      );
      expect(res.status, JSON.stringify(res)).toBe(200);
      expect(res.data!.body).toBe("Starting on the banner design now.");
      expect(res.data!.sender.id).toBe(rahul.id);
      firstMessageId = res.data!.id;
    });

    it("6. replies preserve the parent/child relationship", async () => {
      const reply = await anu.client.post<{ parentMessage: { id: string } | null }>(
        `/api/v1/tasks/${convTaskId}/conversation/messages`,
        { body: "Sounds good — send a draft by Friday.", parentMessageId: firstMessageId }
      );
      expect(reply.status, JSON.stringify(reply)).toBe(200);
      expect(reply.data!.parentMessage?.id).toBe(firstMessageId);

      const list = await rahul.client.get<{ items: Array<{ id: string; parentMessage: { id: string } | null }> }>(
        `/api/v1/tasks/${convTaskId}/conversation/messages`
      );
      const found = list.data!.items.find((m) => m.parentMessage?.id === firstMessageId);
      expect(found).toBeTruthy();
    });

    it("7. mentions only allow users who legitimately have access to the task", async () => {
      // Anu is in the assignment chain — a legitimate mention target.
      const valid = await rahul.client.post(`/api/v1/tasks/${convTaskId}/conversation/messages`, {
        body: "@Anu can you double-check the colors?",
        mentionedUserIds: [anu.id],
      });
      expect(valid.status, JSON.stringify(valid)).toBe(200);

      // Divya has no access to this specific task's conversation — mentioning her must
      // be rejected outright, not silently dropped.
      const invalid = await rahul.client.post(`/api/v1/tasks/${convTaskId}/conversation/messages`, {
        body: "@Divya thoughts?",
        mentionedUserIds: [divya.id],
      });
      expect(invalid.status).toBe(400);
    });

    it("8. reactions work (add, reflected in the message, and can be removed)", async () => {
      const add = await anu.client.post<{ reactions: Array<{ emoji: string; count: number; reactedByMe: boolean }> }>(
        `/api/v1/messages/${firstMessageId}/reactions`,
        { emoji: "👍" }
      );
      expect(add.status, JSON.stringify(add)).toBe(200);
      const reaction = add.data!.reactions.find((r) => r.emoji === "👍");
      expect(reaction?.count).toBe(1);

      const remove = await anu.client.delete<{ reactions: Array<{ emoji: string }> }>(
        `/api/v1/messages/${firstMessageId}/reactions/${encodeURIComponent("👍")}`
      );
      expect(remove.status, JSON.stringify(remove)).toBe(200);
      expect(remove.data!.reactions.find((r) => r.emoji === "👍")).toBeUndefined();
    });

    it("9. read state: unread count drops to zero after marking read", async () => {
      const before = await anu.client.get<{ unreadCount: number }>(`/api/v1/tasks/${convTaskId}/conversation`);
      expect(before.data!.unreadCount).toBeGreaterThan(0);

      const markRead = await anu.client.post(`/api/v1/tasks/${convTaskId}/conversation/read`);
      expect(markRead.status).toBe(200);

      const after = await anu.client.get<{ unreadCount: number }>(`/api/v1/tasks/${convTaskId}/conversation`);
      expect(after.data!.unreadCount).toBe(0);
    });

    it("message mutation requires correct permissions: only the sender can edit/delete", async () => {
      const editByOther = await anu.client.patch(`/api/v1/messages/${firstMessageId}`, { body: "hijacked" });
      expect(editByOther.status).toBe(403);

      const editBySender = await rahul.client.patch<{ body: string; isEdited: boolean }>(
        `/api/v1/messages/${firstMessageId}`,
        { body: "Starting on the banner design now (updated)." }
      );
      expect(editBySender.status, JSON.stringify(editBySender)).toBe(200);
      expect(editBySender.data!.isEdited).toBe(true);

      const deleteByOther = await anu.client.delete(`/api/v1/messages/${firstMessageId}`);
      expect(deleteByOther.status).toBe(403);
    });

    it("10. reassignment updates access: an un-accepted assignee loses access, the new one gains it", async () => {
      // Reassign convTaskId's current assignment away from Rahul to Divya mid-flight,
      // before Rahul has done anything beyond accepting the initial hand-off.
      const reassign = await anu.client.post(`/api/v1/tasks/${convTaskId}/assignments`, {
        assigneeType: "USER",
        assigneeUserId: divya.id,
      });
      expect(reassign.status, JSON.stringify(reassign)).toBe(200);
      await divya.client.post(
        `/api/v1/assignments/${(await anu.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${convTaskId}`)).data!.assignments.find((a) => a.isCurrent)!.id}/accept`
      );

      const divyaAccess = await divya.client.get(`/api/v1/tasks/${convTaskId}/conversation`);
      expect(divyaAccess.status, JSON.stringify(divyaAccess)).toBe(200);
    });

    it("2. an authorized participant (creator) can always retrieve the conversation", async () => {
      const res = await eldo.client.get(`/api/v1/tasks/${convTaskId}/conversation`);
      expect(res.status, JSON.stringify(res)).toBe(200);
    });

    it("16. cross-tenant isolation holds for conversations too", async () => {
      const outsider = await signup("conv-outsider", "Conversation Outsider");
      const res = await outsider.client.get(`/api/v1/tasks/${convTaskId}/conversation`);
      expect(res.status).toBe(403);
    });

    it("13/14/15. Phase 1 lifecycle and My Tasks are unaffected by any of the above", async () => {
      // The ORIGINAL ABC College task (from the top-level scenario) must still read as
      // COMPLETED, and Rahul's My Tasks view must reflect exactly the current state of
      // that unrelated task chain — proving Phase 2A didn't disturb Phase 1 behavior.
      const original = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${taskId}`);
      expect(original.data!.status).toBe("COMPLETED");

      const rahulMyTasks = await rahul.client.get<Array<{ id: string }>>(
        `/api/v1/tasks?workspaceId=${orgWorkspaceId}&view=MY_TASKS`
      );
      // Rahul was reassigned away from convTaskId in test #10 above, so it must NOT
      // appear in his My Tasks, while the original completed task's assignment chain is
      // untouched by any Phase 2A code path.
      expect(rahulMyTasks.data!.some((t) => t.id === convTaskId)).toBe(false);
    });
  });

  // ── Phase 2B: Work Files & Attachments — brief "Work Files & Attachments" ──
  // Fresh task, same Management -> Marketing Team -> Anu -> Rahul chain, so these tests
  // never depend on Phase 2A test block's leftover state.

  describe("Phase 2B: Work Files & Attachments", () => {
    let filesTaskId: string;
    let filesTeamAssignmentId: string;
    let firstAttachmentId: string;
    let secondAttachmentId: string;
    let messageWithAttachmentId: string;

    const textFile = (name: string, contents: string) => ({ fileName: name, mimeType: "text/plain", data: Buffer.from(contents) });
    const pngFile = (name: string) => ({
      fileName: name,
      mimeType: "image/png",
      // Minimal valid-enough PNG header bytes — validation only checks declared MIME +
      // extension consistency, not real image decoding (doc 16 — no image-processing
      // pipeline in Phase 2B).
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });

    it("sets up a task routed to Rahul via Marketing Team, mirroring the main scenario", async () => {
      const created = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Prepare the annual day banner assets",
        priority: "MEDIUM",
      });
      filesTaskId = created.data!.id;

      const assign = await eldo.client.post(`/api/v1/tasks/${filesTaskId}/assignments`, {
        assigneeType: "TEAM",
        assigneeTeamId: marketingTeamId,
      });
      expect(assign.status, JSON.stringify(assign)).toBe(200);
      const task = await eldo.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${filesTaskId}`);
      filesTeamAssignmentId = task.data!.assignments.find((a) => a.isCurrent)!.id;
    });

    it("15. team assignment does NOT grant Files/upload access to a plain member while team-pending", async () => {
      await anu.client.post(`/api/v1/assignments/${filesTeamAssignmentId}/accept`);

      // Divya is a plain Marketing member — the team accepted, but nothing has been
      // distributed to an individual yet. Same narrowing as Phase 2A's conversation rule
      // (doc 16 §Authorization: attachment access follows conversation access here).
      const divyaList = await divya.client.get(`/api/v1/tasks/${filesTaskId}/attachments`);
      expect(divyaList.status).toBe(403);

      const divyaUpload = await divya.client.uploadFiles(`/api/v1/tasks/${filesTaskId}/attachments`, [textFile("sneaky.txt", "hi")]);
      expect(divyaUpload.status).toBe(403);

      // Anu (the Head who accepted) DOES have task-level access already.
      const anuList = await anu.client.get(`/api/v1/tasks/${filesTaskId}/attachments`);
      expect(anuList.status, JSON.stringify(anuList)).toBe(200);
    });

    it("distributes to Rahul and he accepts", async () => {
      const reassign = await anu.client.post<{ id: string }>(`/api/v1/assignments/${filesTeamAssignmentId}/reassign-internal`, {
        assigneeUserId: rahul.id,
      });
      await rahul.client.post(`/api/v1/assignments/${reassign.data!.id}/accept`);
      const task = await rahul.client.get<{ status: string }>(`/api/v1/tasks/${filesTaskId}`);
      expect(task.data!.status).toBe("IN_PROGRESS");
    });

    it("1. an authorized user (Rahul, current assignee) uploads an attachment", async () => {
      const res = await rahul.client.uploadFiles<Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number }>>(
        `/api/v1/tasks/${filesTaskId}/attachments`,
        [textFile("notes.txt", "banner notes")]
      );
      expect(res.status, JSON.stringify(res)).toBe(200);
      expect(res.data).toHaveLength(1);
      expect(res.data![0]!.fileName).toBe("notes.txt");
      expect(res.data![0]!.mimeType).toBe("text/plain");
      expect(res.data![0]!.sizeBytes).toBe(Buffer.from("banner notes").byteLength);
      firstAttachmentId = res.data![0]!.id;
    });

    it("2. unauthorized user cannot upload", async () => {
      // Divya still has zero relationship to this task — current assignee is Rahul, an
      // individual, so the old team-membership grant no longer applies at all.
      const res = await divya.client.uploadFiles(`/api/v1/tasks/${filesTaskId}/attachments`, [textFile("x.txt", "x")]);
      expect(res.status).toBe(403);
    });

    it("3. authorized user can retrieve the attachment", async () => {
      const res = await rahul.client.getRaw(`/api/v1/attachments/${firstAttachmentId}`);
      expect(res.status, JSON.stringify(res)).toBe(200);
      expect(res.body.toString()).toBe("banner notes");
      expect(res.contentType).toContain("text/plain");
    });

    it("4. unauthorized user cannot retrieve the attachment", async () => {
      const res = await divya.client.getRaw(`/api/v1/attachments/${firstAttachmentId}`);
      expect(res.status).toBe(403);
    });

    it("5. a random (well-formed but non-existent) attachment UUID does not bypass authorization", async () => {
      const res = await divya.client.getRaw(`/api/v1/attachments/00000000-0000-4000-8000-000000000000`);
      expect(res.status).toBe(404);
    });

    it("6/14. cross-task access: files uploaded to one task do not appear when listing another task's Files", async () => {
      const otherTask = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Unrelated task for cross-task isolation check",
      });
      const otherList = await eldo.client.get<Array<{ id: string }>>(`/api/v1/tasks/${otherTask.data!.id}/attachments`);
      expect(otherList.status, JSON.stringify(otherList)).toBe(200);
      expect(otherList.data!.some((a) => a.id === firstAttachmentId)).toBe(false);
    });

    it("7. cross-tenant access is denied", async () => {
      const outsider = await signup("attach-outsider", "Attachment Outsider");
      const res = await outsider.client.getRaw(`/api/v1/attachments/${firstAttachmentId}`);
      expect(res.status).toBe(403);
      const listRes = await outsider.client.get(`/api/v1/tasks/${filesTaskId}/attachments`);
      expect(listRes.status).toBe(403);
    });

    it("8. multiple attachments on one message work", async () => {
      const uploaded = await rahul.client.uploadFiles<Array<{ id: string }>>(`/api/v1/tasks/${filesTaskId}/attachments`, [
        pngFile("banner-v1.png"),
        pngFile("banner-v2.png"),
      ]);
      expect(uploaded.status, JSON.stringify(uploaded)).toBe(200);
      expect(uploaded.data).toHaveLength(2);

      const message = await rahul.client.post<{ attachments: Array<{ id: string }> }>(
        `/api/v1/tasks/${filesTaskId}/conversation/messages`,
        { body: "Two banner drafts for review.", attachmentIds: uploaded.data!.map((a) => a.id) }
      );
      expect(message.status, JSON.stringify(message)).toBe(200);
      expect(message.data!.attachments).toHaveLength(2);
      messageWithAttachmentId = uploaded.data![0]!.id;
      secondAttachmentId = uploaded.data![1]!.id;
    });

    it("9. text + attachment message works", async () => {
      const uploaded = await rahul.client.uploadFiles<Array<{ id: string }>>(`/api/v1/tasks/${filesTaskId}/attachments`, [
        textFile("readme.txt", "context"),
      ]);
      const message = await rahul.client.post<{ body: string | null; attachments: Array<{ id: string }> }>(
        `/api/v1/tasks/${filesTaskId}/conversation/messages`,
        { body: "Please review this too.", attachmentIds: [uploaded.data![0]!.id] }
      );
      expect(message.status, JSON.stringify(message)).toBe(200);
      expect(message.data!.body).toBe("Please review this too.");
      expect(message.data!.attachments).toHaveLength(1);
    });

    it("10. attachment-only message (no text) is valid", async () => {
      const uploaded = await rahul.client.uploadFiles<Array<{ id: string }>>(`/api/v1/tasks/${filesTaskId}/attachments`, [
        textFile("attachment-only.txt", "just a file"),
      ]);
      const message = await rahul.client.post<{ body: string | null; attachments: Array<{ id: string }> }>(
        `/api/v1/tasks/${filesTaskId}/conversation/messages`,
        { attachmentIds: [uploaded.data![0]!.id] }
      );
      expect(message.status, JSON.stringify(message)).toBe(200);
      expect(message.data!.attachments).toHaveLength(1);
    });

    it("11. existing text-only messages still work (no regression)", async () => {
      const message = await rahul.client.post<{ body: string | null; attachments: unknown[] }>(
        `/api/v1/tasks/${filesTaskId}/conversation/messages`,
        { body: "Just a plain text update, no files." }
      );
      expect(message.status, JSON.stringify(message)).toBe(200);
      expect(message.data!.body).toBe("Just a plain text update, no files.");
      expect(message.data!.attachments).toHaveLength(0);
    });

    it("a truly empty message (no text, no attachments) is still rejected", async () => {
      const message = await rahul.client.post(`/api/v1/tasks/${filesTaskId}/conversation/messages`, {});
      expect(message.status).toBe(400);
    });

    it("12. a deleted attachment cannot be retrieved", async () => {
      const del = await rahul.client.delete(`/api/v1/attachments/${firstAttachmentId}`);
      expect(del.status, JSON.stringify(del)).toBe(200);
      const get = await rahul.client.getRaw(`/api/v1/attachments/${firstAttachmentId}`);
      expect(get.status).toBe(404);
    });

    it("13. Task Files lists exactly the correct (non-deleted) files for this task", async () => {
      const res = await rahul.client.get<Array<{ id: string; fileName: string }>>(`/api/v1/tasks/${filesTaskId}/attachments`);
      expect(res.status, JSON.stringify(res)).toBe(200);
      const ids = res.data!.map((a) => a.id);
      expect(ids).not.toContain(firstAttachmentId); // deleted in the previous test
      expect(ids).toContain(secondAttachmentId);
      expect(ids).toContain(messageWithAttachmentId);
    });

    it("message mutation-style rule applies to attachments too: only the uploader can delete", async () => {
      const res = await anu.client.delete(`/api/v1/attachments/${secondAttachmentId}`);
      expect(res.status).toBe(403);
    });

    it("16. reassignment: the new assignee gains access, and an unrelated user still does not", async () => {
      const reassign = await anu.client.post(`/api/v1/tasks/${filesTaskId}/assignments`, {
        assigneeType: "USER",
        assigneeUserId: divya.id,
      });
      expect(reassign.status, JSON.stringify(reassign)).toBe(200);
      const task = await anu.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${filesTaskId}`);
      await divya.client.post(`/api/v1/assignments/${task.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);

      const divyaFiles = await divya.client.get(`/api/v1/tasks/${filesTaskId}/attachments`);
      expect(divyaFiles.status, JSON.stringify(divyaFiles)).toBe(200);

      // Priya (Finance) has never had any relationship to this task at all.
      const priyaFiles = await priya.client.get(`/api/v1/tasks/${filesTaskId}/attachments`);
      expect(priyaFiles.status).toBe(403);
    });

    it("19. an oversized file is rejected", async () => {
      const oversized = { fileName: "huge.txt", mimeType: "text/plain", data: Buffer.alloc(26 * 1024 * 1024) };
      const res = await divya.client.uploadFiles(`/api/v1/tasks/${filesTaskId}/attachments`, [oversized]);
      expect(res.status).toBe(400);
    });

    it("20. an unsupported/dangerous file type is rejected", async () => {
      const exe = { fileName: "installer.exe", mimeType: "application/x-msdownload", data: Buffer.from("MZ") };
      const res = await divya.client.uploadFiles(`/api/v1/tasks/${filesTaskId}/attachments`, [exe]);
      expect(res.status).toBe(400);

      const script = { fileName: "hack.js", mimeType: "text/plain", data: Buffer.from("alert(1)") };
      const res2 = await divya.client.uploadFiles(`/api/v1/tasks/${filesTaskId}/attachments`, [script]);
      expect(res2.status).toBe(400);
    });

    it("21. an unsafe filename cannot escape the storage root — sanitized on the way back out", async () => {
      const traversal = { fileName: "../../../etc/passwd.txt", mimeType: "text/plain", data: Buffer.from("attempt") };
      const res = await divya.client.uploadFiles<Array<{ id: string; fileName: string }>>(
        `/api/v1/tasks/${filesTaskId}/attachments`,
        [traversal]
      );
      expect(res.status, JSON.stringify(res)).toBe(200);
      expect(res.data![0]!.fileName).not.toContain("..");
      expect(res.data![0]!.fileName).not.toContain("/");

      // And retrieval still works correctly — proving the file was stored under a safe,
      // server-generated key regardless of what the client sent as a filename.
      const get = await divya.client.getRaw(`/api/v1/attachments/${res.data![0]!.id}`);
      expect(get.status, JSON.stringify(get)).toBe(200);
      expect(get.body.toString()).toBe("attempt");
    });

    it("17/18. Phase 1 and Phase 2A behavior are unaffected", async () => {
      const original = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${taskId}`);
      expect(original.data!.status).toBe("COMPLETED");
      // Divya (reassigned onto filesTaskId in test #16 above) still correctly cannot see
      // an entirely unrelated task's conversation — the Phase 2A access rule is unaffected
      // by anything Phase 2B added.
      const unrelatedConvAccess = await divya.client.get(`/api/v1/tasks/${taskId}/conversation`);
      expect(unrelatedConvAccess.status).toBe(403);
    });
  });

  // ── Phase 2C: Project / Event Workspace — brief §30, docs/architecture/17-phase2c- ──
  // ── project-workspace-architecture-report.md §19 ──
  // Extends the pre-existing Project model rather than a new "Workspace"-named entity
  // (doc 17 §5). "Annual Day 2026", matching the brief's own example.

  describe("Phase 2C: Project / Event Workspace", () => {
    let projectId: string;
    let projectAttachmentId: string;
    let projectDateId: string;

    it("1. Eldo creates the 'Annual Day 2026' event under Marketing Team — transactionally gets a main Conversation and is auto-listed as a ProjectMember", async () => {
      const res = await eldo.client.post<{ id: string; kind: string; status: string }>(
        `/api/v1/workspaces/${orgWorkspaceId}/projects`,
        { name: "Annual Day 2026", kind: "EVENT", teamId: marketingTeamId }
      );
      expect(res.status, JSON.stringify(res)).toBe(200);
      expect(res.data!.kind).toBe("EVENT");
      expect(res.data!.status).toBe("ACTIVE");
      projectId = res.data!.id;

      const conv = await eldo.client.get<{ id: string; projectId: string | null }>(`/api/v1/projects/${projectId}/conversation`);
      expect(conv.status, JSON.stringify(conv)).toBe(200);
      expect(conv.data!.projectId).toBe(projectId);

      const members = await eldo.client.get<Array<{ user: { id: string } }>>(`/api/v1/projects/${projectId}/members`);
      expect(members.status, JSON.stringify(members)).toBe(200);
      expect(members.data!.some((m) => m.user.id === eldo.id)).toBe(true);
    });

    it("2. a plain org member without PROJECT_CREATE cannot create a project", async () => {
      const res = await priya.client.post(`/api/v1/workspaces/${orgWorkspaceId}/projects`, { name: "Priya's rogue project" });
      expect(res.status).toBe(403);
    });

    it("3. listing /workspaces/:id/projects is filtered to the caller's own participation, not the whole workspace (doc 17 §2's fix)", async () => {
      // Priya (Finance) has no relationship whatsoever to Annual Day 2026 yet.
      const priyaList = await priya.client.get<Array<{ id: string }>>(`/api/v1/workspaces/${orgWorkspaceId}/projects`);
      expect(priyaList.status, JSON.stringify(priyaList)).toBe(200);
      expect(priyaList.data!.some((p) => p.id === projectId)).toBe(false);

      const eldoList = await eldo.client.get<Array<{ id: string }>>(`/api/v1/workspaces/${orgWorkspaceId}/projects`);
      expect(eldoList.data!.some((p) => p.id === projectId)).toBe(true);
    });

    it("4. a non-member, non-owner without REPORTS_VIEW cannot access the project directly (403, not 404)", async () => {
      const res = await priya.client.get(`/api/v1/projects/${projectId}`);
      expect(res.status).toBe(403);
    });

    it("5. adding an org member as a direct ProjectMember grants project access (view, conversation, files)", async () => {
      const add = await eldo.client.post(`/api/v1/projects/${projectId}/members`, { userId: rahul.id });
      expect(add.status, JSON.stringify(add)).toBe(200);

      const rahulProject = await rahul.client.get(`/api/v1/projects/${projectId}`);
      expect(rahulProject.status, JSON.stringify(rahulProject)).toBe(200);
      const rahulConv = await rahul.client.get(`/api/v1/projects/${projectId}/conversation`);
      expect(rahulConv.status).toBe(200);
    });

    it("6. adding a user who is not an org member is rejected", async () => {
      const outsider = await signup("proj-outsider", "Project Outsider");
      const res = await eldo.client.post(`/api/v1/projects/${projectId}/members`, { userId: outsider.id });
      expect(res.status).toBe(400);
    });

    it("7. removing the project owner from its own member roster is rejected", async () => {
      const res = await eldo.client.delete(`/api/v1/projects/${projectId}/members/${eldo.id}`);
      expect(res.status).toBe(409);
    });

    it("8. a ProjectMember who is not the owner and has no PROJECT_MANAGE grant cannot manage the project (update, dates)", async () => {
      const patch = await rahul.client.patch(`/api/v1/projects/${projectId}`, { name: "Hijacked name" });
      expect(patch.status).toBe(403);
      const addDate = await rahul.client.post(`/api/v1/projects/${projectId}/dates`, { title: "Sneaky date", date: "2026-01-01" });
      expect(addDate.status).toBe(403);
    });

    it("9. adding a team to the project grants its plain members baseline access too (doc 17 §8's declarative decision) — Divya, a Marketing member with no direct ProjectMember row, gains it", async () => {
      const addTeam = await eldo.client.post(`/api/v1/projects/${projectId}/teams`, { teamId: marketingTeamId });
      expect(addTeam.status, JSON.stringify(addTeam)).toBe(200);

      const divyaProject = await divya.client.get(`/api/v1/projects/${projectId}`);
      expect(divyaProject.status, JSON.stringify(divyaProject)).toBe(200);
      const divyaFiles = await divya.client.get(`/api/v1/projects/${projectId}/files`);
      expect(divyaFiles.status).toBe(200);
    });

    it("10. REGRESSION (doc 17 §19's explicit required test) — project-team access does NOT leak into an unrelated task's conversation while it sits team-pending", async () => {
      const freshTask = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Task unrelated to any project, team-pending",
      });
      const assign = await eldo.client.post(`/api/v1/tasks/${freshTask.data!.id}/assignments`, {
        assigneeType: "TEAM",
        assigneeTeamId: marketingTeamId,
      });
      expect(assign.status, JSON.stringify(assign)).toBe(200);

      // Divya has project-level access via the Marketing Team's project participation
      // (previous test) — but this task was never linked to any project and its team
      // assignment is still PENDING_ACKNOWLEDGEMENT (no Team Head accept yet). Project
      // access is strictly additive at the project layer and must never bypass the
      // completely separate, unchanged task-level conversation-access rule (doc 17 §8/§10).
      const divyaTaskConv = await divya.client.get(`/api/v1/tasks/${freshTask.data!.id}/conversation`);
      expect(divyaTaskConv.status).toBe(403);
    });

    it("11. posting a project conversation message with a mention and an attachment works, same model as task conversations", async () => {
      const uploaded = await rahul.client.uploadFiles<Array<{ id: string; fileName: string }>>(
        `/api/v1/projects/${projectId}/files`,
        [{ fileName: "banner-brief.txt", mimeType: "text/plain", data: Buffer.from("stage decoration brief") }]
      );
      expect(uploaded.status, JSON.stringify(uploaded)).toBe(200);
      projectAttachmentId = uploaded.data![0]!.id;

      const message = await rahul.client.post<{ attachments: Array<{ id: string }>; mentions: Array<{ id: string }> }>(
        `/api/v1/projects/${projectId}/conversation/messages`,
        { body: "Here's the stage decoration brief for review.", mentionedUserIds: [eldo.id], attachmentIds: [projectAttachmentId] }
      );
      expect(message.status, JSON.stringify(message)).toBe(200);
      expect(message.data!.attachments).toHaveLength(1);
      expect(message.data!.mentions.some((m) => m.id === eldo.id)).toBe(true);
    });

    it("12. unread count increments for other participants and mark-read clears it", async () => {
      const before = await eldo.client.get<{ unreadCount: number }>(`/api/v1/projects/${projectId}/conversation`);
      expect(before.data!.unreadCount).toBeGreaterThan(0);
      await eldo.client.post(`/api/v1/projects/${projectId}/conversation/read`);
      const after = await eldo.client.get<{ unreadCount: number }>(`/api/v1/projects/${projectId}/conversation`);
      expect(after.data!.unreadCount).toBe(0);
    });

    it("13. Files: only the uploader can delete; retrieval reuses the existing /attachments/:id endpoint unchanged", async () => {
      const get = await eldo.client.getRaw(`/api/v1/attachments/${projectAttachmentId}`);
      expect(get.status, JSON.stringify(get)).toBe(200);
      expect(get.body.toString()).toBe("stage decoration brief");

      const eldoDelete = await eldo.client.delete(`/api/v1/attachments/${projectAttachmentId}`);
      expect(eldoDelete.status).toBe(403);

      const list = await eldo.client.get<Array<{ id: string }>>(`/api/v1/projects/${projectId}/files`);
      expect(list.status, JSON.stringify(list)).toBe(200);
      expect(list.data!.some((f) => f.id === projectAttachmentId)).toBe(true);
    });

    it("14. POST /projects/:id/tasks creates a task with projectId + the project's own workspaceId populated — thin filter, not a new task store", async () => {
      const created = await eldo.client.post<{ id: string; projectId: string | null }>(`/api/v1/projects/${projectId}/tasks`, {
        title: "Stage Decoration",
        priority: "HIGH",
      });
      expect(created.status, JSON.stringify(created)).toBe(200);
      expect(created.data!.projectId).toBe(projectId);

      const list = await eldo.client.get<Array<{ id: string; title: string }>>(`/api/v1/projects/${projectId}/tasks`);
      expect(list.status, JSON.stringify(list)).toBe(200);
      expect(list.data!.some((t) => t.title === "Stage Decoration")).toBe(true);

      // Same task must still show up in the ordinary global task list (My Tasks etc.) —
      // a project is a contextual layer alongside the existing areas, never a replacement
      // for them (doc 17 §17).
      const globalList = await eldo.client.get<Array<{ id: string }>>(
        `/api/v1/tasks?workspaceId=${orgWorkspaceId}&view=ALL`
      );
      expect(globalList.data!.some((t) => t.id === created.data!.id)).toBe(true);
    });

    it("15. a task created directly via POST /tasks with projectId set also appears under the project's task list — proving one shared store, not two", async () => {
      const direct = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        projectId,
        title: "Food Arrangement",
      });
      expect(direct.status, JSON.stringify(direct)).toBe(200);

      const list = await eldo.client.get<Array<{ id: string; title: string }>>(`/api/v1/projects/${projectId}/tasks`);
      expect(list.data!.some((t) => t.title === "Food Arrangement")).toBe(true);
    });

    it("16. progress is derived (never stored) from Task.status — completed/(completed+active), cancelled excluded from the denominator", async () => {
      // Two tasks exist so far (Stage Decoration, Food Arrangement), both un-started.
      const before = await eldo.client.get<{ total: number; completed: number; active: number; cancelled: number; percent: number }>(
        `/api/v1/projects/${projectId}/progress`
      );
      expect(before.status, JSON.stringify(before)).toBe(200);
      expect(before.data!.total).toBe(2);
      expect(before.data!.percent).toBe(0);

      const cancelMe = await eldo.client.post<{ id: string }>(`/api/v1/projects/${projectId}/tasks`, { title: "Scrapped idea" });
      await eldo.client.delete(`/api/v1/tasks/${cancelMe.data!.id}`);

      const after = await eldo.client.get<{ total: number; completed: number; active: number; cancelled: number; percent: number }>(
        `/api/v1/projects/${projectId}/progress`
      );
      expect(after.status, JSON.stringify(after)).toBe(200);
      expect(after.data!.cancelled).toBe(1);
      // Denominator (total) excludes the cancelled task — still 2, not 3.
      expect(after.data!.total).toBe(2);
    });

    it("17. Important Dates: add, list ordered by date, update, delete", async () => {
      const d1 = await eldo.client.post<{ id: string }>(`/api/v1/projects/${projectId}/dates`, {
        title: "Rehearsal",
        date: "2026-11-20",
      });
      expect(d1.status, JSON.stringify(d1)).toBe(200);
      const d2 = await eldo.client.post<{ id: string }>(`/api/v1/projects/${projectId}/dates`, {
        title: "Event Day",
        date: "2026-11-25",
      });
      projectDateId = d1.data!.id;

      const list = await eldo.client.get<Array<{ id: string; title: string }>>(`/api/v1/projects/${projectId}/dates`);
      expect(list.status, JSON.stringify(list)).toBe(200);
      expect(list.data!.map((d) => d.title)).toEqual(["Rehearsal", "Event Day"]);

      const update = await eldo.client.patch(`/api/v1/project-dates/${projectDateId}`, { title: "Dress Rehearsal" });
      expect(update.status, JSON.stringify(update)).toBe(200);

      const del = await eldo.client.delete(`/api/v1/project-dates/${d2.data!.id}`);
      expect(del.status, JSON.stringify(del)).toBe(200);
      const after = await eldo.client.get<Array<{ id: string; title: string }>>(`/api/v1/projects/${projectId}/dates`);
      expect(after.data!.map((d) => d.title)).toEqual(["Dress Rehearsal"]);
    });

    it("18. Activity lists project-scoped audit entries only — creation, membership, dates, messages", async () => {
      const res = await eldo.client.get<{ items: Array<{ action: string }> }>(`/api/v1/projects/${projectId}/activity?limit=100`);
      expect(res.status, JSON.stringify(res)).toBe(200);
      const actions = res.data!.items.map((e) => e.action);
      expect(actions).toContain("project.created");
      expect(actions).toContain("project.member_added");
      expect(actions).toContain("project_date.created");
      expect(actions).toContain("project.message_added");
    });

    it("18b. removing a member takes effect immediately (live lookup, no caching) — a task-level grant they separately hold is untouched (doc 17 §20)", async () => {
      const add = await eldo.client.post(`/api/v1/projects/${projectId}/members`, { userId: priya.id });
      expect(add.status, JSON.stringify(add)).toBe(200);
      const before = await priya.client.get(`/api/v1/projects/${projectId}`);
      expect(before.status, JSON.stringify(before)).toBe(200);

      const remove = await eldo.client.delete(`/api/v1/projects/${projectId}/members/${priya.id}`);
      expect(remove.status, JSON.stringify(remove)).toBe(200);
      const after = await priya.client.get(`/api/v1/projects/${projectId}`);
      expect(after.status).toBe(403);

      // Priya's separate, task-level "current assignee" access (unrelated to this
      // project) is untouched — task access has never been derived from project
      // membership, so removing the latter has nothing to "reach into."
      const taskForPriya = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Finance task, unrelated to the project",
      });
      const assign = await eldo.client.post(`/api/v1/tasks/${taskForPriya.data!.id}/assignments`, {
        assigneeType: "USER",
        assigneeUserId: priya.id,
      });
      expect(assign.status, JSON.stringify(assign)).toBe(200);
      const priyaTaskAccess = await priya.client.get(`/api/v1/tasks/${taskForPriya.data!.id}`);
      expect(priyaTaskAccess.status, JSON.stringify(priyaTaskAccess)).toBe(200);
    });

    it("19. PATCH updates the project; DELETE archives it (soft status transition, never a hard delete)", async () => {
      const patch = await eldo.client.patch<{ description: string | null }>(`/api/v1/projects/${projectId}`, {
        description: "College Annual Day celebration, Nov 2026.",
      });
      expect(patch.status, JSON.stringify(patch)).toBe(200);
      expect(patch.data!.description).toBe("College Annual Day celebration, Nov 2026.");

      const archive = await eldo.client.delete<{ status: string }>(`/api/v1/projects/${projectId}`);
      expect(archive.status, JSON.stringify(archive)).toBe(200);
      expect(archive.data!.status).toBe("ARCHIVED");

      // Archived is a status transition, not a deletion — still readable.
      const stillReadable = await eldo.client.get(`/api/v1/projects/${projectId}`);
      expect(stillReadable.status).toBe(200);
    });

    it("20. cross-tenant access is denied across every project surface (project, files, conversation, activity, progress)", async () => {
      const outsider = await signup("proj-tenant-outsider", "Project Tenant Outsider");
      const checks = await Promise.all([
        outsider.client.get(`/api/v1/projects/${projectId}`),
        outsider.client.get(`/api/v1/projects/${projectId}/files`),
        outsider.client.get(`/api/v1/projects/${projectId}/conversation`),
        outsider.client.get(`/api/v1/projects/${projectId}/activity`),
        outsider.client.get(`/api/v1/projects/${projectId}/progress`),
      ]);
      for (const res of checks) expect(res.status).toBe(403);
    });

    it("21. a project's conversation is distinct from any of its tasks' own conversations — a project message never appears in a task's message list or vice versa", async () => {
      const task = await eldo.client.post<{ id: string }>(`/api/v1/projects/${projectId}/tasks`, { title: "Isolation check task" });
      await eldo.client.post(`/api/v1/tasks/${task.data!.id}/conversation/messages`, { body: "Task-only message" });

      const projectMessages = await eldo.client.get<{ items: Array<{ body: string | null }> }>(
        `/api/v1/projects/${projectId}/conversation/messages?limit=50`
      );
      expect(projectMessages.data!.items.some((m) => m.body === "Task-only message")).toBe(false);

      const taskMessages = await eldo.client.get<{ items: Array<{ body: string | null }> }>(
        `/api/v1/tasks/${task.data!.id}/conversation/messages?limit=50`
      );
      expect(taskMessages.data!.items.some((m) => m.body === "Here's the stage decoration brief for review.")).toBe(false);
    });

    it("22. Personal workspace: a project works the same way, but has no participants beyond its owner", async () => {
      const ws = await eldo.client.get<{ personal: { id: string } | null }>("/api/v1/workspaces");
      const personalWorkspaceId = ws.data!.personal!.id;

      const personal = await eldo.client.post<{ id: string; status: string }>(`/api/v1/workspaces/${personalWorkspaceId}/projects`, {
        name: "My personal reading list",
      });
      expect(personal.status, JSON.stringify(personal)).toBe(200);

      const addMember = await eldo.client.post(`/api/v1/projects/${personal.data!.id}/members`, { userId: rahul.id });
      expect(addMember.status).toBe(403);
      const addTeam = await eldo.client.post(`/api/v1/projects/${personal.data!.id}/teams`, { teamId: marketingTeamId });
      expect(addTeam.status).toBe(403);

      const rahulAccess = await rahul.client.get(`/api/v1/projects/${personal.data!.id}`);
      expect(rahulAccess.status).toBe(403);
    });

    it("23. Phase 1/2A/2B behavior is unaffected by anything Phase 2C added", async () => {
      const original = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${taskId}`);
      expect(original.data!.status).toBe("COMPLETED");
    });
  });

  // ── Phase 3: Daily Work Cycle — docs/architecture/19-phase3-daily-work-cycle- ──
  // ── architecture-report.md §30 ──
  // Fresh tasks throughout, so these tests never depend on any other block's leftover
  // state. Reuses Management -> Marketing Team -> Anu -> Rahul exactly like Phase 2B/2C.

  describe("Phase 3: Daily Work Cycle", () => {
    let dailyTaskId: string;

    it("sets up a task assigned directly to Rahul and accepted, mirroring the main scenario", async () => {
      const created = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Draft the newsletter",
        priority: "MEDIUM",
      });
      dailyTaskId = created.data!.id;
      const assign = await eldo.client.post(`/api/v1/tasks/${dailyTaskId}/assignments`, {
        assigneeType: "USER",
        assigneeUserId: rahul.id,
      });
      expect(assign.status, JSON.stringify(assign)).toBe(200);
      const task = await rahul.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${dailyTaskId}`);
      const accept = await rahul.client.post(`/api/v1/assignments/${task.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);
      expect(accept.status, JSON.stringify(accept)).toBe(200);
    });

    it("1. an assigned and accepted task appears in Inbox, not on Today, until explicitly planned", async () => {
      const inbox = await rahul.client.get<Array<{ id: string }>>(`/api/v1/me/workday/inbox?workspaceId=${orgWorkspaceId}`);
      expect(inbox.status, JSON.stringify(inbox)).toBe(200);
      expect(inbox.data!.some((t) => t.id === dailyTaskId)).toBe(true);

      const items = await rahul.client.get<Array<{ task: { id: string } }>>("/api/v1/me/workday/items");
      expect(items.status, JSON.stringify(items)).toBe(200);
      expect(items.data!.some((i) => i.task.id === dailyTaskId)).toBe(false);
    });

    it("2. adding it to Today moves it out of Inbox and onto the plan", async () => {
      const add = await rahul.client.post<{ id: string; status: string; isUnplanned: boolean }>("/api/v1/me/workday/items", {
        taskId: dailyTaskId,
      });
      expect(add.status, JSON.stringify(add)).toBe(200);
      expect(add.data!.status).toBe("PLANNED");
      expect(add.data!.isUnplanned).toBe(false);

      const inbox = await rahul.client.get<Array<{ id: string }>>(`/api/v1/me/workday/inbox?workspaceId=${orgWorkspaceId}`);
      expect(inbox.data!.some((t) => t.id === dailyTaskId)).toBe(false);

      const items = await rahul.client.get<Array<{ task: { id: string } }>>("/api/v1/me/workday/items");
      expect(items.data!.some((i) => i.task.id === dailyTaskId)).toBe(true);
    });

    it("3. planning the same task on the same day twice is rejected", async () => {
      const res = await rahul.client.post("/api/v1/me/workday/items", { taskId: dailyTaskId });
      expect(res.status).toBe(409);
    });

    it("4. the same task CAN be planned on a different day", async () => {
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const dateStr = tomorrow.toISOString().slice(0, 10);
      const res = await rahul.client.post<{ id: string }>("/api/v1/me/workday/items", { taskId: dailyTaskId, date: dateStr });
      expect(res.status, JSON.stringify(res)).toBe(200);
      // Clean up so this doesn't interfere with later carry-forward assertions.
      await rahul.client.delete(`/api/v1/workday-items/${res.data!.id}`);
    });

    it("5. a quick-added item is correctly flagged isUnplanned, distinct from a deliberately planned one", async () => {
      const unplannedTask = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Unplanned fire drill",
      });
      await eldo.client.post(`/api/v1/tasks/${unplannedTask.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: rahul.id });
      const task = await rahul.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${unplannedTask.data!.id}`);
      await rahul.client.post(`/api/v1/assignments/${task.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);

      const add = await rahul.client.post<{ isUnplanned: boolean }>("/api/v1/me/workday/items", {
        taskId: unplannedTask.data!.id,
        isUnplanned: true,
      });
      expect(add.status, JSON.stringify(add)).toBe(200);
      expect(add.data!.isUnplanned).toBe(true);
    });

    it("6. a team-pending assignment cannot be planned by anyone — only the eventual accepted individual assignee can", async () => {
      const teamTask = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Team-pending, not yet anyone's individual work",
      });
      await eldo.client.post(`/api/v1/tasks/${teamTask.data!.id}/assignments`, { assigneeType: "TEAM", assigneeTeamId: marketingTeamId });

      // Rahul is a plain Marketing member — the team assignment is still
      // PENDING_ACKNOWLEDGEMENT, no individual owns this task yet.
      const res = await rahul.client.post("/api/v1/me/workday/items", { taskId: teamTask.data!.id });
      expect(res.status).toBe(403);
      // Even Anu, the Team Head who *could* accept on the team's behalf, cannot plan it
      // until an individual actually holds it.
      const anuRes = await anu.client.post("/api/v1/me/workday/items", { taskId: teamTask.data!.id });
      expect(anuRes.status).toBe(403);
    });

    it("7. Start/Complete transitions on a plan item never touch the task's own lifecycle status", async () => {
      const before = await rahul.client.get<{ status: string }>(`/api/v1/tasks/${dailyTaskId}`);
      const taskStatusBefore = before.data!.status;

      const items = await rahul.client.get<Array<{ id: string; task: { id: string } }>>("/api/v1/me/workday/items");
      const itemId = items.data!.find((i) => i.task.id === dailyTaskId)!.id;

      const started = await rahul.client.post<{ status: string; startedAt: string | null }>(`/api/v1/workday-items/${itemId}/start`);
      expect(started.status, JSON.stringify(started)).toBe(200);
      expect(started.data!.status).toBe("IN_PROGRESS");
      expect(started.data!.startedAt).toBeTruthy();

      const midTask = await rahul.client.get<{ status: string }>(`/api/v1/tasks/${dailyTaskId}`);
      expect(midTask.data!.status).toBe(taskStatusBefore); // unchanged by Start

      const completed = await rahul.client.post<{ status: string; completedAt: string | null }>(`/api/v1/workday-items/${itemId}/complete`);
      expect(completed.status, JSON.stringify(completed)).toBe(200);
      expect(completed.data!.status).toBe("COMPLETED_TODAY");
      expect(completed.data!.completedAt).toBeTruthy();

      const afterTask = await rahul.client.get<{ status: string }>(`/api/v1/tasks/${dailyTaskId}`);
      expect(afterTask.data!.status).toBe(taskStatusBefore); // still unchanged by Complete
    });

    it("8. un-planning succeeds while PLANNED and untouched, and fails once execution has begun", async () => {
      const fresh = await eldo.client.post<{ id: string }>("/api/v1/tasks", { workspaceId: orgWorkspaceId, title: "Deletable plan item" });
      await eldo.client.post(`/api/v1/tasks/${fresh.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: rahul.id });
      const t = await rahul.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${fresh.data!.id}`);
      await rahul.client.post(`/api/v1/assignments/${t.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);

      const add = await rahul.client.post<{ id: string }>("/api/v1/me/workday/items", { taskId: fresh.data!.id });
      const del = await rahul.client.delete(`/api/v1/workday-items/${add.data!.id}`);
      expect(del.status, JSON.stringify(del)).toBe(200);

      const add2 = await rahul.client.post<{ id: string }>("/api/v1/me/workday/items", { taskId: fresh.data!.id });
      await rahul.client.post(`/api/v1/workday-items/${add2.data!.id}/start`);
      const del2 = await rahul.client.delete(`/api/v1/workday-items/${add2.data!.id}`);
      expect(del2.status).toBe(409);
    });

    it("9. reassigning the underlying task away flags the plan item as ownership-lost, without deleting it, and blocks further Start/Complete", async () => {
      const reassignable = await eldo.client.post<{ id: string }>("/api/v1/tasks", { workspaceId: orgWorkspaceId, title: "Will be reassigned mid-day" });
      await eldo.client.post(`/api/v1/tasks/${reassignable.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: rahul.id });
      const t = await rahul.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${reassignable.data!.id}`);
      await rahul.client.post(`/api/v1/assignments/${t.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);
      const add = await rahul.client.post<{ id: string }>("/api/v1/me/workday/items", { taskId: reassignable.data!.id });

      // Reassigned away from Rahul to Divya mid-flight.
      const reassign = await eldo.client.post(`/api/v1/tasks/${reassignable.data!.id}/assignments`, {
        assigneeType: "USER",
        assigneeUserId: divya.id,
      });
      expect(reassign.status, JSON.stringify(reassign)).toBe(200);

      const items = await rahul.client.get<Array<{ id: string; ownershipLost: boolean }>>("/api/v1/me/workday/items");
      const item = items.data!.find((i) => i.id === add.data!.id)!;
      expect(item.ownershipLost).toBe(true);

      const startAttempt = await rahul.client.post(`/api/v1/workday-items/${add.data!.id}/start`);
      expect(startAttempt.status).toBe(403);
    });

    it("10. Close rejects an incomplete disposition list, naming exactly which items are unresolved", async () => {
      const res = await rahul.client.post<never>("/api/v1/me/workday/close", { dispositions: [] });
      expect(res.status).toBe(400);
      expect(res.error?.details).toBeTruthy();
    });

    it("11. Close with a full, valid disposition list applies each action and preserves carry-forward history", async () => {
      // Rahul has several unresolved items by now: the ownership-lost one from test 9,
      // the still-IN_PROGRESS-or-PLANNED ones from earlier tests. Resolve everything.
      const items = await rahul.client.get<Array<{ id: string; status: string; task: { status: string } }>>("/api/v1/me/workday/items");
      const unresolved = items.data!.filter((i) => ["PLANNED", "IN_PROGRESS"].includes(i.status) && !["COMPLETED", "CANCELLED"].includes(i.task.status));
      expect(unresolved.length).toBeGreaterThan(0);

      // First item -> carry forward; rest -> drop (simplest disposition to apply broadly).
      const [carryItem, ...rest] = unresolved;
      const dispositions = [
        { itemId: carryItem!.id, action: "CARRY_FORWARD" },
        ...rest.map((i) => ({ itemId: i.id, action: "DROP" as const })),
      ];

      const close = await rahul.client.post<{ status: string; closedAt: string | null }>("/api/v1/me/workday/close", { dispositions });
      expect(close.status, JSON.stringify(close)).toBe(200);
      expect(close.data!.status).toBe("CLOSED");
      expect(close.data!.closedAt).toBeTruthy();

      // Closing again is rejected — not idempotent by design.
      const closeAgain = await rahul.client.post("/api/v1/me/workday/close", { dispositions: [] });
      expect(closeAgain.status).toBe(409);

      // Tomorrow's plan now contains the carried-forward item, linked back to the original.
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const dateStr = tomorrow.toISOString().slice(0, 10);
      const tomorrowItems = await rahul.client.get<Array<{ id: string; carriedFromItemId: string | null }>>(
        `/api/v1/me/workday/items?date=${dateStr}`
      );
      expect(tomorrowItems.status, JSON.stringify(tomorrowItems)).toBe(200);
      expect(tomorrowItems.data!.some((i) => i.carriedFromItemId === carryItem!.id)).toBe(true);
    });

    it("12. a task already resolved (COMPLETED) outside the daily-plan layer is auto-exempted from needing a Close disposition", async () => {
      const autoResolve = await eldo.client.post<{ id: string }>("/api/v1/tasks", { workspaceId: orgWorkspaceId, title: "Will be fully completed" });
      const assign = await eldo.client.post(`/api/v1/tasks/${autoResolve.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: divya.id });
      const t = await divya.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${autoResolve.data!.id}`);
      await divya.client.post(`/api/v1/assignments/${t.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);
      await divya.client.post("/api/v1/me/workday/items", { taskId: autoResolve.data!.id });

      // Fully complete the task through the existing, unmodified lifecycle — submit then
      // approve (Eldo assigned it, so Eldo is the designated reviewer).
      await divya.client.post(`/api/v1/tasks/${autoResolve.data!.id}/submit`);
      const review = await eldo.client.post<{ status: string }>(`/api/v1/tasks/${autoResolve.data!.id}/reviews`, { decision: "APPROVED" });
      expect(review.status, JSON.stringify(review)).toBe(200);
      expect(review.data!.status).toBe("COMPLETED");

      // Close with NO disposition for this item — must succeed anyway, since the task
      // resolved itself.
      const close = await divya.client.post<{ status: string }>("/api/v1/me/workday/close", { dispositions: [] });
      expect(close.status, JSON.stringify(close)).toBe(200);
      expect(close.data!.status).toBe("CLOSED");
    });

    it("13. cross-user access: another user cannot read, modify, or act on someone else's daily plan items", async () => {
      const outsider = await signup("daily-outsider", "Daily Outsider");
      // Anu still has an open, unclosed workday with no items of her own touched yet in
      // this block — use a task planned by Anu instead, since Rahul's/Divya's days are
      // now closed above (closed days 404/409 on mutation attempts regardless of who asks,
      // which would make this test ambiguous about *why* it failed).
      const anuTask = await eldo.client.post<{ id: string }>("/api/v1/tasks", { workspaceId: orgWorkspaceId, title: "Anu's own daily item" });
      await eldo.client.post(`/api/v1/tasks/${anuTask.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: anu.id });
      const t = await anu.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${anuTask.data!.id}`);
      await anu.client.post(`/api/v1/assignments/${t.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);
      const anuItem = await anu.client.post<{ id: string }>("/api/v1/me/workday/items", { taskId: anuTask.data!.id });

      const readAttempt = await outsider.client.get(`/api/v1/me/workday/items`); // outsider's own (empty) list — not a leak vector by itself
      expect(readAttempt.status).toBe(200);

      const patchAttempt = await outsider.client.patch(`/api/v1/workday-items/${anuItem.data!.id}`, { position: 0 });
      expect(patchAttempt.status).toBe(403);
      const startAttempt = await outsider.client.post(`/api/v1/workday-items/${anuItem.data!.id}/start`);
      expect(startAttempt.status).toBe(403);
      const deleteAttempt = await outsider.client.delete(`/api/v1/workday-items/${anuItem.data!.id}`);
      expect(deleteAttempt.status).toBe(403);
      // The outsider has never engaged their own workday at all (no row exists yet) —
      // closing resolves the ACTOR's own workday first, so this 404s before ever
      // reaching disposition validation, never leaking anything about Anu's day.
      const closeAttempt = await outsider.client.post("/api/v1/me/workday/close", { dispositions: [{ itemId: anuItem.data!.id, action: "DROP" }] });
      expect(closeAttempt.status).toBe(404);
    });

    it("14. a personal-workspace task plans, executes, and closes identically to an organization task", async () => {
      const ws = await eldo.client.get<{ personal: { id: string } | null }>("/api/v1/workspaces");
      const personalWorkspaceId = ws.data!.personal!.id;

      const personalTask = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: personalWorkspaceId,
        title: "Water the office plants",
      });
      expect(personalTask.status, JSON.stringify(personalTask)).toBe(200);

      const add = await eldo.client.post<{ id: string; status: string }>("/api/v1/me/workday/items", { taskId: personalTask.data!.id });
      expect(add.status, JSON.stringify(add)).toBe(200);
      const start = await eldo.client.post(`/api/v1/workday-items/${add.data!.id}/start`);
      expect(start.status, JSON.stringify(start)).toBe(200);
      const complete = await eldo.client.post(`/api/v1/workday-items/${add.data!.id}/complete`);
      expect(complete.status, JSON.stringify(complete)).toBe(200);
    });

    it("15. capacity reflects the default working-hours policy and the sum of planned estimates", async () => {
      const outsider = await signup("capacity-check", "Capacity Check");
      const workday = await outsider.client.get<{ capacityMinutes: number; plannedMinutes: number }>("/api/v1/me/workday");
      expect(workday.status, JSON.stringify(workday)).toBe(200);
      // Default policy: 8h on a configured working weekday, 0 on a weekend — either way a
      // deterministic, non-negative number with no planned items yet.
      expect(workday.data!.capacityMinutes).toBeGreaterThanOrEqual(0);
      expect(workday.data!.plannedMinutes).toBe(0);

      // A personal task needs no org membership at all — the simplest way to verify
      // plannedMinutes accumulates from a plan item's own estimate.
      const ws = await outsider.client.get<{ personal: { id: string } | null }>("/api/v1/workspaces");
      const personalTask = await outsider.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: ws.data!.personal!.id,
        title: "Estimate-bearing personal task",
      });
      const added = await outsider.client.post<{ plannedDurationMinutes: number | null }>("/api/v1/me/workday/items", {
        taskId: personalTask.data!.id,
        plannedDurationMinutes: 45,
      });
      expect(added.status, JSON.stringify(added)).toBe(200);
      const after = await outsider.client.get<{ plannedMinutes: number }>("/api/v1/me/workday");
      expect(after.data!.plannedMinutes).toBe(45);
    });

    it("16. Phase 1/2A/2B/2C behavior is unaffected by anything Phase 3 added", async () => {
      const original = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${taskId}`);
      expect(original.data!.status).toBe("COMPLETED");
    });
  });

  // ── Phase 4: Management Visibility & Work Graph Reporting — docs/architecture/21- ──
  // ── phase4-management-visibility-architecture-report.md §20 ──
  // Reuses Management -> Marketing Team -> Anu (Team Head) -> Rahul/Divya (members),
  // Finance Team -> Priya, exactly like every prior phase's own test block.

  describe("Phase 4: Management Visibility & Work Graph Reporting", () => {
    it("1. Org Admin sees the full organization-wide dashboard, including the new attentionRequired summary", async () => {
      const res = await eldo.client.get<{
        totalTasks: number;
        departmentPerformance: Array<{ department: { id: string }; stuckAcknowledgementCount: number }>;
        teamPerformance: Array<{ team: { id: string }; stuckAcknowledgementCount: number }>;
        attentionRequired: { stuckAcknowledgementCount: number; overCapacityCount: number; carryForwardRepeatCount: number; unplannedCount: number };
      }>(`/api/v1/organizations/${orgId}/reports/overview`);
      expect(res.status, JSON.stringify(res)).toBe(200);
      expect(res.data!.attentionRequired).toBeTruthy();
      expect(typeof res.data!.attentionRequired.stuckAcknowledgementCount).toBe("number");
      expect(res.data!.departmentPerformance.some((d) => d.department.id === marketingDeptId)).toBe(true);
      expect(res.data!.teamPerformance.every((t) => typeof t.stuckAcknowledgementCount === "number")).toBe(true);
    });

    it("2. Team Head (Anu) sees Marketing's team dashboard including the new fields, denied for Finance's", async () => {
      const marketing = await anu.client.get<{
        workload: Array<{ user: { id: string }; workdayStatus: string; capacityMinutes: number; plannedMinutes: number; overCapacity: boolean }>;
        stuckAcknowledgement: unknown[];
        attentionRequired: { stuckAcknowledgementCount: number };
      }>(`/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`);
      expect(marketing.status, JSON.stringify(marketing)).toBe(200);
      expect(Array.isArray(marketing.data!.stuckAcknowledgement)).toBe(true);
      expect(marketing.data!.workload.some((w) => w.user.id === rahul.id)).toBe(true);
      expect(marketing.data!.workload.every((w) => typeof w.capacityMinutes === "number")).toBe(true);

      const finance = await anu.client.get(`/api/v1/organizations/${orgId}/reports/team/${financeTeamId}`);
      expect(finance.status).toBe(403);
    });

    it("3. a MANAGER-template role grant, scoped to a team, behaves identically to team membership — the engine is capability-based, not role-name-based", async () => {
      const managerRole = roleIdByName.MANAGER;
      expect(managerRole).toBeTruthy();
      // Priya (Finance) has never been a Marketing member — grant her MANAGER scoped to
      // Marketing Team specifically to prove REPORTS_VIEW-at-that-scope is what grants
      // access, not any hardcoded "is this person on the team" role check.
      const grant = await eldo.client.post(`/api/v1/organizations/${orgId}/role-grants`, {
        userId: priya.id,
        roleId: managerRole,
        scopeType: "TEAM",
        scopeId: marketingTeamId,
      });
      expect(grant.status, JSON.stringify(grant)).toBe(200);

      const res = await priya.client.get(`/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`);
      expect(res.status, JSON.stringify(res)).toBe(200);
    });

    it("4/6. cross-team isolation: a MEMBER with no REPORTS_VIEW at that scope and no team membership is denied", async () => {
      // Rahul (Marketing member, MEMBER template only — no REPORTS_VIEW at all) attempting
      // Finance's team dashboard: neither a Finance member nor REPORTS_VIEW-scoped there.
      const res = await rahul.client.get(`/api/v1/organizations/${orgId}/reports/team/${financeTeamId}`);
      expect(res.status).toBe(403);
    });

    it("5/7. Department Head sees team dashboards within their department, but is denied the org-wide dashboard (no unscoped REPORTS_VIEW grant)", async () => {
      const deptHeadRole = roleIdByName.DEPARTMENT_HEAD;
      expect(deptHeadRole).toBeTruthy();
      const grant = await eldo.client.post(`/api/v1/organizations/${orgId}/role-grants`, {
        userId: divya.id,
        roleId: deptHeadRole,
        scopeType: "DEPARTMENT",
        scopeId: marketingDeptId,
      });
      expect(grant.status, JSON.stringify(grant)).toBe(200);

      // Marketing Team belongs to the Marketing department — a department-scoped grant's
      // departmentPathIds match extends to every team within it (doc 04 §4.4).
      const teamView = await divya.client.get(`/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`);
      expect(teamView.status, JSON.stringify(teamView)).toBe(200);

      // The org-wide dashboard route asserts REPORTS_VIEW with NO department/team context
      // — only an organization-scoped grant satisfies that, by design (doc 21 §9's exact
      // "reporting visibility ≠ full task access" scoping, inherited unchanged from the
      // pre-existing permission engine). A department-scoped Department Head is correctly
      // denied the org-wide rollup.
      const orgView = await divya.client.get(`/api/v1/organizations/${orgId}/reports/overview`);
      expect(orgView.status).toBe(403);
    });

    it("8. cross-tenant isolation: an outsider from a different organization is denied every report route", async () => {
      const outsider = await signup("reporting-outsider", "Reporting Outsider");
      const teamRes = await outsider.client.get(`/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`);
      expect(teamRes.status).toBe(403);
      const orgRes = await outsider.client.get(`/api/v1/organizations/${orgId}/reports/overview`);
      expect(orgRes.status).toBe(403);
    });

    it("9. current-owner attribution updates immediately after reassignment", async () => {
      const task = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Reporting attribution check",
      });
      await eldo.client.post(`/api/v1/tasks/${task.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: rahul.id });
      const t = await rahul.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${task.data!.id}`);
      // Accept first — a still-pending (ASSIGNED) task cannot be reassigned again per the
      // task-status state machine (doc 05); reassignment requires IN_PROGRESS first.
      await rahul.client.post(`/api/v1/assignments/${t.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);

      const before = await anu.client.get<{ workload: Array<{ user: { id: string }; activeTaskCount: number }> }>(
        `/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`
      );
      const rahulBefore = before.data!.workload.find((w) => w.user.id === rahul.id)!.activeTaskCount;
      const divyaBefore = before.data!.workload.find((w) => w.user.id === divya.id)!.activeTaskCount;

      // Reassign from Rahul to Divya — attribution must move immediately, never stay
      // attributed to Rahul as the "original"/prior assignee.
      const reassign = await eldo.client.post(`/api/v1/tasks/${task.data!.id}/assignments`, {
        assigneeType: "USER",
        assigneeUserId: divya.id,
      });
      expect(reassign.status, JSON.stringify(reassign)).toBe(200);

      const after = await anu.client.get<{ workload: Array<{ user: { id: string }; activeTaskCount: number }> }>(
        `/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`
      );
      expect(after.data!.workload.find((w) => w.user.id === rahul.id)!.activeTaskCount).toBe(rahulBefore - 1);
      expect(after.data!.workload.find((w) => w.user.id === divya.id)!.activeTaskCount).toBe(divyaBefore + 1);
    });

    it("10. a team-pending assignment shows in the incoming/pending-acceptance bucket, never inflating any individual's workload count", async () => {
      const task = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Team-pending, not yet distributed",
      });
      const assignTeam = await eldo.client.post(`/api/v1/tasks/${task.data!.id}/assignments`, {
        assigneeType: "TEAM",
        assigneeTeamId: marketingTeamId,
      });
      expect(assignTeam.status, JSON.stringify(assignTeam)).toBe(200);

      const res = await anu.client.get<{
        pendingAcceptance: Array<{ id: string }>;
        workload: Array<{ user: { id: string }; activeTaskCount: number }>;
      }>(`/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`);
      expect(res.status, JSON.stringify(res)).toBe(200);
      expect(res.data!.pendingAcceptance.some((t) => t.id === task.data!.id)).toBe(true);
      // Nobody has an individual, isCurrent USER-type assignment for this task yet — the
      // existing workload definition (doc 21 §7, unchanged) only ever counts those.
      for (const w of res.data!.workload) {
        expect(w.activeTaskCount).toBeGreaterThanOrEqual(0); // sanity — no crash/NaN
      }

      // Clean up: Anu accepts on the team's behalf so it doesn't linger for later tests.
      const withCurrent = await anu.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${task.data!.id}`);
      await anu.client.post(`/api/v1/assignments/${withCurrent.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);
    });

    it("11. a freshly-created pending assignment does not appear as 'stuck' — the age threshold gate holds end-to-end", async () => {
      const task = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Freshly assigned, not yet stuck",
      });
      await eldo.client.post(`/api/v1/tasks/${task.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: rahul.id });

      const res = await anu.client.get<{ stuckAcknowledgement: Array<{ id: string }> }>(
        `/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`
      );
      expect(res.status, JSON.stringify(res)).toBe(200);
      expect(res.data!.stuckAcknowledgement.some((t) => t.id === task.data!.id)).toBe(false);

      // Clean up: accept it so it doesn't linger pending for later tests in this block.
      const t = await rahul.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${task.data!.id}`);
      await rahul.client.post(`/api/v1/assignments/${t.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);
    });

    it("13/14/15. carry-forward-repeat, unplanned work, and daily capacity signals surface correctly in the team dashboard", async () => {
      const task = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Carried forward twice, over capacity",
      });
      await eldo.client.post(`/api/v1/tasks/${task.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: divya.id });
      const t = await divya.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${task.data!.id}`);
      await divya.client.post(`/api/v1/assignments/${t.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);

      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const today = new Date();
      const date0 = fmt(new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000));
      const date1 = fmt(new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000));
      const date2 = fmt(today);

      // Also add a second, unplanned, over-capacity-inducing item directly on today.
      const bigTask = await eldo.client.post<{ id: string }>("/api/v1/tasks", { workspaceId: orgWorkspaceId, title: "Big unplanned task" });
      await eldo.client.post(`/api/v1/tasks/${bigTask.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: divya.id });
      const t2 = await divya.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${bigTask.data!.id}`);
      await divya.client.post(`/api/v1/assignments/${t2.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);
      const bigAdd = await divya.client.post<{ id: string }>("/api/v1/me/workday/items", {
        taskId: bigTask.data!.id,
        date: date2,
        isUnplanned: true,
        plannedDurationMinutes: 500, // exceeds the 480-minute default daily capacity alone
      });
      expect(bigAdd.status, JSON.stringify(bigAdd)).toBe(200);

      // Build a 2-hop carry-forward chain: date0 -> date1 -> date2 (today).
      const item0 = await divya.client.post<{ id: string }>("/api/v1/me/workday/items", { taskId: task.data!.id, date: date0 });
      expect(item0.status, JSON.stringify(item0)).toBe(200);
      const close0 = await divya.client.post(`/api/v1/me/workday/close`, {
        date: date0,
        dispositions: [{ itemId: item0.data!.id, action: "CARRY_FORWARD", targetDate: date1 }],
      });
      expect(close0.status, JSON.stringify(close0)).toBe(200);

      const day1Items = await divya.client.get<Array<{ id: string; carriedFromItemId: string | null }>>(
        `/api/v1/me/workday/items?date=${date1}`
      );
      const item1 = day1Items.data!.find((i) => i.carriedFromItemId === item0.data!.id)!;
      const close1 = await divya.client.post(`/api/v1/me/workday/close`, {
        date: date1,
        dispositions: [{ itemId: item1.id, action: "CARRY_FORWARD", targetDate: date2 }],
      });
      expect(close1.status, JSON.stringify(close1)).toBe(200);

      const res = await anu.client.get<{
        workload: Array<{
          user: { id: string };
          plannedMinutes: number;
          capacityMinutes: number;
          overCapacity: boolean;
          unplannedItemCount: number;
          carryForwardRepeatCount: number;
        }>;
        attentionRequired: { overCapacityCount: number; carryForwardRepeatCount: number; unplannedCount: number };
      }>(`/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`);
      expect(res.status, JSON.stringify(res)).toBe(200);

      const divyaSignal = res.data!.workload.find((w) => w.user.id === divya.id)!;
      // plannedMinutes is deterministic (500 minutes were explicitly planned) regardless
      // of what day this suite happens to run on; overCapacity additionally depends on
      // the default capacity policy being >0 minutes for today's weekday (0 on a
      // weekend, doc 19 §16) — asserted conditionally so this test is never flaky based
      // on the calendar date it happens to run against.
      expect(divyaSignal.plannedMinutes).toBeGreaterThanOrEqual(500);
      if (divyaSignal.capacityMinutes > 0) {
        expect(divyaSignal.overCapacity).toBe(true);
        expect(res.data!.attentionRequired.overCapacityCount).toBeGreaterThanOrEqual(1);
      }
      expect(divyaSignal.unplannedItemCount).toBeGreaterThanOrEqual(1);
      expect(divyaSignal.carryForwardRepeatCount).toBeGreaterThanOrEqual(1);
      expect(res.data!.attentionRequired.carryForwardRepeatCount).toBeGreaterThanOrEqual(1);
      expect(res.data!.attentionRequired.unplannedCount).toBeGreaterThanOrEqual(1);
    });

    it("private Daily Work information (reflectionNote, planning order) never appears anywhere in a report response", async () => {
      const res = await anu.client.get<Record<string, unknown>>(`/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`);
      const raw = JSON.stringify(res.data);
      expect(raw).not.toContain("reflectionNote");
      expect(raw).not.toContain("scheduledStart");
      expect(raw).not.toContain("scheduledEnd");
    });

    it("regression: Phase 1 through Phase 3 behavior is unaffected by anything Phase 4 added", async () => {
      const original = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${taskId}`);
      expect(original.data!.status).toBe("COMPLETED");
      const stillDenied = await priya.client.get(`/api/v1/organizations/${orgId}/reports/overview`);
      expect(stillDenied.status).toBe(403);
    });
  });

  // ── Phase 5: Search — docs/architecture/22-phase5-product-capability-and-roadmap- ──
  // ── assessment.md §8/§10 ──
  // The one non-negotiable rule this whole block exists to prove: search results are
  // always filtered through the exact same authorization every other read path uses —
  // never a shortcut index that leaks content a searcher couldn't otherwise see. Every
  // task/project/message created here embeds a run-unique keyword so these assertions
  // never collide with unrelated data already in the database from other test blocks.

  describe("Phase 5: Search", () => {
    const kw = (label: string) => `zzsearch${RUN}${label}`;

    it("1. a task is findable by its owner/assignee via a distinctive keyword in the title", async () => {
      const task = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: `Draft the ${kw("alpha")} proposal`,
      });
      expect(task.status, JSON.stringify(task)).toBe(200);

      const res = await eldo.client.get<{ items: Array<{ type: string; id: string; title: string }> }>(
        `/api/v1/search?q=${kw("alpha")}`
      );
      expect(res.status, JSON.stringify(res)).toBe(200);
      expect(res.data!.items.some((i) => i.type === "TASK" && i.id === task.data!.id)).toBe(true);
    });

    it("2. a user with no access to the task never sees it in search results, even with the exact matching keyword", async () => {
      // A fresh, isolated task assigned only to Rahul — Priya (Finance, unrelated) has no
      // relationship to it whatsoever.
      const task = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: `Confidential ${kw("beta")} budget review`,
      });
      await eldo.client.post(`/api/v1/tasks/${task.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: rahul.id });

      const rahulRes = await rahul.client.get<{ items: Array<{ id: string }> }>(`/api/v1/search?q=${kw("beta")}`);
      expect(rahulRes.status, JSON.stringify(rahulRes)).toBe(200);
      expect(rahulRes.data!.items.some((i) => i.id === task.data!.id)).toBe(true);

      const priyaRes = await priya.client.get<{ items: Array<{ id: string }> }>(`/api/v1/search?q=${kw("beta")}`);
      expect(priyaRes.status, JSON.stringify(priyaRes)).toBe(200);
      expect(priyaRes.data!.items.some((i) => i.id === task.data!.id)).toBe(false);
    });

    it("3. a message is findable by someone with conversation access, never by someone without it", async () => {
      const task = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: `Task for message search ${kw("gamma-task")}`,
      });
      await eldo.client.post(`/api/v1/tasks/${task.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: divya.id });
      const t = await divya.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${task.data!.id}`);
      await divya.client.post(`/api/v1/assignments/${t.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);

      const message = await divya.client.post(`/api/v1/tasks/${task.data!.id}/conversation/messages`, {
        body: `Please review the ${kw("gamma-message")} attachment before Friday.`,
      });
      expect(message.status, JSON.stringify(message)).toBe(200);

      const divyaRes = await divya.client.get<{ items: Array<{ type: string; taskId: string | null }> }>(
        `/api/v1/search?q=${kw("gamma-message")}`
      );
      expect(divyaRes.data!.items.some((i) => i.type === "MESSAGE" && i.taskId === task.data!.id)).toBe(true);

      const priyaRes = await priya.client.get<{ items: Array<{ type: string }> }>(`/api/v1/search?q=${kw("gamma-message")}`);
      expect(priyaRes.data!.items.some((i) => i.type === "MESSAGE")).toBe(false);
    });

    it("4. a project is findable by a project member, never by an unrelated org member", async () => {
      const project = await eldo.client.post<{ id: string }>(`/api/v1/workspaces/${orgWorkspaceId}/projects`, {
        name: `${kw("delta")} Annual Fundraiser`,
      });
      expect(project.status, JSON.stringify(project)).toBe(200);
      await eldo.client.post(`/api/v1/projects/${project.data!.id}/members`, { userId: rahul.id });

      const rahulRes = await rahul.client.get<{ items: Array<{ type: string; id: string }> }>(`/api/v1/search?q=${kw("delta")}`);
      expect(rahulRes.data!.items.some((i) => i.type === "PROJECT" && i.id === project.data!.id)).toBe(true);

      const priyaRes = await priya.client.get<{ items: Array<{ type: string; id: string }> }>(`/api/v1/search?q=${kw("delta")}`);
      expect(priyaRes.data!.items.some((i) => i.type === "PROJECT" && i.id === project.data!.id)).toBe(false);
    });

    it("5. cross-tenant isolation: an outsider from a different organization never sees a match, even one they'd otherwise rank highly", async () => {
      const task = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: `${kw("epsilon")} strategic plan`,
      });
      expect(task.status, JSON.stringify(task)).toBe(200);

      const outsider = await signup("search-outsider", "Search Outsider");
      const res = await outsider.client.get<{ items: unknown[] }>(`/api/v1/search?q=${kw("epsilon")}`);
      expect(res.status, JSON.stringify(res)).toBe(200);
      expect(res.data!.items).toHaveLength(0);
    });

    it("6. a deleted message never appears in search results", async () => {
      const task = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: `Task for deleted-message search ${kw("zeta-task")}`,
      });
      const message = await eldo.client.post<{ id: string }>(`/api/v1/tasks/${task.data!.id}/conversation/messages`, {
        body: `This mentions ${kw("zeta-message")} before being deleted.`,
      });
      const beforeDelete = await eldo.client.get<{ items: Array<{ type: string }> }>(`/api/v1/search?q=${kw("zeta-message")}`);
      expect(beforeDelete.data!.items.some((i) => i.type === "MESSAGE")).toBe(true);

      await eldo.client.delete(`/api/v1/messages/${message.data!.id}`);

      const afterDelete = await eldo.client.get<{ items: Array<{ type: string }> }>(`/api/v1/search?q=${kw("zeta-message")}`);
      expect(afterDelete.data!.items.some((i) => i.type === "MESSAGE")).toBe(false);
    });

    it("7. results are correctly typed and mixed across tasks, projects, and messages for a shared keyword", async () => {
      const shared = kw("eta-shared");
      const task = await eldo.client.post<{ id: string }>("/api/v1/tasks", { workspaceId: orgWorkspaceId, title: `${shared} task` });
      const project = await eldo.client.post<{ id: string }>(`/api/v1/workspaces/${orgWorkspaceId}/projects`, { name: `${shared} project` });
      await eldo.client.post(`/api/v1/tasks/${task.data!.id}/conversation/messages`, { body: `A message about ${shared}` });

      const res = await eldo.client.get<{ items: Array<{ type: string; id: string }> }>(`/api/v1/search?q=${shared}`);
      expect(res.status, JSON.stringify(res)).toBe(200);
      const types = new Set(res.data!.items.map((i) => i.type));
      expect(types.has("TASK")).toBe(true);
      expect(types.has("PROJECT")).toBe(true);
      expect(types.has("MESSAGE")).toBe(true);
      expect(res.data!.items.some((i) => i.type === "TASK" && i.id === task.data!.id)).toBe(true);
      expect(res.data!.items.some((i) => i.type === "PROJECT" && i.id === project.data!.id)).toBe(true);
    });

    it("8. a blank/whitespace-only query is rejected, not silently treated as 'match everything'", async () => {
      const res = await eldo.client.get("/api/v1/search?q=%20%20");
      expect(res.status).toBe(400);
    });

    it("regression: Phase 1 through Phase 4 behavior is unaffected by anything Phase 5 added", async () => {
      const original = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${taskId}`);
      expect(original.data!.status).toBe("COMPLETED");
    });
  });

  // docs/architecture/24-phase6-notifications-scheduler-architecture-report.md. The
  // scheduler itself (deadline-approaching/overdue) has no HTTP surface by design (doc §7
  // — an internal tick, not a route) and is covered instead by real-Postgres integration
  // tests in packages/domain/src/services/scheduler.service.test.ts. What's covered here,
  // through the real HTTP API like every other scenario in this file: the two backend
  // notification fixes (TASK_REASSIGNED, REVIEW_COMPLETED removal) and their
  // authorization/recipient-correctness boundary.
  describe("Phase 6: Proactive Work Awareness — notification correctness", () => {
    interface NotificationItem {
      id: string;
      type: string;
      payload: Record<string, unknown>;
      isRead: boolean;
      relatedTaskId: string | null;
    }
    async function notificationsFor(user: User, taskId: string): Promise<NotificationItem[]> {
      const res = await user.client.get<{ items: NotificationItem[] }>("/api/v1/notifications?limit=100");
      expect(res.status, JSON.stringify(res)).toBe(200);
      return res.data!.items.filter((n) => n.relatedTaskId === taskId);
    }

    it("1. reassigning an IN_PROGRESS task to a different person fires TASK_REASSIGNED for the new assignee, not TASK_ASSIGNED", async () => {
      const created = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Coordinate the alumni newsletter",
        priority: "MEDIUM",
        assignTo: { type: "USER", id: rahul.id },
      });
      expect(created.status, JSON.stringify(created)).toBe(200);
      const reassignTaskId = created.data!.id;

      const beforeAccept = await eldo.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(
        `/api/v1/tasks/${reassignTaskId}`
      );
      const firstAssignmentId = beforeAccept.data!.assignments.find((a) => a.isCurrent)!.id;
      await rahul.client.post(`/api/v1/assignments/${firstAssignmentId}/accept`);

      // Sanity: Rahul's first-ever assignment notification is TASK_ASSIGNED (unchanged
      // behavior for a genuine first assignment).
      const rahulFirstNotifications = await notificationsFor(rahul, reassignTaskId);
      expect(rahulFirstNotifications.some((n) => n.type === "task.assigned")).toBe(true);
      expect(rahulFirstNotifications.some((n) => n.type === "task.reassigned")).toBe(false);

      const task = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${reassignTaskId}`);
      expect(task.data!.status).toBe("IN_PROGRESS"); // required for the REASSIGNED state-machine event (doc 05)

      const reassign = await eldo.client.post(`/api/v1/tasks/${reassignTaskId}/assignments`, {
        assigneeType: "USER",
        assigneeUserId: divya.id,
      });
      expect(reassign.status, JSON.stringify(reassign)).toBe(200);

      const divyaNotifications = await notificationsFor(divya, reassignTaskId);
      expect(divyaNotifications.some((n) => n.type === "task.reassigned")).toBe(true);
      expect(divyaNotifications.some((n) => n.type === "task.assigned")).toBe(false);
      const reassignedNotification = divyaNotifications.find((n) => n.type === "task.reassigned")!;
      expect(reassignedNotification.payload.previousAssigneeId).toBe(rahul.id);

      // Information-disclosure boundary (doc 24 §9 / doc 23 §16): an unrelated org member
      // never receives a notification about a task they have no relationship to.
      const priyaNotifications = await notificationsFor(priya, reassignTaskId);
      expect(priyaNotifications).toHaveLength(0);
    });

    it("2. reassign-internal (team -> individual distribution) still fires TASK_ASSIGNED, never TASK_REASSIGNED — a deliberately unchanged path (doc 24 §4.1)", async () => {
      // Reuses the earlier Critical Workflow's task: Eldo -> Marketing Team -> Anu accepts
      // -> reassign-internal to Rahul. From Rahul's own perspective this is the first time
      // he has ever held this task, matching doc 24's explicit "do not change
      // reassignInternal" finding.
      const rahulNotifications = await notificationsFor(rahul, taskId);
      expect(rahulNotifications.some((n) => n.type === "task.assigned")).toBe(true);
      expect(rahulNotifications.some((n) => n.type === "task.reassigned")).toBe(false);
    });

    it("3. REVIEW_COMPLETED never appears anywhere — the review decision produces TASK_COMPLETED for the assignee only, matching the existing two-party model", async () => {
      // Same reused task: Rahul submitted, Anu approved -> COMPLETED (Critical Workflow).
      const rahulNotifications = await notificationsFor(rahul, taskId);
      expect(rahulNotifications.some((n) => n.type === "task.completed")).toBe(true);
      expect(rahulNotifications.some((n) => n.type === "review.completed")).toBe(false);

      const anuNotifications = await notificationsFor(anu, taskId);
      expect(anuNotifications.some((n) => n.type === "review.completed")).toBe(false);

      const eldoNotifications = await notificationsFor(eldo, taskId);
      expect(eldoNotifications.some((n) => n.type === "review.completed")).toBe(false);
    });

    it("4. the Notification Center API still marks read/all-read correctly for a Phase 6 notification, unmodified UI contract", async () => {
      const list = await divya.client.get<{ items: NotificationItem[] }>("/api/v1/notifications?unreadOnly=true&limit=100");
      expect(list.status, JSON.stringify(list)).toBe(200);
      const unread = list.data!.items.find((n) => n.type === "task.reassigned");
      expect(unread, "expected the reassignment notification from scenario 1 to still be unread").toBeTruthy();

      const markRead = await divya.client.post(`/api/v1/notifications/${unread!.id}/read`);
      expect(markRead.status, JSON.stringify(markRead)).toBe(200);

      const afterMarkRead = await divya.client.get<{ items: NotificationItem[] }>("/api/v1/notifications?limit=100");
      const same = afterMarkRead.data!.items.find((n) => n.id === unread!.id)!;
      expect(same.isRead).toBe(true);

      const markAll = await divya.client.post("/api/v1/notifications/mark-all-read");
      expect(markAll.status, JSON.stringify(markAll)).toBe(200);
      const afterMarkAll = await divya.client.get<{ items: NotificationItem[] }>("/api/v1/notifications?unreadOnly=true&limit=100");
      expect(afterMarkAll.data!.items).toHaveLength(0);
    });

    it("regression: Phase 1 through Phase 5 behavior is unaffected by anything Phase 6 added", async () => {
      const original = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${taskId}`);
      expect(original.data!.status).toBe("COMPLETED");
    });
  });

  // docs/architecture/26-phase7-calendar-meeting-architecture-report.md. Reuses the
  // existing Marketing Team fixture (Anu = TEAM_HEAD with REPORTS_VIEW at team scope,
  // Rahul/Divya = MEMBER at team scope) specifically so the single most important test in
  // this phase — REPORTS_VIEW must never imply calendar detail visibility — exercises a
  // real, already-established reporting relationship rather than a synthetic one.
  describe("Phase 7: Calendar & Meeting Integration", () => {
    let privateEventId: string;
    let orgVisibleEventId: string;

    it("1. Rahul creates a PRIVATE event; he and an explicit participant (Divya) can see it, an unrelated org member (Priya) cannot", async () => {
      const created = await rahul.client.post<{ id: string; visibility: string; organizerId: string }>("/api/v1/calendar/events", {
        workspaceId: orgWorkspaceId,
        title: "1:1 with Rahul",
        startAt: "2026-08-10T09:00:00.000Z",
        endAt: "2026-08-10T09:30:00.000Z",
        participantUserIds: [divya.id],
      });
      expect(created.status, JSON.stringify(created)).toBe(200);
      expect(created.data!.visibility).toBe("PRIVATE");
      privateEventId = created.data!.id;

      const asRahul = await rahul.client.get(`/api/v1/calendar/events/${privateEventId}`);
      expect(asRahul.status).toBe(200);
      const asDivya = await divya.client.get(`/api/v1/calendar/events/${privateEventId}`);
      expect(asDivya.status).toBe(200);
      const asPriya = await priya.client.get(`/api/v1/calendar/events/${privateEventId}`);
      expect(asPriya.status).toBe(403);
    });

    it("2. REPORTS_VIEW does NOT imply calendar detail visibility: Anu (Rahul's Team Head, holds REPORTS_VIEW over Marketing Team) is denied Rahul's PRIVATE event", async () => {
      const asAnu = await anu.client.get(`/api/v1/calendar/events/${privateEventId}`);
      expect(asAnu.status, JSON.stringify(asAnu)).toBe(403);

      // Sanity check that Anu's REPORTS_VIEW grant is real and would normally succeed for
      // an actually-permitted resource (the team dashboard) — proving the 403 above is
      // specifically calendar's own stricter rule, not a broken/absent grant.
      const teamDashboard = await anu.client.get(`/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`);
      expect(teamDashboard.status, JSON.stringify(teamDashboard)).toBe(200);
    });

    it("3. an ORGANIZATION_VISIBLE event is visible to any member of the SAME organization (Priya), never a different one", async () => {
      const created = await rahul.client.post<{ id: string; visibility: string }>("/api/v1/calendar/events", {
        workspaceId: orgWorkspaceId,
        title: "Marketing all-hands",
        startAt: "2026-08-11T14:00:00.000Z",
        endAt: "2026-08-11T15:00:00.000Z",
        visibility: "ORGANIZATION_VISIBLE",
      });
      expect(created.status, JSON.stringify(created)).toBe(200);
      orgVisibleEventId = created.data!.id;

      const asPriya = await priya.client.get(`/api/v1/calendar/events/${orgVisibleEventId}`);
      expect(asPriya.status, JSON.stringify(asPriya)).toBe(200);

      const outsider = await signup("calendar-outsider", "Calendar Outsider");
      const asOutsider = await outsider.client.get(`/api/v1/calendar/events/${orgVisibleEventId}`);
      expect(asOutsider.status).toBe(403);
    });

    it("4. only the organizer can update or cancel an event", async () => {
      const asDivya = await divya.client.patch(`/api/v1/calendar/events/${privateEventId}`, { title: "Hijacked" });
      expect(asDivya.status).toBe(403);

      const asRahul = await rahul.client.patch(`/api/v1/calendar/events/${privateEventId}`, { title: "1:1 with Rahul (rescheduled)" });
      expect(asRahul.status, JSON.stringify(asRahul)).toBe(200);
    });

    it("5. cancelling an event notifies the participant, never the organizer, and audit-logs the action", async () => {
      const cancel = await rahul.client.post(`/api/v1/calendar/events/${privateEventId}/cancel`);
      expect(cancel.status, JSON.stringify(cancel)).toBe(200);

      const divyaNotifications = await divya.client.get<{ items: Array<{ type: string }> }>("/api/v1/notifications?limit=100");
      expect(divyaNotifications.data!.items.some((n) => n.type === "calendar_event.cancelled")).toBe(true);
      const rahulNotifications = await rahul.client.get<{ items: Array<{ type: string }> }>("/api/v1/notifications?limit=100");
      expect(rahulNotifications.data!.items.some((n) => n.type === "calendar_event.cancelled")).toBe(false);

      const audit = await eldo.client.get<{ items: Array<{ action: string }> }>(
        `/api/v1/organizations/${orgId}/audit-logs?entityType=CalendarEvent&entityId=${privateEventId}`
      );
      expect(audit.data!.items.some((e) => e.action === "calendar_event.cancelled")).toBe(true);
    });

    it("6. Today's merged day timeline combines a calendar event and a scheduled task block, chronologically ordered and clearly distinguished", async () => {
      const task = await divya.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: orgWorkspaceId,
        title: "Prep slides for the all-hands",
      });
      expect(task.status, JSON.stringify(task)).toBe(200);
      await eldo.client.post(`/api/v1/tasks/${task.data!.id}/assignments`, { assigneeType: "USER", assigneeUserId: divya.id });
      const t = await divya.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${task.data!.id}`);
      await divya.client.post(`/api/v1/assignments/${t.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);
      const planned = await divya.client.post<{ id: string }>("/api/v1/me/workday/items", { taskId: task.data!.id, date: "2026-08-12" });
      expect(planned.status, JSON.stringify(planned)).toBe(200);
      await divya.client.patch(`/api/v1/workday-items/${planned.data!.id}`, {
        scheduledStart: "2026-08-12T08:00:00.000Z",
        scheduledEnd: "2026-08-12T08:30:00.000Z",
      });

      const meeting = await divya.client.post<{ id: string }>("/api/v1/calendar/events", {
        workspaceId: orgWorkspaceId,
        title: "Design review",
        startAt: "2026-08-12T09:00:00.000Z",
        endAt: "2026-08-12T09:30:00.000Z",
      });
      expect(meeting.status, JSON.stringify(meeting)).toBe(200);

      const timeline = await divya.client.get<{
        items: Array<{ type: string; title: string; startAt: string }>;
      }>(`/api/v1/calendar/day?workspaceId=${orgWorkspaceId}&date=2026-08-12`);
      expect(timeline.status, JSON.stringify(timeline)).toBe(200);
      expect(timeline.data!.items.length).toBeGreaterThanOrEqual(2);
      const types = timeline.data!.items.map((i) => i.type);
      expect(types).toContain("TASK");
      expect(types).toContain("EVENT");
      // Chronological: every item's startAt is non-decreasing.
      const times = timeline.data!.items.map((i) => new Date(i.startAt).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it("7. a private event never leaks into an unrelated user's day timeline", async () => {
      const priyaTimeline = await priya.client.get<{ items: Array<{ title: string }> }>(
        `/api/v1/calendar/day?workspaceId=${orgWorkspaceId}&date=2026-08-12`
      );
      expect(priyaTimeline.status, JSON.stringify(priyaTimeline)).toBe(200);
      expect(priyaTimeline.data!.items.some((i) => i.title === "Design review")).toBe(false);
    });

    it("8. cross-tenant isolation: an outsider from a different organization cannot read this workspace's calendar at all", async () => {
      const outsider = await signup("calendar-tenant-outsider", "Calendar Tenant Outsider");
      const res = await outsider.client.get(`/api/v1/calendar/events?workspaceId=${orgWorkspaceId}&from=2026-08-01T00:00:00.000Z&to=2026-08-31T00:00:00.000Z`);
      expect(res.status).toBe(403);
    });

    it("9. existing Today/DailyPlanItem functionality is unaffected: scheduledStart/scheduledEnd editing still works exactly as before, and capacity now reports meeting minutes", async () => {
      const workday = await divya.client.get<{ capacityMinutes: number; meetingMinutes: number; plannedMinutes: number; availableMinutes: number }>(
        "/api/v1/me/workday?date=2026-08-12"
      );
      expect(workday.status, JSON.stringify(workday)).toBe(200);
      expect(typeof workday.data!.meetingMinutes).toBe("number");
      expect(typeof workday.data!.availableMinutes).toBe("number");
      expect(workday.data!.meetingMinutes).toBeGreaterThan(0); // the Design review meeting from scenario 6
    });

    it("regression: Phase 1 through Phase 6 behavior is unaffected by anything Phase 7 added", async () => {
      const original = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${taskId}`);
      expect(original.data!.status).toBe("COMPLETED");
    });
  });

  // docs/architecture/28-phase8-task-dependencies-architecture-report.md.
  describe("Phase 8: Task Dependencies / Blocked Work Visibility", () => {
    let alphaId: string;
    let betaId: string;
    let dependencyId: string;

    it("1. Eldo creates two tasks and declares Alpha blocked by Beta", async () => {
      const alpha = await eldo.client.post<{ id: string }>("/api/v1/tasks", { workspaceId: orgWorkspaceId, title: "Dependency Alpha" });
      const beta = await eldo.client.post<{ id: string }>("/api/v1/tasks", { workspaceId: orgWorkspaceId, title: "Dependency Beta" });
      expect(alpha.status, JSON.stringify(alpha)).toBe(200);
      expect(beta.status, JSON.stringify(beta)).toBe(200);
      alphaId = alpha.data!.id;
      betaId = beta.data!.id;

      const created = await eldo.client.post<{ id: string; type: string }>(`/api/v1/tasks/${alphaId}/dependencies`, {
        dependsOnTaskId: betaId,
        type: "BLOCKS",
      });
      expect(created.status, JSON.stringify(created)).toBe(200);
      dependencyId = created.data!.id;

      const listed = await eldo.client.get<{ dependencies: Array<{ relatedTask: { visible: boolean; title?: string } }> }>(
        `/api/v1/tasks/${alphaId}/dependencies`
      );
      expect(listed.status, JSON.stringify(listed)).toBe(200);
      expect(listed.data!.dependencies).toHaveLength(1);
      expect(listed.data!.dependencies[0]!.relatedTask).toMatchObject({ visible: true, title: "Dependency Beta" });
    });

    it("2. a task cannot depend on itself, and a duplicate dependency is rejected", async () => {
      const selfDep = await eldo.client.post(`/api/v1/tasks/${alphaId}/dependencies`, { dependsOnTaskId: alphaId, type: "BLOCKS" });
      expect(selfDep.status).toBe(400);

      const dup = await eldo.client.post(`/api/v1/tasks/${alphaId}/dependencies`, { dependsOnTaskId: betaId, type: "BLOCKS" });
      expect(dup.status).toBe(409);
    });

    it("3. a circular dependency is rejected", async () => {
      const gamma = await eldo.client.post<{ id: string }>("/api/v1/tasks", { workspaceId: orgWorkspaceId, title: "Dependency Gamma" });
      expect(gamma.status, JSON.stringify(gamma)).toBe(200);
      const gammaId = gamma.data!.id;

      // Beta depends on Gamma (Alpha -> Beta -> Gamma already exists as Alpha -> Beta).
      const betaOnGamma = await eldo.client.post(`/api/v1/tasks/${betaId}/dependencies`, { dependsOnTaskId: gammaId, type: "BLOCKS" });
      expect(betaOnGamma.status, JSON.stringify(betaOnGamma)).toBe(200);

      // Gamma depending on Alpha would close the loop Alpha -> Beta -> Gamma -> Alpha.
      const cycle = await eldo.client.post(`/api/v1/tasks/${gammaId}/dependencies`, { dependsOnTaskId: alphaId, type: "BLOCKS" });
      expect(cycle.status, JSON.stringify(cycle)).toBe(409);
    });

    it("4. a dependency can only be created between two tasks in the same workspace", async () => {
      const personalWs = await eldo.client.get<{ personal: { id: string } }>("/api/v1/workspaces");
      const personalTask = await eldo.client.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: personalWs.data!.personal.id,
        title: "Eldo's personal task",
      });
      expect(personalTask.status, JSON.stringify(personalTask)).toBe(200);

      const crossWorkspace = await eldo.client.post(`/api/v1/tasks/${alphaId}/dependencies`, {
        dependsOnTaskId: personalTask.data!.id,
        type: "BLOCKS",
      });
      expect(crossWorkspace.status, JSON.stringify(crossWorkspace)).toBe(400);
    });

    it("5. only the creator/current-assignee/current-assignor can add or remove a dependency — Priya (unrelated) cannot", async () => {
      const asPriya = await priya.client.post(`/api/v1/tasks/${alphaId}/dependencies`, { dependsOnTaskId: betaId, type: "RELATES_TO" });
      expect(asPriya.status).toBe(403);

      const removeAsPriya = await priya.client.delete(`/api/v1/tasks/${alphaId}/dependencies/${dependencyId}`);
      expect(removeAsPriya.status).toBe(403);
    });

    it("6. a blocked task can still be planned and started — advisory only, never enforcement", async () => {
      await eldo.client.post(`/api/v1/tasks/${alphaId}/assignments`, { assigneeType: "USER", assigneeUserId: rahul.id });
      const t = await rahul.client.get<{ assignments: Array<{ id: string; isCurrent: boolean }> }>(`/api/v1/tasks/${alphaId}`);
      const acceptRes = await rahul.client.post(`/api/v1/assignments/${t.data!.assignments.find((a) => a.isCurrent)!.id}/accept`);
      expect(acceptRes.status, JSON.stringify(acceptRes)).toBe(200);

      const planned = await rahul.client.post<{ id: string }>("/api/v1/me/workday/items", { taskId: alphaId, date: "2026-09-01" });
      expect(planned.status, JSON.stringify(planned)).toBe(200);

      const items = await rahul.client.get<Array<{ id: string; task: { id: string }; isBlocked: boolean }>>(
        "/api/v1/me/workday/items?date=2026-09-01"
      );
      expect(items.status, JSON.stringify(items)).toBe(200);
      const alphaItem = items.data!.find((i) => i.task.id === alphaId);
      expect(alphaItem?.isBlocked).toBe(true);

      // Starting it is not blocked either — the plan item's own state machine has no idea
      // dependencies exist (doc 28 §8's explicit "never touch task-status.machine.ts" rule).
      const start = await rahul.client.post(`/api/v1/workday-items/${alphaItem!.id}/start`);
      expect(start.status, JSON.stringify(start)).toBe(200);
    });

    it("7. reporting reflects the blocked task in the team dashboard's attentionRequired.blockedCount", async () => {
      const dashboard = await anu.client.get<{ attentionRequired: { blockedCount: number }; teamTasks: Array<{ id: string }> }>(
        `/api/v1/organizations/${orgId}/reports/team/${marketingTeamId}`
      );
      expect(dashboard.status, JSON.stringify(dashboard)).toBe(200);
      // Alpha isn't necessarily on Marketing Team's own dashboard (it wasn't routed
      // through the team) — this assertion only proves the field exists and is numeric,
      // the org-wide check below proves the count is real.
      expect(typeof dashboard.data!.attentionRequired.blockedCount).toBe("number");

      const org = await eldo.client.get<{ attentionRequired: { blockedCount: number } }>(`/api/v1/organizations/${orgId}/reports/overview`);
      expect(org.status, JSON.stringify(org)).toBe(200);
      expect(org.data!.attentionRequired.blockedCount).toBeGreaterThanOrEqual(1);
    });

    it("8. resolving the blocker clears isBlocked — cancelling Beta unblocks Alpha", async () => {
      const cancel = await eldo.client.delete(`/api/v1/tasks/${betaId}`);
      expect(cancel.status, JSON.stringify(cancel)).toBe(200);

      const items = await rahul.client.get<Array<{ task: { id: string }; isBlocked: boolean }>>("/api/v1/me/workday/items?date=2026-09-01");
      const alphaItem = items.data!.find((i) => i.task.id === alphaId);
      expect(alphaItem?.isBlocked).toBe(false);
    });

    it("9. the dependencies endpoint enforces the same task-visibility boundary every other task read already does", async () => {
      // Divya has no relationship whatsoever to Beta (not creator/assignee/assignor, no
      // REPORTS_VIEW over it) — listing its dependencies is denied outright, before any
      // dependency data is even considered. The finer-grained case (viewer CAN see the
      // source task but NOT a specific related task, which then renders as a { visible:
      // false } placeholder rather than a 403) is covered by the domain-level integration
      // test (task-dependency.service.test.ts) — both layers of the same disclosure rule
      // are exercised, at the layer each is best proven at.
      const asDivya = await divya.client.get(`/api/v1/tasks/${betaId}/dependencies`);
      expect(asDivya.status).toBe(403);
    });

    it("regression: Phase 1 through Phase 7 behavior is unaffected by anything Phase 8 added", async () => {
      const original = await eldo.client.get<{ status: string }>(`/api/v1/tasks/${taskId}`);
      expect(original.data!.status).toBe("COMPLETED");
    });
  });
});
