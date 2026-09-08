"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";

interface SearchResultItem {
  type: "TASK" | "PROJECT" | "MESSAGE";
  id: string;
  title: string;
  snippet: string | null;
  taskId: string | null;
  projectId: string | null;
  workspaceId: string;
}

const TYPE_LABEL: Record<SearchResultItem["type"], string> = {
  TASK: "Task",
  PROJECT: "Project",
  MESSAGE: "Message",
};

/** Phase 5 — docs/architecture/22-phase5-product-capability-and-roadmap-assessment.md §8.
 * A plain results list, not a faceted/filterable BI-style search UI — matches the
 * approved scope exactly (tasks + projects + messages, ranked, no pagination). */
export default function SearchPage() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setResults(null);
    setError(null);
    api
      .get<{ items: SearchResultItem[] }>(`/api/v1/search?q=${encodeURIComponent(q)}`)
      .then((res) => setResults(res.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Search failed"));
  }, [q]);

  function hrefFor(item: SearchResultItem): string {
    if (item.type === "PROJECT") return `/projects/${item.id}`;
    if (item.type === "TASK") return `/tasks/${item.id}`;
    // MESSAGE — link to the conversation it lives in (task or project detail page).
    if (item.taskId) return `/tasks/${item.taskId}`;
    if (item.projectId) return `/projects/${item.projectId}`;
    return "#";
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">
        Search{q && <span className="font-normal text-slate-500"> — &ldquo;{q}&rdquo;</span>}
      </h1>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && results === null && <p className="text-sm text-slate-400">Searching…</p>}
      {!error && results !== null && results.length === 0 && (
        <div className="card p-8 text-center text-slate-400">
          {q.trim() ? "No results." : "Type something in the search box above."}
        </div>
      )}
      {!error && results !== null && results.length > 0 && (
        <div className="card divide-y divide-slate-100">
          {results.map((item) => (
            <Link
              key={`${item.type}-${item.id}`}
              href={hrefFor(item)}
              className="block px-4 py-3 hover:bg-slate-50"
            >
              <div className="flex items-center gap-2">
                <span className="badge shrink-0 bg-slate-100 text-slate-500">{TYPE_LABEL[item.type]}</span>
                <span className="truncate text-sm font-medium text-slate-800">{item.title}</span>
              </div>
              {item.snippet && <p className="mt-1 truncate text-xs text-slate-500">{item.snippet}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
