"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { describeNotification } from "@/lib/notification-copy";

interface Notification {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  isRead: boolean;
  relatedTaskId: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);

  function load() {
    api.get<{ items: Notification[] }>("/api/v1/notifications?limit=50").then((r) => setItems(r.items));
  }
  useEffect(load, []);

  async function markAllRead() {
    await api.post("/api/v1/notifications/mark-all-read");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Notifications</h1>
        <button className="btn-secondary text-sm" onClick={markAllRead}>
          Mark all read
        </button>
      </div>

      <div className="card divide-y divide-slate-100">
        {items.length === 0 && <p className="p-4 text-sm text-slate-400">You&rsquo;re all caught up.</p>}
        {items.map((n) => {
          const content = (
            <div className={`flex items-center justify-between p-3 text-sm ${n.isRead ? "text-slate-500" : "bg-brand-50/40 text-slate-800"}`}>
              <span>{describeNotification(n.type, n.payload)}</span>
              <span className="shrink-0 text-xs text-slate-400">{new Date(n.createdAt).toLocaleString()}</span>
            </div>
          );
          // Phase 2C (doc 17 §11): a project-scoped conversation notification has no
          // relatedTaskId (that column stays task-only) but carries payload.projectId.
          const projectId = typeof n.payload.projectId === "string" ? n.payload.projectId : null;
          const href = n.relatedTaskId ? `/tasks/${n.relatedTaskId}` : projectId ? `/projects/${projectId}` : null;
          return href ? (
            <Link key={n.id} href={href} onClick={() => api.post(`/api/v1/notifications/${n.id}/read`)}>
              {content}
            </Link>
          ) : (
            <div key={n.id}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
