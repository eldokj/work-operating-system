"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/lib/workspace-context";
import { api } from "@/lib/api-client";
import { TaskCard, type TaskSummary } from "@/components/TaskCard";

interface PersonalDashboard {
  myTasks: TaskSummary[];
  dueToday: TaskSummary[];
  upcoming: TaskSummary[];
  overdue: TaskSummary[];
  completed: TaskSummary[];
  pendingAcceptance: TaskSummary[];
  waitingForReview: TaskSummary[];
  myProjects: Array<{ id: string; name: string }>;
}

function Section({ title, tasks, emptyText }: { title: string; tasks: TaskSummary[]; emptyText: string }) {
  return (
    <div className="card p-4">
      <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-700">
        {title}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{tasks.length}</span>
      </h2>
      {tasks.length === 0 ? (
        <p className="text-sm text-slate-400">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {tasks.slice(0, 6).map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { currentWorkspaceId, currentOrg, loading: wsLoading } = useWorkspace();
  const [data, setData] = useState<PersonalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    setLoading(true);
    api
      .get<PersonalDashboard>(`/api/v1/dashboards/personal?workspaceId=${currentWorkspaceId}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentWorkspaceId]);

  if (wsLoading || loading) return <div className="text-slate-400">Loading dashboard…</div>;
  if (error) return <div className="text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">
          {currentOrg ? `${currentOrg.organizationName} — My Dashboard` : "Personal Dashboard"}
        </h1>
        {currentOrg && (
          <Link href={`/organizations/${currentOrg.organizationId}`} className="btn-secondary text-sm">
            Organization overview
          </Link>
        )}
      </div>

      {data.pendingAcceptance.length > 0 && (
        <Section title="Pending Acceptance" tasks={data.pendingAcceptance} emptyText="Nothing pending." />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section title="Due Today" tasks={data.dueToday} emptyText="Nothing due today." />
        <Section title="Overdue" tasks={data.overdue} emptyText="Nothing overdue." />
        <Section title="Upcoming" tasks={data.upcoming} emptyText="Nothing upcoming." />
        {data.waitingForReview.length > 0 && (
          <Section title="Waiting for Review" tasks={data.waitingForReview} emptyText="" />
        )}
        <Section title="My Tasks" tasks={data.myTasks} emptyText="No active tasks — create one above." />
        <Section title="Completed" tasks={data.completed} emptyText="Nothing completed yet." />
      </div>

      {data.myProjects.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">My Projects</h2>
          <div className="flex flex-wrap gap-2">
            {data.myProjects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="badge bg-slate-100 text-slate-700 hover:bg-slate-200">
                {p.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
