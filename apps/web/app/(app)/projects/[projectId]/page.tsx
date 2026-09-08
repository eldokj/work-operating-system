"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/workspace-context";
import { api, ApiError } from "@/lib/api-client";
import { TaskCard, type TaskSummary } from "@/components/TaskCard";
import { ConversationTab } from "@/components/task-detail/ConversationTab";
import { FilesTab } from "@/components/task-detail/FilesTab";
import { ActivityTab } from "@/components/task-detail/ActivityTab";

interface PersonRef {
  id: string;
  fullName: string;
  email: string;
}
interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED";
  kind: "PROJECT" | "EVENT";
  startDate: string | null;
  targetDate: string | null;
  workspaceId: string;
  ownerId: string;
  owner: PersonRef;
  department: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  workspace: { type: "PERSONAL" | "ORGANIZATION"; organizationId: string | null };
}
interface ProjectMemberRow {
  user: PersonRef;
  addedById: string;
  createdAt: string;
}
interface ProjectTeamRow {
  team: { id: string; name: string };
  createdAt: string;
}
interface ProjectDateRow {
  id: string;
  title: string;
  date: string;
  notes: string | null;
  createdBy: PersonRef;
}
interface Progress {
  total: number;
  completed: number;
  active: number;
  cancelled: number;
  percent: number;
}
interface OrgMember {
  user: PersonRef;
}
interface OrgTeam {
  id: string;
  name: string;
}

const TABS = ["Overview", "Conversation", "Tasks", "Files", "People", "Dates", "Activity"] as const;
type Tab = (typeof TABS)[number];

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-blue-100 text-blue-700",
  ON_HOLD: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  ARCHIVED: "bg-slate-100 text-slate-400",
};

/** Project / Event Workspace detail — doc 17 §17. Reuses the exact tab pattern
 * tasks/[taskId]/page.tsx established, and the same shared Conversation/Files/Activity tab
 * components (generalized in Phase 2C to accept a scope rather than being task-only). */
