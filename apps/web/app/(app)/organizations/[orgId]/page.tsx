"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";

interface Department {
  id: string;
  name: string;
  parentDepartmentId: string | null;
}
interface Member {
  user: { id: string; fullName: string; email: string };
  status: string;
}
interface Role {
  id: string;
  name: string;
  isSystem: boolean;
  rolePermissions: Array<{ permission: { key: string } }>;
}
interface AttentionRequired {
  stuckAcknowledgementCount: number;
  overCapacityCount: number;
  carryForwardRepeatCount: number;
  unplannedCount: number;
}
interface OverviewData {
  totalTasks: number;
  overdue: unknown[];
  pendingReview: unknown[];
  completed: unknown[];
  departmentPerformance: Array<{
    department: { id: string; name: string };
    totalTasks: number;
    completed: number;
    overdue: number;
    stuckAcknowledgementCount: number;
  }>;
  teamPerformance: Array<{
    team: { id: string; name: string };
    totalTasks: number;
    completed: number;
    overdue: number;
    stuckAcknowledgementCount: number;
  }>;
  // Phase 4 — docs/architecture/21-phase4-management-visibility-architecture-report.md.
  // A small, fixed set of org-wide totals — never a full BI breakdown (doc 21 §12/§22).
  attentionRequired: AttentionRequired;
}

const TABS = ["Overview", "Departments", "Members", "Roles"] as const;
type Tab = (typeof TABS)[number];

export default function OrganizationPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [tab, setTab] = useState<Tab>("Overview");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Organization</h1>
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab orgId={orgId} />}
      {tab === "Departments" && <DepartmentsTab orgId={orgId} />}
      {tab === "Members" && <MembersTab orgId={orgId} />}
      {tab === "Roles" && <RolesTab orgId={orgId} />}
    </div>
  );
}

function OverviewTab({ orgId }: { orgId: string }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<OverviewData>(`/api/v1/organizations/${orgId}/reports/overview`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load"));
  }, [orgId]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-slate-400">Loading…</p>;

  const attention = data.attentionRequired;
  const attentionTotal =
    attention.stuckAcknowledgementCount + attention.overCapacityCount + attention.carryForwardRepeatCount + attention.unplannedCount;

  return (
    <div className="space-y-4">
      {attentionTotal > 0 && (
        <div className="card space-y-2 border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-800">Attention required</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Stuck in acknowledgement", value: attention.stuckAcknowledgementCount },
              { label: "Over capacity today", value: attention.overCapacityCount },
              { label: "Repeatedly carried forward", value: attention.carryForwardRepeatCount },
              { label: "Unplanned items today", value: attention.unplannedCount },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-lg font-semibold text-amber-900">{s.value}</p>
                <p className="text-xs text-amber-700">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total tasks", value: data.totalTasks },
          { label: "Overdue", value: data.overdue.length },
          { label: "Pending review", value: data.pendingReview.length },
          { label: "Completed", value: data.completed.length },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-2xl font-semibold text-slate-900">{s.value}</p>
            <p className="text-sm text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Department performance</h2>
        <PerformanceTable rows={data.departmentPerformance.map((d) => ({ name: d.department.name, ...d }))} />
      </div>
      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Team performance</h2>
        <PerformanceTable rows={data.teamPerformance.map((t) => ({ name: t.team.name, ...t }))} />
      </div>
    </div>
  );
}

function PerformanceTable({
  rows,
}: {
  rows: Array<{ name: string; totalTasks: number; completed: number; overdue: number; stuckAcknowledgementCount: number }>;
}) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">No data yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="py-1 font-medium">Name</th>
          <th className="py-1 font-medium">Total</th>
          <th className="py-1 font-medium">Completed</th>
          <th className="py-1 font-medium">Overdue</th>
          <th className="py-1 font-medium">Stuck</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-t border-slate-100">
            <td className="py-1.5 text-slate-700">{r.name}</td>
            <td className="py-1.5 text-slate-600">{r.totalTasks}</td>
            <td className="py-1.5 text-slate-600">{r.completed}</td>
            <td className="py-1.5 text-slate-600">{r.overdue}</td>
            <td className={`py-1.5 ${r.stuckAcknowledgementCount > 0 ? "font-medium text-amber-700" : "text-slate-600"}`}>
              {r.stuckAcknowledgementCount}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DepartmentsTab({ orgId }: { orgId: string }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Department[]>(`/api/v1/organizations/${orgId}/departments`).then(setDepartments).catch(() => {});
  }
  useEffect(load, [orgId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/api/v1/organizations/${orgId}/departments`, { name: name.trim() });
      setName("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="flex gap-2">
        <input className="input" placeholder="New department name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary shrink-0" disabled={!name.trim()}>
          Add department
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="card divide-y divide-slate-100">
        {departments.length === 0 && <p className="p-4 text-sm text-slate-400">No departments yet.</p>}
        {departments.map((d) => (
          <div key={d.id} className="p-3 text-sm text-slate-700">
            {d.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function MembersTab({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Member[]>(`/api/v1/organizations/${orgId}/members`).then(setMembers).catch(() => {});
  }
  useEffect(load, [orgId]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/api/v1/organizations/${orgId}/members`, { email: email.trim() });
      setEmail("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={invite} className="flex gap-2">
        <input
          className="input"
          type="email"
          placeholder="Add existing user by email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn-primary shrink-0" disabled={!email.trim()}>
          Add member
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="card divide-y divide-slate-100">
        {members.map((m) => (
          <div key={m.user.id} className="flex items-center justify-between p-3 text-sm">
            <div>
              <p className="font-medium text-slate-800">{m.user.fullName}</p>
              <p className="text-xs text-slate-400">{m.user.email}</p>
            </div>
            <span className="badge bg-slate-100 text-slate-600">{m.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RolesTab({ orgId }: { orgId: string }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantRoleId, setGrantRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function load() {
    api.get<Role[]>(`/api/v1/organizations/${orgId}/roles`).then(setRoles).catch(() => {});
    api.get<Member[]>(`/api/v1/organizations/${orgId}/members`).then(setMembers).catch(() => {});
  }
  useEffect(load, [orgId]);

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/api/v1/organizations/${orgId}/role-grants`, {
        userId: grantUserId,
        roleId: grantRoleId,
        scopeType: "ORGANIZATION",
      });
      setSuccess("Role granted (organization-wide).");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Grant an organization-wide role</h2>
        <p className="mb-3 text-xs text-slate-400">
          For team- or department-scoped grants (e.g. Team Head), use the Teams page instead.
        </p>
        <form onSubmit={grant} className="flex flex-wrap gap-2">
          <select className="input" value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)}>
            <option value="">Select a member…</option>
            {members.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {m.user.fullName}
              </option>
            ))}
          </select>
          <select className="input" value={grantRoleId} onChange={(e) => setGrantRoleId(e.target.value)}>
            <option value="">Select a role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button className="btn-primary" disabled={!grantUserId || !grantRoleId}>
            Grant
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {success && <p className="mt-2 text-sm text-emerald-600">{success}</p>}
      </div>

      <div className="card divide-y divide-slate-100">
        {roles.map((r) => (
          <div key={r.id} className="p-3 text-sm">
            <p className="font-medium text-slate-800">
              {r.name} {r.isSystem && <span className="badge ml-1 bg-slate-100 text-slate-500">system</span>}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {r.rolePermissions.map((rp) => rp.permission.key).join(", ")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
