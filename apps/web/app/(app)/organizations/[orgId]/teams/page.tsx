"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api-client";

interface Department {
  id: string;
  name: string;
}
interface Team {
  id: string;
  name: string;
  departmentId: string | null;
  members: Array<{ userId: string; isHead: boolean }>;
}

export default function TeamsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [teams, setTeams] = useState<Team[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Team[]>(`/api/v1/organizations/${orgId}/teams`).then(setTeams).catch(() => {});
    api.get<Department[]>(`/api/v1/organizations/${orgId}/departments`).then(setDepartments).catch(() => {});
  }
  useEffect(load, [orgId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/api/v1/organizations/${orgId}/teams`, { name: name.trim(), departmentId: departmentId || null });
      setName("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Teams</h1>

      <form onSubmit={create} className="card flex flex-wrap gap-2 p-4">
        <input className="input" placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input w-48" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">No department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button className="btn-primary shrink-0" disabled={!name.trim()}>
          Create team
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {teams.map((t) => (
          <Link key={t.id} href={`/organizations/${orgId}/teams/${t.id}`} className="card p-4 hover:border-slate-300">
            <p className="font-medium text-slate-800">{t.name}</p>
            <p className="text-xs text-slate-400">
              {t.members.length} member{t.members.length === 1 ? "" : "s"}
              {t.members.some((m) => m.isHead) && " · has a Team Head"}
            </p>
          </Link>
        ))}
        {teams.length === 0 && <p className="text-sm text-slate-400">No teams yet.</p>}
      </div>
    </div>
  );
}
