"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/workspace-context";
import { api, ApiError } from "@/lib/api-client";
import { StatusBadge, PriorityBadge } from "@/components/TaskCard";
import { AssignmentChain } from "@/components/AssignmentChain";

interface PersonRef {
  id: string;
  fullName: string;
  email: string;
}
interface Assignment {
  id: string;
  assigneeType: "USER" | "TEAM";
  assigneeUser: PersonRef | null;
  assigneeTeam: { id: string; name: string } | null;
  assignedBy: PersonRef;
  respondedBy: PersonRef | null;
  status: string;
  isCurrent: boolean;
  declineReason: string | null;
  createdAt: string;
}
interface ChecklistItem {
  id: string;
  label: string;
  isDone: boolean;
}
interface TaskDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  createdBy: PersonRef;
  originOrganization: { id: string; name: string } | null;
  originDepartment: { id: string; name: string } | null;
  originTeam: { id: string; name: string } | null;
  originAssignor: PersonRef | null;
  checklistItems: ChecklistItem[];
  assignments: Assignment[];
  workspace: { type: "PERSONAL" | "ORGANIZATION"; organizationId: string | null };
}
interface Comment {
  id: string;
  body: string;
  createdAt: string;
  user: PersonRef;
}
interface Team {
  id: string;
  name: string;
  members: Array<{ userId: string; isHead: boolean }>;
}
interface Member {
  user: PersonRef;
}

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();
  const { me, currentOrg } = useWorkspace();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([
        api.get<TaskDetail>(`/api/v1/tasks/${taskId}`),
        api.get<Comment[]>(`/api/v1/tasks/${taskId}/comments`),
      ]);
      setTask(t);
      setComments(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load task");
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!currentOrg) return;
    api.get<Team[]>(`/api/v1/organizations/${currentOrg.organizationId}/teams`).then(setTeams).catch(() => {});
    api.get<Member[]>(`/api/v1/organizations/${currentOrg.organizationId}/members`).then(setMembers).catch(() => {});
  }, [currentOrg]);

  if (error) return <div className="text-red-600">{error}</div>;
  if (!task || !me) return <div className="text-slate-400">Loading…</div>;

  const current = task.assignments.find((a) => a.isCurrent) ?? null;
  const isCurrentIndividualAssignee = current?.assigneeType === "USER" && current.assigneeUser?.id === me.id;
  const currentTeam = current?.assigneeType === "TEAM" ? teams.find((t) => t.id === current.assigneeTeam?.id) : undefined;
  const isHeadOfCurrentTeam = !!currentTeam?.members.find((m) => m.userId === me.id && m.isHead);
  const isReviewer = !!current && current.assignedBy.id === me.id;
  const isCreatorOrOriginAssignor = task.createdBy.id === me.id || task.originAssignor?.id === me.id;

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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:underline">
        ← Back
      </button>

      <div className="card space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{task.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Created by {task.createdBy.fullName}
              {task.dueDate && <> · Due {new Date(task.dueDate).toLocaleDateString()}</>}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
          </div>
        </div>

        {task.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{task.description}</p>}

        {(task.originOrganization || task.originTeam) && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Origin: {task.originOrganization?.name}
            {task.originDepartment && ` / ${task.originDepartment.name}`}
            {task.originTeam && ` / ${task.originTeam.name}`}
            {task.originAssignor && ` · assigned by ${task.originAssignor.fullName}`}
          </div>
        )}

        {isCreatorOrOriginAssignor && !["COMPLETED", "CANCELLED"].includes(task.status) && (
          <button
            className="btn-danger text-xs"
            disabled={busy}
            onClick={() => run(() => api.delete(`/api/v1/tasks/${task.id}`))}
          >
            Cancel task
          </button>
        )}
      </div>

      {/* Assignment / acknowledgement actions */}
      {current?.status === "PENDING_ACKNOWLEDGEMENT" && (current.assigneeUser?.id === me.id || current.assigneeType === "TEAM") && (
        <AcknowledgementPanel
          assignmentId={current.id}
          isTeam={current.assigneeType === "TEAM"}
          busy={busy}
          onAccept={() => run(() => api.post(`/api/v1/assignments/${current.id}/accept`))}
          onDecline={(reason) => run(() => api.post(`/api/v1/assignments/${current.id}/decline`, { reason }))}
        />
      )}

      {current?.assigneeType === "TEAM" && current.status === "ACCEPTED" && (isHeadOfCurrentTeam || true) && (
        <InternalAssignPanel
          members={members.filter((m) => currentTeam?.members.some((tm) => tm.userId === m.user.id))}
          busy={busy}
          onAssign={(userId) => run(() => api.post(`/api/v1/assignments/${current.id}/reassign-internal`, { assigneeUserId: userId }))}
        />
      )}

      {isCurrentIndividualAssignee && ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(task.status) && (
        <ProgressPanel
          busy={busy}
          onUpdate={(percentage, note) => run(() => api.post(`/api/v1/tasks/${task.id}/updates`, { percentage, note }))}
          onSubmit={() => run(() => api.post(`/api/v1/tasks/${task.id}/submit`))}
        />
      )}

      {isReviewer && ["SUBMITTED", "UNDER_REVIEW"].includes(task.status) && (
        <ReviewPanel
          busy={busy}
          onDecide={(decision, notes) => run(() => api.post(`/api/v1/tasks/${task.id}/reviews`, { decision, notes }))}
        />
      )}

      {task.workspace.type === "ORGANIZATION" && task.status === "UNASSIGNED" && (
        <AssignPanel
          members={members}
          teams={teams}
          busy={busy}
          onAssign={(type, id) => run(() => api.post(`/api/v1/tasks/${task.id}/assignments`, { assigneeType: type, [type === "USER" ? "assigneeUserId" : "assigneeTeamId"]: id }))}
        />
      )}

      {/* Checklist */}
      {task.checklistItems.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Checklist</h2>
          <div className="space-y-1">
            {task.checklistItems.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={item.isDone}
                  onChange={(e) => run(() => api.patch(`/api/v1/checklist-items/${item.id}`, { isDone: e.target.checked }))}
                />
                <span className={item.isDone ? "text-slate-400 line-through" : ""}>{item.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Assignment chain / lineage */}
      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Assignment history</h2>
        <AssignmentChain assignments={task.assignments} />
      </div>

      {/* Comments */}
      <CommentsPanel comments={comments} onAdd={(body) => run(() => api.post(`/api/v1/tasks/${task.id}/comments`, { body }))} />
    </div>
  );
}

