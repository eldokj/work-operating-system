"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { api } from "@/lib/api-client";
import { TaskCard, type TaskSummary } from "@/components/TaskCard";

type View = "MY_TASKS" | "PENDING_MY_ACKNOWLEDGEMENT" | "ALL";

const PERSONAL_VIEWS: Array<{ value: View; label: string }> = [{ value: "ALL", label: "All Tasks" }];
const ORG_VIEWS: Array<{ value: View; label: string }> = [
  { value: "MY_TASKS", label: "My Tasks" },
  { value: "PENDING_MY_ACKNOWLEDGEMENT", label: "Pending Acceptance" },
  { value: "ALL", label: "All Visible to Me" },
];

export default function TasksPage() {
  const { currentWorkspaceId, currentOrg, loading: wsLoading } = useWorkspace();
  const [view, setView] = useState<View>("MY_TASKS");
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const views = currentOrg ? ORG_VIEWS : PERSONAL_VIEWS;

  useEffect(() => {
    if (!currentOrg && view !== "ALL") setView("ALL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrg]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    setLoading(true);
    api
      .get<TaskSummary[]>(`/api/v1/tasks?workspaceId=${currentWorkspaceId}&view=${view}`)
      .then(setTasks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentWorkspaceId, view]);

  if (wsLoading) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Tasks</h1>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {views.map((v) => (
          <button
            key={v.value}
            onClick={() => setView(v.value)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              view === v.value ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-slate-400">Loading tasks…</div>
      ) : error ? (
        <div className="text-red-600">{error}</div>
      ) : tasks.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">No tasks in this view.</div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {tasks.map((t) => (
            <div key={t.id} className="p-1">
              <TaskCard task={t} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