export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { me, currentOrg } = useWorkspace();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [teams, setTeams] = useState<ProjectTeamRow[]>([]);
  const [dates, setDates] = useState<ProjectDateRow[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [orgTeams, setOrgTeams] = useState<OrgTeam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const [p, m, t, d, pr, tk] = await Promise.all([
        api.get<ProjectDetail>(`/api/v1/projects/${projectId}`),
        api.get<ProjectMemberRow[]>(`/api/v1/projects/${projectId}/members`),
        api.get<ProjectTeamRow[]>(`/api/v1/projects/${projectId}/teams`),
        api.get<ProjectDateRow[]>(`/api/v1/projects/${projectId}/dates`),
        api.get<Progress>(`/api/v1/projects/${projectId}/progress`),
        api.get<TaskSummary[]>(`/api/v1/projects/${projectId}/tasks`),
      ]);
      setProject(p);
      setMembers(m);
      setTeams(t);
      setDates(d);
      setProgress(pr);
      setTasks(tk);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load project");
    }
  }, [projectId]);

  const refreshUnread = useCallback(async () => {
    try {
      const conv = await api.get<{ unreadCount: number }>(`/api/v1/projects/${projectId}/conversation`);
      setUnreadCount(conv.unreadCount);
    } catch {
      // non-critical — the badge just won't show
    }
  }, [projectId]);

  useEffect(() => {
    load();
    refreshUnread();
  }, [load, refreshUnread]);

  useEffect(() => {
    if (!currentOrg) return;
    api.get<OrgMember[]>(`/api/v1/organizations/${currentOrg.organizationId}/members`).then(setOrgMembers).catch(() => {});
    api.get<OrgTeam[]>(`/api/v1/organizations/${currentOrg.organizationId}/teams`).then(setOrgTeams).catch(() => {});
  }, [currentOrg]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="text-red-600">{error}</div>;
  if (!project || !me) return <div className="text-slate-400">Loading…</div>;

  const isOrg = project.workspace.type === "ORGANIZATION";
  const canManage = project.ownerId === me.id || !isOrg; // server re-derives the real rule; this only toggles the UI
  const memberCandidates = orgMembers.filter((m) => !members.some((pm) => pm.user.id === m.user.id));
  const mentionCandidates: PersonRef[] = [project.owner, ...members.map((m) => m.user)].filter(
    (p, i, arr) => p.id !== me.id && arr.findIndex((q) => q.id === p.id) === i
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:underline">
        ← Back
      </button>

      <div className="card space-y-2 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{project.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {project.kind === "EVENT" ? "Event" : "Project"} · Owned by {project.owner.fullName}
              {project.targetDate && <> · Target {new Date(project.targetDate).toLocaleDateString()}</>}
            </p>
          </div>
          <span className={`badge shrink-0 ${STATUS_STYLES[project.status] ?? "bg-slate-100 text-slate-600"}`}>
            {project.status.replace(/_/g, " ")}
          </span>
        </div>
        {progress && (
          <div className="pt-1">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>
                {progress.completed} of {progress.total} tasks complete
              </span>
              <span>{progress.percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t}
            {t === "Conversation" && unreadCount > 0 && (
              <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {tab === "Overview" && (
        <div className="space-y-4">
          <div className="card space-y-3 p-6">
            {project.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{project.description}</p>}
            {(project.department || project.team) && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                {project.department && `Department: ${project.department.name}`}
                {project.department && project.team && " · "}
                {project.team && `Team: ${project.team.name}`}
              </div>
            )}
            {canManage && project.status !== "ARCHIVED" && (
              <button
                className="btn-danger text-xs"
                disabled={busy}
                onClick={() => run(() => api.delete(`/api/v1/projects/${project.id}`))}
              >
                Archive project
              </button>
            )}
          </div>

          {dates.filter((d) => new Date(d.date) >= new Date(new Date().toDateString())).length > 0 && (
            <div className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Upcoming dates</h2>
              <ul className="space-y-1.5">
                {dates
                  .filter((d) => new Date(d.date) >= new Date(new Date().toDateString()))
                  .slice(0, 5)
                  .map((d) => (
                    <li key={d.id} className="flex items-baseline justify-between text-sm">
                      <span className="text-slate-700">{d.title}</span>
                      <span className="text-xs text-slate-400">{new Date(d.date).toLocaleDateString()}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {tasks.filter((t) => !["COMPLETED", "CANCELLED"].includes(t.status)).length > 0 && (
            <div className="card divide-y divide-slate-100 p-1">
              <h2 className="p-3 pb-1 text-sm font-semibold text-slate-700">Active tasks</h2>
              {tasks
                .filter((t) => !["COMPLETED", "CANCELLED"].includes(t.status))
                .slice(0, 6)
                .map((t) => (
                  <div key={t.id} className="p-1">
                    <TaskCard task={t} />
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {tab === "Conversation" && (
        <ConversationTab
          scope={{ kind: "PROJECT", id: project.id }}
          currentUserId={me.id}
          mentionCandidates={mentionCandidates}
          onActivity={refreshUnread}
        />
      )}

      {tab === "Tasks" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              className="btn-secondary text-sm"
              onClick={() => router.push(`/tasks/new?projectId=${project.id}&workspaceId=${project.workspaceId}`)}
            >
              + New task in this project
            </button>
          </div>
          {tasks.length === 0 ? (
            <div className="card p-8 text-center text-slate-400">No tasks in this project yet.</div>
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
      )}

      {tab === "Files" && <FilesTab scope={{ kind: "PROJECT", id: project.id }} />}

      {tab === "People" && (
        <PeoplePanel
          members={members}
          teams={teams}
          isOrg={isOrg}
          canManage={canManage}
          candidates={memberCandidates}
          orgTeams={orgTeams.filter((t) => !teams.some((pt) => pt.team.id === t.id))}
          ownerId={project.ownerId}
          busy={busy}
          onAddMember={(userId) => run(() => api.post(`/api/v1/projects/${project.id}/members`, { userId }))}
          onRemoveMember={(userId) => run(() => api.delete(`/api/v1/projects/${project.id}/members/${userId}`))}
          onAddTeam={(teamId) => run(() => api.post(`/api/v1/projects/${project.id}/teams`, { teamId }))}
          onRemoveTeam={(teamId) => run(() => api.delete(`/api/v1/projects/${project.id}/teams/${teamId}`))}
        />
      )}

      {tab === "Dates" && (
        <DatesPanel
          dates={dates}
          canManage={canManage}
          busy={busy}
          onAdd={(title, date, notes) => run(() => api.post(`/api/v1/projects/${project.id}/dates`, { title, date, notes }))}
          onDelete={(dateId) => run(() => api.delete(`/api/v1/project-dates/${dateId}`))}
        />
      )}

      {tab === "Activity" && <ActivityTab scope={{ kind: "PROJECT", id: project.id }} />}
    </div>
  );
}

function PeoplePanel({
  members,
  teams,
  isOrg,
  canManage,
  candidates,
  orgTeams,
  ownerId,
  busy,
  onAddMember,
  onRemoveMember,
  onAddTeam,
  onRemoveTeam,
}: {
  members: ProjectMemberRow[];
  teams: ProjectTeamRow[];
  isOrg: boolean;
  canManage: boolean;
  candidates: OrgMember[];
  orgTeams: OrgTeam[];
  ownerId: string;
  busy: boolean;
  onAddMember: (userId: string) => void;
  onRemoveMember: (userId: string) => void;
  onAddTeam: (teamId: string) => void;
  onRemoveTeam: (teamId: string) => void;
}) {
  const [newMember, setNewMember] = useState("");
  const [newTeam, setNewTeam] = useState("");

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-slate-700">Members</h2>
        <div className="space-y-1.5">
          {members.map((m) => (
            <div key={m.user.id} className="flex items-center justify-between text-sm">
              <span className="text-slate-700">
                {m.user.fullName} {m.user.id === ownerId && <span className="text-xs text-slate-400">(owner)</span>}
              </span>
              {isOrg && canManage && m.user.id !== ownerId && (
                <button className="text-xs text-slate-400 hover:text-red-600" disabled={busy} onClick={() => onRemoveMember(m.user.id)}>
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        {isOrg && canManage && (
          <div className="flex gap-2 border-t border-slate-100 pt-3">
            <select className="input" value={newMember} onChange={(e) => setNewMember(e.target.value)}>
              <option value="">Add a member…</option>
              {candidates.map((c) => (
                <option key={c.user.id} value={c.user.id}>
                  {c.user.fullName}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary shrink-0"
              disabled={busy || !newMember}
              onClick={() => {
                onAddMember(newMember);
                setNewMember("");
              }}
            >
              Add
            </button>
          </div>
        )}
      </div>

      {isOrg && (
        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Teams</h2>
          {teams.length === 0 ? (
            <p className="text-sm text-slate-400">No participating teams yet.</p>
          ) : (
            <div className="space-y-1.5">
              {teams.map((t) => (
                <div key={t.team.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{t.team.name}</span>
                  {canManage && (
                    <button className="text-xs text-slate-400 hover:text-red-600" disabled={busy} onClick={() => onRemoveTeam(t.team.id)}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {canManage && (
            <div className="flex gap-2 border-t border-slate-100 pt-3">
              <select className="input" value={newTeam} onChange={(e) => setNewTeam(e.target.value)}>
                <option value="">Add a team…</option>
                {orgTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                className="btn-secondary shrink-0"
                disabled={busy || !newTeam}
                onClick={() => {
                  onAddTeam(newTeam);
                  setNewTeam("");
                }}
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DatesPanel({
  dates,
  canManage,
  busy,
  onAdd,
  onDelete,
}: {
  dates: ProjectDateRow[];
  canManage: boolean;
  busy: boolean;
  onAdd: (title: string, date: string, notes: string | null) => void;
  onDelete: (dateId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

  const sorted = [...dates].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="space-y-4">
      <div className="card p-4">
        {sorted.length === 0 ? (
          <p className="text-sm text-slate-400">No important dates yet.</p>
        ) : (
          <div className="space-y-2">
            {sorted.map((d) => (
              <div key={d.id} className="flex items-start justify-between gap-3 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-slate-800">{d.title}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(d.date).toLocaleDateString()} · added by {d.createdBy.fullName}
                  </p>
                  {d.notes && <p className="mt-0.5 text-xs text-slate-500">{d.notes}</p>}
                </div>
                {canManage && (
                  <button className="shrink-0 text-xs text-slate-400 hover:text-red-600" disabled={busy} onClick={() => onDelete(d.id)}>
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {canManage && (
        <div className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Add a date</h2>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="e.g. Rehearsal, Deadline" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <input className="input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex justify-end">
            <button
              className="btn-primary"
              disabled={busy || !title.trim() || !date}
              onClick={() => {
                onAdd(title.trim(), date, notes.trim() || null);
                setTitle("");
                setDate("");
                setNotes("");
              }}
            >
              Add date
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