function AcknowledgementPanel({
  isTeam,
  busy,
  onAccept,
  onDecline,
}: {
  assignmentId: string;
  isTeam: boolean;
  busy: boolean;
  onAccept: () => void;
  onDecline: (reason: string) => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="card space-y-3 border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-800">
        {isTeam ? "This task was assigned to your team — action needed." : "You have been assigned this task."}
      </p>
      {!declining ? (
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy} onClick={onAccept}>
            Accept
          </button>
          <button className="btn-secondary" disabled={busy} onClick={() => setDeclining(true)}>
            Decline
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            className="input"
            placeholder="A reason is required to decline"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="btn-danger"
              disabled={busy || !reason.trim()}
              onClick={() => onDecline(reason.trim())}
            >
              Confirm decline
            </button>
            <button className="btn-ghost" onClick={() => setDeclining(false)}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function InternalAssignPanel({
  members,
  busy,
  onAssign,
}: {
  members: Member[];
  busy: boolean;
  onAssign: (userId: string) => void;
}) {
  const [userId, setUserId] = useState("");
  return (
    <div className="card space-y-2 p-4">
      <h2 className="text-sm font-semibold text-slate-700">Distribute to a team member</h2>
      <div className="flex gap-2">
        <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Select a member…</option>
          {members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.fullName}
            </option>
          ))}
        </select>
        <button className="btn-primary shrink-0" disabled={busy || !userId} onClick={() => onAssign(userId)}>
          Assign
        </button>
      </div>
    </div>
  );
}

