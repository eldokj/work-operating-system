"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/lib/workspace-context";
import { api, ApiError } from "@/lib/api-client";

interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED";
  kind: "PROJECT" | "EVENT";
  targetDate: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-blue-100 text-blue-700",
  ON_HOLD: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  ARCHIVED: "bg-slate-100 text-slate-400",
};

/** Projects / Event Workspaces list — doc 17 §17. Filtered server-side to what the caller
 * actually participates in (ProjectService.listProjectsForUser), not every project in the
 * workspace. */
export default function ProjectsPage() {
  const { currentWorkspaceId, loading: wsLoading } = useWorkspace();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    setLoading(true);
    api
      .get<ProjectSummary[]>(`/api/v1/workspaces/${currentWorkspaceId}/projects`)
      .then(setProjects)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load projects"))
      .finally(() => setLoading(false));
  }, [currentWorkspaceId]);

  if (wsLoading) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Projects</h1>
        <Link href="/projects/new" className="btn-primary text-sm">
          + New project
        </Link>
      </div>

      {loading ? (
        <div className="text-slate-400">Loading projects…</div>
      ) : error ? (
        <div className="text-red-600">{error}</div>
      ) : projects.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">
          No projects or events yet — group related tasks (e.g. &ldquo;Annual Day 2026&rdquo;) into one here.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="card block space-y-2 p-4 hover:border-brand-300 hover:bg-brand-50/40"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="truncate text-sm font-semibold text-slate-800">{p.name}</h2>
                <span className="badge shrink-0 bg-slate-100 text-slate-500">{p.kind === "EVENT" ? "Event" : "Project"}</span>
              </div>
              {p.description && <p className="line-clamp-2 text-xs text-slate-500">{p.description}</p>}
              <div className="flex items-center justify-between">
                <span className={`badge ${STATUS_STYLES[p.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {p.status.replace(/_/g, " ")}
                </span>
                {p.targetDate && (
                  <span className="text-xs text-slate-400">Target {new Date(p.targetDate).toLocaleDateString()}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
