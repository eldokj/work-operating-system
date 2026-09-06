"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { TaskCard, type TaskSummary } from "@/components/TaskCard";

interface TeamDashboard {
  team: { id: string; name: string };
  teamTasks: TaskSummary[];
  unassigned: TaskSummary[];
  assigned: TaskSummary[];
  inProgress: TaskSummary[];
  overdue: TaskSummary[];
  pendingAcceptance: TaskSummary[];
  workload: Array<{ user: { id: string; fullName: string }; isHead: boolean; activeTaskCount: number }>;
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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">{data.team.name}</h1>

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

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Members &amp; workload</h2>
        <div className="space-y-2">
          {data.workload.map((w) => (
            <div key={w.user.id} className="flex items-center justify-between text-sm">
              <div>
                <span className="font-medium text-slate-800">{w.user.fullName}</span>
                {w.isHead && <span className="badge ml-2 bg-brand-50 text-brand-700">Team Head</span>}
                <span className="ml-2 text-xs text-slate-400">{w.activeTaskCount} active task(s)</span>
              </div>
              <label className="flex items-center gap-1 text-xs text-slate-500">
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
