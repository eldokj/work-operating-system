// Renders the full assignment/acknowledgement lineage (doc 06 §6.2) — origin, each hop,
// who assigned it, who responded, and the outcome. Oldest first.

interface PersonRef {
  id: string;
  fullName: string;
}
interface AssignmentRow {
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

const STATUS_LABEL: Record<string, string> = {
  PENDING_ACKNOWLEDGEMENT: "Pending acknowledgement",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  SUPERSEDED: "Superseded",
};

export function AssignmentChain({ assignments }: { assignments: AssignmentRow[] }) {
  if (assignments.length === 0) {
    return <p className="text-sm text-slate-400">Not yet assigned.</p>;
  }

  return (
    <ol className="space-y-3 border-l-2 border-slate-100 pl-4">
      {assignments.map((a) => {
        const target = a.assigneeType === "TEAM" ? `${a.assigneeTeam?.name} (Team)` : a.assigneeUser?.fullName;
        return (
          <li key={a.id} className="relative text-sm">
            <span
              className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${
                a.isCurrent ? "bg-brand-600" : "bg-slate-300"
              }`}
            />
            <p className="text-slate-700">
              <span className="font-medium">{a.assignedBy.fullName}</span> assigned to{" "}
              <span className="font-medium">{target}</span>
            </p>
            <p className="text-xs text-slate-400">
              {new Date(a.createdAt).toLocaleString()} · {STATUS_LABEL[a.status] ?? a.status}
              {a.respondedBy && ` by ${a.respondedBy.fullName}`}
            </p>
            {a.declineReason && <p className="text-xs italic text-red-500">&ldquo;{a.declineReason}&rdquo;</p>}
          </li>
        );
      })}
    </ol>
  );
}
