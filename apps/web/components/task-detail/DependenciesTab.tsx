"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api-client";

// Phase 8 — docs/architecture/28-phase8-task-dependencies-architecture-report.md §10.
// A plain list, never a graph/network visualization (doc 28 §10's explicit exclusion).

interface RelatedTaskRef {
  id: string;
  visible: boolean;
  title?: string;
  status?: string;
  priority?: string;
}
interface DependencyEdge {
  id: string;
  type: "BLOCKS" | "RELATES_TO";
  relatedTask: RelatedTaskRef;
}
interface DependencyList {
  dependencies: DependencyEdge[]; // what this task depends on (blocked by)
  dependedOnBy: DependencyEdge[]; // what depends on this task (blocks)
}
interface SearchResultItem {
  type: "TASK" | "PROJECT" | "MESSAGE";
  id: string;
  title: string;
}

function RelatedTaskLine({ relatedTask }: { relatedTask: RelatedTaskRef }) {
  if (!relatedTask.visible) {
    return <span className="text-sm italic text-slate-400">A task you don&rsquo;t have access to</span>;
  }
  return (
    <Link href={`/tasks/${relatedTask.id}`} className="text-sm font-medium text-slate-800 hover:underline">
      {relatedTask.title}
      {relatedTask.status && <span className="ml-1.5 text-xs font-normal text-slate-400">{relatedTask.status.replace(/_/g, " ")}</span>}
    </Link>
  );
}

export function DependenciesTab({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const [list, setList] = useState<DependencyList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);

  const load = useCallback(async () => {
    try {
      const l = await api.get<DependencyList>(`/api/v1/tasks/${taskId}/dependencies`);
      setList(l);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load dependencies");
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api
        .get<{ items: SearchResultItem[] }>(`/api/v1/search?q=${encodeURIComponent(query)}`)
        .then((r) => setResults(r.items.filter((i) => i.type === "TASK" && i.id !== taskId)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, taskId]);

  async function addDependency(dependsOnTaskId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/tasks/${taskId}/dependencies`, { dependsOnTaskId, type: "BLOCKS" });
      setQuery("");
      setResults([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add dependency");
    } finally {
      setBusy(false);
    }
  }

  async function removeDependency(dependencyId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api/v1/tasks/${taskId}/dependencies/${dependencyId}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove dependency");
    } finally {
      setBusy(false);
    }
  }

  if (!list) return <div className="card p-4 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold text-slate-700">Blocked by</h2>
        {list.dependencies.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing is blocking this task.</p>
        ) : (
          <div className="space-y-1.5">
            {list.dependencies.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-2">
                <RelatedTaskLine relatedTask={d.relatedTask} />
                {canEdit && (
                  <button className="shrink-0 text-xs text-slate-400 hover:text-red-600" disabled={busy} onClick={() => removeDependency(d.id)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {list.dependedOnBy.length > 0 && (
        <div className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Blocks</h2>
          <div className="space-y-1.5">
            {list.dependedOnBy.map((d) => (
              <div key={d.id} className="rounded-lg border border-slate-100 p-2">
                <RelatedTaskLine relatedTask={d.relatedTask} />
              </div>
            ))}
          </div>
        </div>
      )}

      {canEdit && (
        <div className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Add a blocker</h2>
          <input
            className="input"
            placeholder="Search tasks by title…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
              {results.map((r) => (
                <button
                  key={r.id}
                  className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  disabled={busy}
                  onClick={() => addDependency(r.id)}
                >
                  {r.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
