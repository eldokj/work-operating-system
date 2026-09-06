"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  source: string;
  createdAt: string;
  actor: { fullName: string; email: string };
}

export default function AuditHistoryPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: AuditEntry[] }>(`/api/v1/organizations/${orgId}/audit-logs?limit=100`)
      .then((r) => setEntries(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load audit log"));
  }, [orgId]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Audit history</h1>
      {error && <p className="text-red-600">{error}</p>}
      <div className="card divide-y divide-slate-100">
        {entries.length === 0 && !error && <p className="p-4 text-sm text-slate-400">No activity recorded yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className="p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-800">{e.action}</span>
              <span className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
            <p className="text-xs text-slate-500">
              {e.actor.fullName} · {e.entityType} #{e.entityId.slice(0, 8)} · via {e.source}
            </p>
            {e.reason && <p className="mt-1 text-xs italic text-slate-500">&ldquo;{e.reason}&rdquo;</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
