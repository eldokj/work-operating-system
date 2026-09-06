import Link from "next/link";

export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  UNASSIGNED: "bg-slate-100 text-slate-600",
  ASSIGNED: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  SUBMITTED: "bg-purple-100 text-purple-700",
  UNDER_REVIEW: "bg-purple-100 text-purple-700",
  CHANGES_REQUESTED: "bg-orange-100 text-orange-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-slate-100 text-slate-400 line-through",
};

const PRIORITY_STYLES: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-500",
  MEDIUM: "bg-blue-50 text-blue-600",
  HIGH: "bg-amber-50 text-amber-700",
  URGENT: "bg-red-50 text-red-700",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>{status.replace(/_/g, " ")}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`badge ${PRIORITY_STYLES[priority] ?? "bg-slate-100"}`}>{priority}</span>;
}

export function TaskCard({ task }: { task: TaskSummary }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 hover:border-slate-200 hover:bg-slate-50"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
        {task.dueDate && (
          <p className="text-xs text-slate-400">Due {new Date(task.dueDate).toLocaleDateString()}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={task.status} />
      </div>
    </Link>
  );
}