function AssignPanel({
  members,
  teams,
  busy,
  onAssign,
}: {
  members: Member[];
  teams: Team[];
  busy: boolean;
  onAssign: (type: "USER" | "TEAM", id: string) => void;
}) {
  const [type, setType] = useState<"USER" | "TEAM">("USER");
  const [id, setId] = useState("");
  return (
    <div className="card space-y-2 p-4">
      <h2 className="text-sm font-semibold text-slate-700">Assign this task</h2>
      <div className="flex gap-2">
        <select className="input w-32" value={type} onChange={(e) => { setType(e.target.value as "USER" | "TEAM"); setId(""); }}>
          <option value="USER">Individual</option>
          <option value="TEAM">Team</option>
        </select>
        <select className="input" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Select…</option>
          {(type === "USER" ? members.map((m) => ({ id: m.user.id, label: m.user.fullName })) : teams.map((t) => ({ id: t.id, label: t.name }))).map(
            (opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            )
          )}
        </select>
        <button className="btn-primary shrink-0" disabled={busy || !id} onClick={() => onAssign(type, id)}>
          Assign
        </button>
      </div>
    </div>
  );
}

function ProgressPanel({
  busy,
  onUpdate,
  onSubmit,
}: {
  busy: boolean;
  onUpdate: (percentage: number, note: string) => void;
  onSubmit: () => void;
}) {
  const [percentage, setPercentage] = useState(50);
  const [note, setNote] = useState("");
  return (
    <div className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-slate-700">Progress</h2>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          value={percentage}
          onChange={(e) => setPercentage(Number(e.target.value))}
          className="flex-1"
        />
        <span className="w-10 text-sm text-slate-600">{percentage}%</span>
      </div>
      <input className="input" placeholder="What's the update?" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={busy} onClick={() => onUpdate(percentage, note)}>
          Post update
        </button>
        <button className="btn-primary" disabled={busy} onClick={onSubmit}>
          Submit for review
        </button>
      </div>
    </div>
  );
}

function ReviewPanel({ busy, onDecide }: { busy: boolean; onDecide: (decision: "APPROVED" | "CHANGES_REQUESTED", notes: string) => void }) {
  const [notes, setNotes] = useState("");
  return (
    <div className="card space-y-3 border-purple-200 bg-purple-50 p-4">
      <h2 className="text-sm font-semibold text-purple-800">Review submission</h2>
      <textarea className="input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => onDecide("APPROVED", notes)}>
          Approve
        </button>
        <button className="btn-secondary" disabled={busy} onClick={() => onDecide("CHANGES_REQUESTED", notes)}>
          Request changes
        </button>
      </div>
    </div>
  );
}

function CommentsPanel({ comments, onAdd }: { comments: Comment[]; onAdd: (body: string) => void }) {
  const [body, setBody] = useState("");
  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Comments</h2>
      <div className="mb-3 space-y-3">
        {comments.map((c) => (
          <div key={c.id} className="text-sm">
            <span className="font-medium text-slate-800">{c.user.fullName}</span>{" "}
            <span className="text-xs text-slate-400">{new Date(c.createdAt).toLocaleString()}</span>
            <p className="text-slate-600">{c.body}</p>
          </div>
        ))}
        {comments.length === 0 && <p className="text-sm text-slate-400">No comments yet.</p>}
      </div>
      <div className="flex gap-2">
        <input className="input" placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
        <button
          className="btn-secondary shrink-0"
          disabled={!body.trim()}
          onClick={() => {
            onAdd(body.trim());
            setBody("");
          }}
        >
          Post
        </button>
      </div>
    </div>
  );
}
