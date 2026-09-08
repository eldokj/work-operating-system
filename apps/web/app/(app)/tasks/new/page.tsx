"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkspace } from "@/lib/workspace-context";
import { api, ApiError } from "@/lib/api-client";

interface Member {
  user: { id: string; fullName: string; email: string };
}
interface Team {
  id: string;
  name: string;
}
interface ProjectOption {
  id: string;
  name: string;
}

export default function NewTaskPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentWorkspaceId, currentOrg } = useWorkspace();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [checklist, setChecklist] = useState<string[]>([""]);

  const [assignType, setAssignType] = useState<"NONE" | "USER" | "TEAM">("NONE");
  const [assignId, setAssignId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  // Project/Event Workspace picker — doc 17 §17. Pre-selected when arriving via a
  // project's "+ New task in this project" button (?projectId=...); otherwise optional,
  // same as every other project-scoped field (Task.projectId has always been nullable).
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    api.get<Member[]>(`/api/v1/organizations/${currentOrg.organizationId}/members`).then(setMembers).catch(() => {});
    api.get<Team[]>(`/api/v1/organizations/${currentOrg.organizationId}/teams`).then(setTeams).catch(() => {});
  }, [currentOrg]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    api.get<ProjectOption[]>(`/api/v1/workspaces/${currentWorkspaceId}/projects`).then(setProjects).catch(() => {});
  }, [currentWorkspaceId]);

  function updateChecklistItem(i: number, value: string) {
    setChecklist((prev) => prev.map((c, idx) => (idx === i ? value : c)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentWorkspaceId || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const task = await api.post<{ id: string }>("/api/v1/tasks", {
        workspaceId: currentWorkspaceId,
        projectId: projectId || null,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        dueDate: dueDate || null,
        checklist: checklist.map((c) => c.trim()).filter(Boolean),
        assignTo: assignType === "NONE" || !assignId ? null : { type: assignType, id: assignId },
      });
      router.push(`/tasks/${task.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Create task</h1>

      <form onSubmit={handleSubmit} className="card space-y-5 p-6">
        <div>
          <label className="label">Title</label>
          <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            className="input"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {projects.length > 0 && (
          <div>
            <label className="label">Project / Event (optional)</label>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Priority</label>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
          <div>
            <label className="label">Due date</label>
            <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Checklist</label>
          <div className="space-y-2">
            {checklist.map((item, i) => (
              <input
                key={i}
                className="input"
                placeholder={`Item ${i + 1}`}
                value={item}
                onChange={(e) => updateChecklistItem(i, e.target.value)}
              />
            ))}
          </div>
          <button
            type="button"
            className="mt-2 text-sm text-brand-600 hover:underline"
            onClick={() => setChecklist((prev) => [...prev, ""])}
          >
            + Add checklist item
          </button>
        </div>

        {currentOrg && (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <label className="label">Assign to (optional)</label>
            <div className="flex gap-2">
              <select
                className="input w-40"
                value={assignType}
                onChange={(e) => {
                  setAssignType(e.target.value as typeof assignType);
                  setAssignId("");
                }}
              >
                <option value="NONE">Unassigned</option>
                <option value="USER">Individual</option>
                <option value="TEAM">Team</option>
              </select>
              {assignType === "USER" && (
                <select className="input" value={assignId} onChange={(e) => setAssignId(e.target.value)}>
                  <option value="">Select a person…</option>
                  {members.map((m) => (
                    <option key={m.user.id} value={m.user.id}>
                      {m.user.fullName}
                    </option>
                  ))}
                </select>
              )}
              {assignType === "TEAM" && (
                <select className="input" value={assignId} onChange={(e) => setAssignId(e.target.value)}>
                  <option value="">Select a team…</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Assigning to a team notifies its Team Head for acknowledgement — it does not create a task for
              every member.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => router.back()}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Creating…" : "Create task"}
          </button>
        </div>
      </form>
    </div>
  );
}
