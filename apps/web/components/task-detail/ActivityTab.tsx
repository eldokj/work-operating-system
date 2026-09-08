"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { AssignmentChain } from "@/components/AssignmentChain";
import type { ConversationScope } from "./ConversationTab";

interface AssignmentRow {
  id: string;
  assigneeType: "USER" | "TEAM";
  assigneeUser: { id: string; fullName: string } | null;
  assigneeTeam: { id: string; name: string } | null;
  assignedBy: { id: string; fullName: string };
  respondedBy: { id: string; fullName: string } | null;
  status: string;
  isCurrent: boolean;
  declineReason: string | null;
  createdAt: string;
}
interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  reason: string | null;
  createdAt: string;
  actor: { fullName: string; email: string };
}

const ACTION_LABEL: Record<string, string> = {
  "task.created": "created the task",
  "task.updated": "updated the task",
  "task.cancelled": "cancelled the task",
  "task.submitted": "submitted the task for review",
  "task.approved": "approved the task",
  "task.changes_requested": "requested changes",
  "task.checklist_item_added": "added a checklist item",
  "task.checklist_item_updated": "updated a checklist item",
  "task.checklist_item_deleted": "removed a checklist item",
  "task.comment_added": "commented",
  "task.progress_update_added": "posted a progress update",
  "task.assignment.created": "assigned the task",
  "task.assignment.accepted": "accepted the assignment",
  "task.assignment.declined": "declined the assignment",
  "task.assignment.reassigned_internal": "distributed the task internally",
  "task.message_added": "sent a message",
  "task.message_edited": "edited a message",
  "task.message_deleted": "deleted a message",
  "attachment.uploaded": "uploaded a file",
  "attachment.deleted": "deleted a file",
  // Project/Event Workspace — Phase 2C (doc 17 §16). A project has no assignment chain
  // (that stays exactly the task-level TaskAssignment mechanism, doc 17 §7/§10 — untouched
  // here), so these are the only project-specific labels; project.message_* etc. are
  // covered above since Conversation is the same model for both.
  "project.created": "created the project",
  "project.updated": "updated the project",
  "project.archived": "archived the project",
  "project.member_added": "added a member",
  "project.member_removed": "removed a member",
  "project.team_added": "added a team",
  "project.team_removed": "removed a team",
  "project_date.created": "added an important date",
  "project_date.updated": "updated an important date",
  "project_date.deleted": "removed an important date",
};

export function ActivityTab({ scope, assignments }: { scope: ConversationScope; assignments?: AssignmentRow[] }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const path = scope.kind === "TASK" ? `/api/v1/tasks/${scope.id}/activity` : `/api/v1/projects/${scope.id}/activity`;
    api
      .get<{ items: ActivityEntry[] }>(`${path}?limit=100`)
      .then((r) => setEntries(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load activity"));
  }, [scope.kind, scope.id]);

  return (
    <div className="space-y-4">
      {assignments && (
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Assignment history</h2>
          <AssignmentChain assignments={assignments} />
        </div>
      )}

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">System activity</h2>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {entries.length === 0 && !error && <p className="text-sm text-slate-400">No activity recorded yet.</p>}
        <ol className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">{e.actor.fullName}</span>{" "}
              {ACTION_LABEL[e.action] ?? e.action}
              <span className="ml-2 text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
              {e.reason && <span className="block text-xs italic text-slate-500">&ldquo;{e.reason}&rdquo;</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
