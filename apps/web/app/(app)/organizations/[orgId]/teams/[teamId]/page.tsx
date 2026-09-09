"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { TaskCard, type TaskSummary } from "@/components/TaskCard";

interface TeamWorkload {
  user: { id: string; fullName: string };
  isHead: boolean;
  activeTaskCount: number;
  // Phase 4 — docs/architecture/21-phase4-management-visibility-architecture-report.md
  // §6/§8/§12: today's Daily Work Cycle signal for this person, reusing the exact same
  // capacity formula and status shape the Today screen itself uses — never a redefinition.
  workdayStatus: "NOT_STARTED" | "OPEN" | "CLOSED";
  capacityMinutes: number;
  plannedMinutes: number;
  overCapacity: boolean;
  unplannedItemCount: number;
  carryForwardRepeatCount: number;
}
interface AttentionRequired {
  stuckAcknowledgementCount: number;
  overCapacityCount: number;
  carryForwardRepeatCount: number;
  unplannedCount: number;
  // Phase 8 — docs/architecture/28-phase8-task-dependencies-architecture-report.md §9.
  blockedCount: number;
}
interface TeamDashboard {
  team: { id: string; name: string };
  teamTasks: TaskSummary[];
  unassigned: TaskSummary[];
  assigned: TaskSummary[];
  inProgress: TaskSummary[];
  overdue: TaskSummary[];
  pendingAcceptance: TaskSummary[];
  workload: TeamWorkload[];
  stuckAcknowledgement: TaskSummary[];
  attentionRequired: AttentionRequired;
}
interface OrgMember {
  user: { id: string; fullName: string; email: string };
}
interface Role {
  id: string;
  name: string;
}

export default function TeamDetailPage() {
  const { orgId, teamId } = useParams<{ orgId: string; teamId: string }>();
  const [data, setData] = useState<TeamDashboard | null>(null);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [addUserId, setAddUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<TeamDashboard>(`/api/v1/organizations/${orgId}/reports/team/${teamId}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load"));
    api.get<OrgMember[]>(`/api/v1/organizations/${orgId}/members`).then(setOrgMembers).catch(() => {});
    api.get<Role[]>(`/api/v1/organizations/${orgId}/roles`).then(setRoles).catch(() => {});
  }
  useEffect(load, [orgId, teamId]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/api/v1/teams/${teamId}/members`, { userId: addUserId });
      setAddUserId("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function toggleHead(userId: string, isHead: boolean) {
    setError(null);
    try {
      await api.patch(`/api/v1/teams/${teamId}/members/${userId}`, { isHead });
      if (isHead) {
        const teamHeadRole = roles.find((r) => r.name === "TEAM_HEAD");
        if (teamHeadRole) {
          await api.post(`/api/v1/organizations/${orgId}/role-grants`, {
            userId,
            roleId: teamHeadRole.id,
            scopeType: "TEAM",
            scopeId: teamId,
          });
        }
      }
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-slate-400">Loading…</p>;

  const attention = data.attentionRequired;
  const attentionTotal =
    attention.stuckAcknowledgementCount +
    attention.overCapacityCount +
    attention.carryForwardRepeatCount +
    attention.unplannedCount +
    attention.blockedCount;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">{data.team.name}</h1>

      {attentionTotal > 0 && (
        <div className="card space-y-2 border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-800">Attention required</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Stuck in acknowledgement", value: attention.stuckAcknowledgementCount },
              { label: "Over capacity today", value: attention.overCapacityCount },
              { label: "Repeatedly carried forward", value: attention.carryForwardRepeatCount },
              { label: "Unplanned items today", value: attention.unplannedCount },
              { label: "Blocked", value: attention.blockedCount },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-lg font-semibold text-amber-900">{s.value}</p>
                <p className="text-xs text-amber-700">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {[
          { label: "Unassigned", value: data.unassigned.length },
          { label: "Pending Acceptance", value: data.pendingAcceptance.length },
          { label: "In Progress", value: data.inProgress.length },
          { label: "Overdue", value: data.overdue.length },
          { label: "Total", value: data.teamTasks.length },
        ].map((s) => (
          <div key={s.label} className="card p-3 text-center">
            <p className="text-xl font-semibold text-slate-900">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      {data.stuckAcknowledgement.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Stuck in acknowledgement</h2>
          <div className="space-y-2">
            {data.stuckAcknowledgement.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        </div>
      )}

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Members &amp; workload</h2>
        <div className="space-y-2">
          {data.workload.map((w) => (
            <div key={w.user.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-slate-800">{w.user.fullName}</span>
                {w.isHead && <span className="badge ml-2 bg-brand-50 text-brand-700">Team Head</span>}
                <span className="ml-2 text-xs text-slate-400">{w.activeTaskCount} active task(s)</span>
                {w.workdayStatus !== "NOT_STARTED" && (
                  <span className="ml-2 text-xs text-slate-400">
                    · {w.plannedMinutes}/{w.capacityMinutes} min today
                    {w.overCapacity && <span className="ml-1 font-medium text-amber-700">over capacity</span>}
                    {w.carryForwardRepeatCount > 0 && (
                      <span className="ml-1 text-amber-700">· {w.carryForwardRepeatCount} repeated carry-forward</span>
                    )}
                  </span>
                )}
              </div>
              <label className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
                <input type="checkbox" checked={w.isHead} onChange={(e) => toggleHead(w.user.id, e.target.checked)} />
                Head
              </label>
            </div>
          ))}
        </div>

        <form onSubmit={addMember} className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
          <select className="input" value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
            <option value="">Add org member to this team…</option>
            {orgMembers
              .filter((m) => !data.workload.some((w) => w.user.id === m.user.id))
              .map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.fullName}
                </option>
              ))}
          </select>
          <button className="btn-primary shrink-0" disabled={!addUserId}>
            Add
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Team Tasks</h2>
        {data.teamTasks.length === 0 ? (
          <p className="text-sm text-slate-400">No tasks for this team yet.</p>
        ) : (
          <div className="space-y-2">
            {data.teamTasks.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
