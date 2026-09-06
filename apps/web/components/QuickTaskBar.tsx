"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api-client";

// The central "What needs to be done?" interaction (doc 28) — fast Quick Task creation
// without leaving the current page. Advanced Task creation (assignment, checklist,
// due date, etc.) lives at /tasks/new.
export function QuickTaskBar({
  workspaceId,
}: {
  workspaceId: string | null;
  isOrgWorkspace: boolean;
  organizationId: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !workspaceId) return;
    setSubmitting(true);
    setError(null);
    try {
      const task = await api.post<{ id: string }>("/api/v1/tasks", { workspaceId, title: title.trim() });
      setTitle("");
      router.push(`/tasks/${task.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-xl items-center gap-2">
      <input
        className="input"
        placeholder="What needs to be done?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={!workspaceId}
      />
      <button type="submit" className="btn-primary shrink-0" disabled={submitting || !title.trim()}>
        Add
      </button>
      <Link href="/tasks/new" className="btn-secondary shrink-0">
        Advanced
      </Link>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
