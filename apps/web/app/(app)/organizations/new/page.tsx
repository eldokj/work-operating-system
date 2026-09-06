"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/workspace-context";
import { api, ApiError } from "@/lib/api-client";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function NewOrganizationPage() {
  const router = useRouter();
  const { refresh, setCurrentWorkspaceId } = useWorkspace();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/v1/organizations", { name: name.trim(), slug: slugify(name) });
      const ws = await api.get<{ organizations: Array<{ id: string; organizationName: string }> }>(
        "/api/v1/workspaces"
      );
      await refresh();
      const created = ws.organizations.find((o) => o.organizationName === name.trim());
      if (created) setCurrentWorkspaceId(created.id);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create organization");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Create an organization</h1>
      <form onSubmit={handleSubmit} className="card space-y-4 p-6">
        <div>
          <label className="label">Organization name</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="ABC College" />
          {name && <p className="mt-1 text-xs text-slate-400">URL: /{slugify(name)}</p>}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={submitting || !name.trim()}>
          {submitting ? "Creating…" : "Create organization"}
        </button>
      </form>
    </div>
  );
}
