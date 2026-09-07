"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { AssignmentChain } from "@/components/AssignmentChain";

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
};

export function ActivityTab({ taskId, assignments }: { taskId: string; assignments: AssignmentRow[] }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: ActivityEntry[] }>(`/api/v1/tasks/${taskId}/activity?limit=100`)
      .then((r) => setEntries(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load activity"));
  }, [taskId]);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Assignment history</h2>
        <AssignmentChain assignments={assignments} />
      </div>

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
