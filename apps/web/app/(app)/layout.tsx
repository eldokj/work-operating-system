"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace-context";
import { api } from "@/lib/api-client";
import { QuickTaskBar } from "@/components/QuickTaskBar";
import { NotificationBell } from "@/components/NotificationBell";

function AppShell({ children }: { children: React.ReactNode }) {
  const { me, workspaces, currentWorkspaceId, currentOrg, setCurrentWorkspaceId, loading } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  async function logout() {
    await api.post("/api/v1/auth/logout");
    router.push("/login");
    router.refresh();
  }

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`rounded-lg px-3 py-2 text-sm font-medium ${
        pathname === href ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-4 sm:flex sm:flex-col">
        <div className="mb-6 px-2 text-lg font-semibold text-slate-900">AI Task Manager</div>

        <div className="relative mb-6">
          <button
            onClick={() => setSwitcherOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
          >
            <span className="truncate font-medium text-slate-700">
              {currentOrg ? currentOrg.organizationName : workspaces?.personal?.name ?? "Personal"}
            </span>
            <span className="text-slate-400">⌄</span>
          </button>
          {switcherOpen && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {workspaces?.personal && (
                <button
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    setCurrentWorkspaceId(workspaces.personal!.id);
                    setSwitcherOpen(false);
                    router.push("/dashboard");
                  }}
                >
                  Personal
                </button>
              )}
              {workspaces?.organizations.map((org) => (
                <button
                  key={org.id}
                  className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    setCurrentWorkspaceId(org.id);
                    setSwitcherOpen(false);
                    router.push("/dashboard");
                  }}
                >
                  {org.organizationName}
                </button>
              ))}
              <div className="my-1 border-t border-slate-100" />
              <Link
                href="/organizations/new"
                className="block px-3 py-2 text-left text-sm text-brand-600 hover:bg-slate-50"
                onClick={() => setSwitcherOpen(false)}
              >
                + New organization
              </Link>
            </div>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {navLink("/today", "Today")}
          {navLink("/dashboard", "Dashboard")}
          {navLink("/tasks", "Tasks")}
          {navLink("/projects", "Projects")}
          {currentOrg && navLink(`/organizations/${currentOrg.organizationId}/teams`, "Teams")}
          {currentOrg && navLink(`/organizations/${currentOrg.organizationId}`, "Organization")}
          {currentOrg && navLink(`/organizations/${currentOrg.organizationId}/audit`, "Audit history")}
          {navLink("/notifications", "Notifications")}
        </nav>

        <div className="mt-auto space-y-1 border-t border-slate-100 pt-3">
          <div className="truncate px-2 text-xs text-slate-400">{me?.email}</div>
          <button onClick={logout} className="btn-ghost w-full justify-start">
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex-1">
            <QuickTaskBar workspaceId={currentWorkspaceId} isOrgWorkspace={!!currentOrg} organizationId={currentOrg?.organizationId ?? null} />
          </div>
          <NotificationBell />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
