"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api-client";

export interface OrgWorkspace {
  id: string;
  type: "ORGANIZATION";
  name: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
}
export interface PersonalWorkspace {
  id: string;
  type: "PERSONAL";
  name: string;
}
export interface WorkspacesResponse {
  personal: PersonalWorkspace | null;
  organizations: OrgWorkspace[];
}
export interface Me {
  id: string;
  email: string;
  fullName: string;
  defaultTimezone: string;
}

interface WorkspaceContextValue {
  me: Me | null;
  workspaces: WorkspacesResponse | null;
  currentWorkspaceId: string | null;
  currentOrg: OrgWorkspace | null;
  setCurrentWorkspaceId: (id: string) => void;
  loading: boolean;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const STORAGE_KEY = "atm_current_workspace";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspacesResponse | null>(null);
  const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [meData, wsData] = await Promise.all([
        api.get<Me>("/api/v1/users/me"),
        api.get<WorkspacesResponse>("/api/v1/workspaces"),
      ]);
      setMe(meData);
      setWorkspaces(wsData);
      setCurrentWorkspaceIdState((prev) => {
        if (prev) return prev;
        const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
        if (stored && (stored === wsData.personal?.id || wsData.organizations.some((w) => w.id === stored))) {
          return stored;
        }
        return wsData.personal?.id ?? wsData.organizations[0]?.id ?? null;
      });
    } catch {
      router.replace("/login");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCurrentWorkspaceId = (id: string) => {
    setCurrentWorkspaceIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  };

  const currentOrg = workspaces?.organizations.find((w) => w.id === currentWorkspaceId) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{ me, workspaces, currentWorkspaceId, currentOrg, setCurrentWorkspaceId, loading, refresh: load }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
