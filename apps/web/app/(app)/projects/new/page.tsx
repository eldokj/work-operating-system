"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/workspace-context";
import { api, ApiError } from "@/lib/api-client";

interface Team {
  id: string;
  name: string;
}

export default function NewProjectPage() {
  const router = useRouter();
  const { currentWorkspaceId, currentOrg } = useWorkspace();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"PROJECT" | "EVENT">("PROJECT");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    api.get<Team[]>(`/api/v1/organizations/${currentOrg.organizationId}/teams`).then(setTeams).catch(() => {});
  }, [currentOrg]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentWorkspaceId || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await api.post<{ id: string }>(`/api/v1/workspaces/${currentWorkspaceId}/projects`, {
        name: name.trim(),
        description: description.trim() || null,
        kind,
        startDate: startDate || null,
        targetDate: targetDate || null,
        teamId: teamId || null,
      });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Create project or event</h1>

      <form onSubmit={handleSubmit} className="card space-y-5 p-6">
        <div>
          <label className="label">Type</label>
          <div className="flex gap-2">
            <button
              type="button"
              className={`btn-secondary ${kind === "PROJECT" ? "border-brand-400 bg-brand-50 text-brand-700" : ""}`}
              onClick={() => setKind("PROJECT")}
            >
              Project
            </button>
            <button
              type="button"
              className={`btn-secondary ${kind === "EVENT" ? "border-brand-400 bg-brand-50 text-brand-700" : ""}`}
              onClick={() => setKind("EVENT")}
            >
              Event
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            E.g. an ongoing initiative (Project) or a one-off occasion like &ldquo;Annual Day 2026&rdquo; (Event) — purely
            organizational, both work identically.
          </p>
        </div>

        <div>
          <label className="label">Name</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Annual Day 2026" />
        </div>

        <div>
          <label className="label">Description</label>
          <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Start date</label>
            <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Target date</label>
            <input type="date" className="input" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
        </div>

        {currentOrg && teams.length > 0 && (
          <div>
            <label className="label">Owning team (optional)</label>
            <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">None</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => router.back()}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
