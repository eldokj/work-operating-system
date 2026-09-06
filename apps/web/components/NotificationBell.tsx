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
  createdAt: string;
}

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const res = await api.get<{ items: Notification[] }>("/api/v1/notifications?limit=8");
      setItems(res.items);
    } catch {
      // silently ignore — the bell just stays empty
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  const unreadCount = items.filter((n) => !n.isRead).length;

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn-ghost relative">
        🔔
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 text-sm font-medium text-slate-700">
            Notifications
            <Link href="/notifications" className="text-xs font-normal text-brand-600 hover:underline" onClick={() => setOpen(false)}>
              View all
            </Link>
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-400">No notifications yet.</p>
          ) : (
            items.map((n) => (
              <div key={n.id} className={`px-3 py-2 text-sm ${n.isRead ? "text-slate-500" : "text-slate-800"}`}>
                {describeNotification(n.type, n.payload)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
