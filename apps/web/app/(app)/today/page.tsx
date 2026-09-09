"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/workspace-context";
import { api, ApiError } from "@/lib/api-client";
import { StatusBadge, PriorityBadge } from "@/components/TaskCard";

interface TaskRef {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  project: { id: string; name: string; kind: "PROJECT" | "EVENT" } | null;
}
interface DailyPlanItem {
  id: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED_TODAY" | "CARRIED_FORWARD" | "MOVED_TO_BACKLOG" | "DROPPED_FOR_TODAY";
  position: number;
  isUnplanned: boolean;
  plannedDurationMinutes: number | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  completedAt: string | null;
  carriedFromItemId: string | null;
  task: TaskRef;
  ownershipLost: boolean;
  // Phase 8 — docs/architecture/28-phase8-task-dependencies-architecture-report.md §8.
  // Advisory only — this item can still be planned/started freely; the flag is purely a
  // visual signal, never an enforcement gate (doc 28's central resolution of doc 27 §11's
  // open question).
  isBlocked: boolean;
}
interface WorkdaySummary {
  workDate: string;
  status: "NOT_STARTED" | "OPEN" | "CLOSED";
  id: string | null;
  startedAt: string | null;
  closedAt: string | null;
  reflectionNote: string | null;
  capacityMinutes: number;
  // Phase 7 — docs/architecture/26-phase7-calendar-meeting-architecture-report.md §10.
  meetingMinutes: number;
  plannedMinutes: number;
  availableMinutes: number;
}
interface InboxTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
}

// Phase 7 — the Today page's merged day timeline (doc 26 §17/§18/§19). A read-only
// projection over CalendarEvent + scheduled DailyPlanItem, never a third source of truth.
interface TimelineEventSummary {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  location: string | null;
  meetingLink: string | null;
  organizerId: string;
}
interface TimelineTaskSummary {
  id: string;
  task: { id: string; title: string; status: string; priority: string };
}
interface DayTimelineItem {
  type: "EVENT" | "TASK";
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  hasConflict: boolean;
  event: TimelineEventSummary | null;
  task: TimelineTaskSummary | null;
}
interface DayTimeline {
  date: string;
  items: DayTimelineItem[];
  unscheduledTaskCount: number;
}

const UNRESOLVED_STATUSES = ["PLANNED", "IN_PROGRESS"];
const TERMINAL_TASK_STATUSES = ["COMPLETED", "CANCELLED"];

type Tab = "Plan" | "Work" | "Close";

/** Today — Phase 3 Daily Work Cycle (doc 19). One cohesive screen (Plan/Work/Close as
 * sections, matching the tab pattern task/project detail already established) sitting
 * above the existing work graph — never a second task system. */
export default function TodayPage() {
  const { currentWorkspaceId, loading: wsLoading } = useWorkspace();
  const router = useRouter();

  const [workday, setWorkday] = useState<WorkdaySummary | null>(null);
  const [items, setItems] = useState<DailyPlanItem[]>([]);
  const [inbox, setInbox] = useState<InboxTask[]>([]);
  const [yesterday, setYesterday] = useState<WorkdaySummary | null>(null);
  const [timeline, setTimeline] = useState<DayTimeline | null>(null);
  const [tab, setTab] = useState<Tab>("Plan");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!currentWorkspaceId) return;
    try {
      const w = await api.post<WorkdaySummary>("/api/v1/me/workday/start");
      setWorkday(w);
      const [itemList, inboxList] = await Promise.all([
        api.get<DailyPlanItem[]>("/api/v1/me/workday/items"),
        api.get<InboxTask[]>(`/api/v1/me/workday/inbox?workspaceId=${currentWorkspaceId}`),
      ]);
      setItems(itemList);
      setInbox(inboxList);

      // Yesterday's unclosed day (doc 19 §5) — a lightweight, non-blocking extra read.
      const y = new Date(`${w.workDate}T00:00:00.000Z`);
      y.setUTCDate(y.getUTCDate() - 1);
      const yStr = y.toISOString().slice(0, 10);
      api
        .get<WorkdaySummary>(`/api/v1/me/workday?date=${yStr}`)
        .then((yw) => setYesterday(yw.status === "OPEN" ? yw : null))
        .catch(() => setYesterday(null));

      // Phase 7 — the merged day timeline (doc 26 §17/§18). Non-blocking, same as
      // yesterday's read above: a calendar hiccup must never break the rest of Today.
      api
        .get<DayTimeline>(`/api/v1/calendar/day?workspaceId=${currentWorkspaceId}&date=${w.workDate}`)
        .then(setTimeline)
        .catch(() => setTimeline(null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load today");
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (wsLoading || !workday) return <div className="text-slate-400">Loading…</div>;

  const activeItems = items.filter((i) => UNRESOLVED_STATUSES.includes(i.status)).sort((a, b) => a.position - b.position);
  // "Requires a Close disposition" (doc 19 §8): still PLANNED/IN_PROGRESS AND the
  // underlying task hasn't already resolved itself outside the daily-plan layer.
  const unresolvedForClose = items.filter(
    (i) => UNRESOLVED_STATUSES.includes(i.status) && !TERMINAL_TASK_STATUSES.includes(i.task.status)
  );
  // Everything else is already resolved — either a terminal DailyPlanItem status, or the
  // task completed/cancelled itself (auto-exempted, doc 19 §8/§14).
  const resolvedItems = items.filter((i) => !unresolvedForClose.includes(i));
  const overCapacity = workday.plannedMinutes > workday.capacityMinutes && workday.capacityMinutes > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Today</h1>
        <span className="text-sm text-slate-500">{new Date(`${workday.workDate}T00:00:00.000Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
      </div>

      {yesterday && (
        <div className="card border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Yesterday wasn&rsquo;t closed out.{" "}
          <Link href={`/today?date=${yesterday.workDate}`} className="underline">
            Review it
          </Link>{" "}
          when you get a chance — nothing was lost, it&rsquo;s just still open.
        </div>
      )}

      <div className="card space-y-2 p-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {workday.plannedMinutes} / {workday.capacityMinutes} min planned
            {/* Phase 7 — doc 26 §10: capacity now accounts for meeting time, not just
               planned task time, so this number stops being fictional on meeting-heavy
               days. */}
            {workday.meetingMinutes > 0 && <span className="text-slate-400"> · {workday.meetingMinutes} min in meetings</span>}
          </span>
          {overCapacity && <span className="font-medium text-amber-700">Over capacity</span>}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${overCapacity ? "bg-amber-500" : "bg-brand-500"}`}
            style={{ width: `${workday.capacityMinutes > 0 ? Math.min(100, (workday.plannedMinutes / workday.capacityMinutes) * 100) : 0}%` }}
          />
        </div>
        {workday.capacityMinutes > 0 && (
          <p className="text-xs text-slate-400">{workday.availableMinutes} min realistically available today</p>
        )}
      </div>

      <DayTimelineCard
        timeline={timeline}
        workspaceId={currentWorkspaceId}
        disabled={workday.status === "CLOSED"}
        onCreated={load}
      />

      <div className="flex gap-1 border-b border-slate-200">
        {(["Plan", "Work", "Close"] as Tab[]).map((t) => (
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

      {error && <p className="text-sm text-red-600">{error}</p>}
      {workday.status === "CLOSED" && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          This day is closed. {workday.reflectionNote && <span className="italic">&ldquo;{workday.reflectionNote}&rdquo;</span>}
        </p>
      )}

      {tab === "Plan" && (
        <PlanTab
          items={items}
          inbox={inbox}
          busy={busy}
          disabled={workday.status === "CLOSED"}
          onAdd={(taskId, isUnplanned) => run(() => api.post("/api/v1/me/workday/items", { taskId, isUnplanned }))}
          onQuickAdd={(title) =>
            run(async () => {
              if (!currentWorkspaceId) return;
              const task = await api.post<{ id: string }>("/api/v1/tasks", { workspaceId: currentWorkspaceId, title });
              await api.post("/api/v1/me/workday/items", { taskId: task.id, isUnplanned: true });
            })
          }
          onRemove={(itemId) => run(() => api.delete(`/api/v1/workday-items/${itemId}`))}
          onReorder={(itemId, position) => run(() => api.patch(`/api/v1/workday-items/${itemId}`, { position }))}
          onEstimate={(itemId, minutes) => run(() => api.patch(`/api/v1/workday-items/${itemId}`, { plannedDurationMinutes: minutes }))}
        />
      )}

      {tab === "Work" && (
        <WorkTab
          items={activeItems}
          busy={busy}
          disabled={workday.status === "CLOSED"}
          onStart={(itemId) => run(() => api.post(`/api/v1/workday-items/${itemId}/start`))}
          onComplete={(itemId) => run(() => api.post(`/api/v1/workday-items/${itemId}/complete`))}
          onSubmit={(taskId) => run(() => api.post(`/api/v1/tasks/${taskId}/submit`))}
          onOpenTask={(taskId) => router.push(`/tasks/${taskId}`)}
        />
      )}

      {tab === "Close" && (
        <CloseTab
          unresolved={unresolvedForClose}
          resolved={resolvedItems}
          busy={busy}
          closed={workday.status === "CLOSED"}
          onClose={(dispositions, reflectionNote) => run(() => api.post("/api/v1/me/workday/close", { dispositions, reflectionNote }))}
        />
      )}
    </div>
  );
}

function ItemTaskLine({ task }: { task: TaskRef }) {
  return (
    <div className="min-w-0 flex-1">
      <Link href={`/tasks/${task.id}`} className="truncate text-sm font-medium text-slate-800 hover:underline">
        {task.title}
      </Link>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={task.priority} />
        <StatusBadge status={task.status} />
        {task.project && <span className="badge bg-slate-100 text-slate-500">{task.project.name}</span>}
        {task.dueDate && <span className="text-xs text-slate-400">Due {new Date(task.dueDate).toLocaleDateString()}</span>}
      </div>
    </div>
  );
}

/**
 * Phase 7 — docs/architecture/26-phase7-calendar-meeting-architecture-report.md §17/§19.
 * "What does my day actually look like" (START) — meetings and scheduled task blocks in
 * one chronological list. Read-only display plus a lightweight event-creation form; no
 * drag-and-drop, no month/week grid (doc 26 §19/§23 — Calendar supports Today, it doesn't
 * become a separate destination).
 */
function DayTimelineCard({
  timeline,
  workspaceId,
  disabled,
  onCreated,
}: {
  timeline: DayTimeline | null;
  workspaceId: string | null;
  disabled: boolean;
  onCreated: () => void;
}) {
  const [showForm, setShowForm] = useState(false);

  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Your day</h2>
        {!disabled && workspaceId && (
          <button className="btn-secondary text-xs" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "+ Add meeting"}
          </button>
        )}
      </div>

      {showForm && workspaceId && (
        <NewCalendarEventForm
          workspaceId={workspaceId}
          onDone={() => {
            setShowForm(false);
            onCreated();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {!timeline || timeline.items.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing scheduled to a specific time yet today.</p>
      ) : (
        <div className="space-y-1.5">
          {timeline.items.map((item) => (
            <div
              key={`${item.type}-${item.id}`}
              className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${item.hasConflict ? "border-amber-300 bg-amber-50" : "border-slate-100"}`}
            >
              <span className="w-28 shrink-0 text-xs text-slate-500">
                {fmtTime(item.startAt)} – {fmtTime(item.endAt)}
              </span>
              <span className={`badge shrink-0 ${item.type === "EVENT" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
                {item.type === "EVENT" ? "Meeting" : "Task"}
              </span>
              {item.type === "TASK" && item.task ? (
                <Link href={`/tasks/${item.task.task.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">
                  {item.title}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                  {item.title}
                  {item.event?.location && <span className="ml-1.5 text-xs text-slate-400">@ {item.event.location}</span>}
                </span>
              )}
              {item.hasConflict && <span className="shrink-0 text-xs font-medium text-amber-700">Overlaps</span>}
            </div>
          ))}
        </div>
      )}
      {timeline && timeline.unscheduledTaskCount > 0 && (
        <p className="text-xs text-slate-400">
          {timeline.unscheduledTaskCount} more planned {timeline.unscheduledTaskCount === 1 ? "task has" : "tasks have"} no specific time set —
          see the Plan tab below.
        </p>
      )}
    </div>
  );
}

/** A lightweight, single-workspace-member meeting/time-block form — title/time/location/
 * link only (doc 26 §19/§23: no participant picker in v1's UI, though the backend already
 * supports participants via a separate API call — organizer-only creation still delivers
 * the core capacity-accuracy value on its own). */
function NewCalendarEventForm({ workspaceId, onDone, onCancel }: { workspaceId: string; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [location, setLocation] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!title.trim() || !startLocal || !endLocal) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/v1/calendar/events", {
        workspaceId,
        title: title.trim(),
        startAt: new Date(startLocal).toISOString(),
        endAt: new Date(endLocal).toISOString(),
        location: location.trim() || null,
        meetingLink: meetingLink.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create event");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input className="input" placeholder="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="label text-xs">Start</label>
          <input type="datetime-local" className="input" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="label text-xs">End</label>
          <input type="datetime-local" className="input" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
        </div>
      </div>
      <input className="input" placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
      <input className="input" placeholder="Meeting link (optional)" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button className="btn-secondary text-xs" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary text-xs" disabled={saving || !title.trim() || !startLocal || !endLocal} onClick={submit}>
          Add to my day
        </button>
      </div>
    </div>
  );
}

function PlanTab({
  items,
  inbox,
  busy,
  disabled,
  onAdd,
  onQuickAdd,
  onRemove,
  onReorder,
  onEstimate,
}: {
  items: DailyPlanItem[];
  inbox: InboxTask[];
  busy: boolean;
  disabled: boolean;
  onAdd: (taskId: string, isUnplanned: boolean) => void;
  onQuickAdd: (title: string) => void;
  onRemove: (itemId: string) => void;
  onReorder: (itemId: string, position: number) => void;
  onEstimate: (itemId: string, minutes: number | null) => void;
}) {
  const [quickTitle, setQuickTitle] = useState("");
  const ordered = [...items].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-4">
      <div className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold text-slate-700">Today&rsquo;s plan</h2>
        {ordered.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing planned yet — add something from your Inbox below.</p>
        ) : (
          <div className="space-y-2">
            {ordered.map((item, i) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg border border-slate-100 p-2">
                <div className="flex shrink-0 flex-col">
                  <button
                    disabled={disabled || busy || i === 0}
                    className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    onClick={() => onReorder(item.id, ordered[i - 1]!.position)}
                  >
                    ▲
                  </button>
                  <button
                    disabled={disabled || busy || i === ordered.length - 1}
                    className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    onClick={() => onReorder(item.id, ordered[i + 1]!.position)}
                  >
                    ▼
                  </button>
                </div>
                <ItemTaskLine task={item.task} />
                {item.isUnplanned && <span className="badge shrink-0 bg-amber-50 text-amber-700">Unplanned</span>}
                {item.ownershipLost && <span className="badge shrink-0 bg-red-50 text-red-600">No longer yours</span>}
                {item.isBlocked && <span className="badge shrink-0 bg-red-50 text-red-600">Blocked</span>}
                <input
                  type="number"
                  min={0}
                  className="input w-20 shrink-0 text-xs"
                  placeholder="min"
                  disabled={disabled || busy}
                  defaultValue={item.plannedDurationMinutes ?? ""}
                  onBlur={(e) => onEstimate(item.id, e.target.value ? Number(e.target.value) : null)}
                />
                {item.status === "PLANNED" && !item.startedAt && (
                  <button
                    disabled={disabled || busy}
                    className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                    onClick={() => onRemove(item.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {!disabled && (
        <div className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Quick add (unplanned)</h2>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Something that just came up…"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && quickTitle.trim()) {
                  onQuickAdd(quickTitle.trim());
                  setQuickTitle("");
                }
              }}
            />
            <button
              className="btn-secondary shrink-0"
              disabled={busy || !quickTitle.trim()}
              onClick={() => {
                onQuickAdd(quickTitle.trim());
                setQuickTitle("");
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      <div className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold text-slate-700">Inbox</h2>
        {inbox.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing waiting — everything you own is already on today&rsquo;s plan.</p>
        ) : (
          <div className="space-y-1.5">
            {inbox.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-2">
                <div className="min-w-0 flex-1">
                  <Link href={`/tasks/${t.id}`} className="truncate text-sm font-medium text-slate-800 hover:underline">
                    {t.title}
                  </Link>
                  <div className="mt-0.5 flex gap-1.5">
                    <PriorityBadge priority={t.priority} />
                    <StatusBadge status={t.status} />
                  </div>
                </div>
                {!disabled && (
                  <button className="btn-secondary shrink-0 text-xs" disabled={busy} onClick={() => onAdd(t.id, false)}>
                    + Add to today
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkTab({
  items,
  busy,
  disabled,
  onStart,
  onComplete,
  onSubmit,
  onOpenTask,
}: {
  items: DailyPlanItem[];
  busy: boolean;
  disabled: boolean;
  onStart: (itemId: string) => void;
  onComplete: (itemId: string) => void;
  onSubmit: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const now = items.filter((i) => i.status === "IN_PROGRESS");
  const next = items.filter((i) => i.status === "PLANNED").slice(0, 3);
  const later = items.filter((i) => i.status === "PLANNED").slice(3);

  function Row({ item }: { item: DailyPlanItem }) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-100 p-2">
        <ItemTaskLine task={item.task} />
        {item.status === "PLANNED" && (
          <button className="btn-secondary shrink-0 text-xs" disabled={disabled || busy} onClick={() => onStart(item.id)}>
            Start
          </button>
        )}
        {item.status === "IN_PROGRESS" && (
          <>
            <button className="btn-primary shrink-0 text-xs" disabled={disabled || busy} onClick={() => onComplete(item.id)}>
              Complete
            </button>
            <button className="btn-secondary shrink-0 text-xs" disabled={disabled || busy} onClick={() => onSubmit(item.task.id)}>
              Submit
            </button>
          </>
        )}
        <button className="shrink-0 text-xs text-slate-400 hover:underline" onClick={() => onOpenTask(item.task.id)}>
          Open
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold text-slate-700">Now</h2>
        {now.length === 0 ? <p className="text-sm text-slate-400">Nothing active — start something from Next.</p> : now.map((i) => <Row key={i.id} item={i} />)}
      </div>
      <div className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold text-slate-700">Next</h2>
        {next.length === 0 ? <p className="text-sm text-slate-400">Nothing queued.</p> : <div className="space-y-2">{next.map((i) => <Row key={i.id} item={i} />)}</div>}
      </div>
      {later.length > 0 && (
        <div className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Later</h2>
          <div className="space-y-2">{later.map((i) => <Row key={i.id} item={i} />)}</div>
        </div>
      )}
    </div>
  );
}

type DispositionAction = "CARRY_FORWARD" | "MOVE_TO_BACKLOG" | "DROP" | "COMPLETE";

function CloseTab({
  unresolved,
  resolved,
  busy,
  closed,
  onClose,
}: {
  unresolved: DailyPlanItem[];
  resolved: DailyPlanItem[];
  busy: boolean;
  closed: boolean;
  onClose: (dispositions: Array<{ itemId: string; action: DispositionAction }>, reflectionNote: string | null) => void;
}) {
  const [dispositions, setDispositions] = useState<Record<string, DispositionAction>>({});
  const [reflectionNote, setReflectionNote] = useState("");

  if (closed) {
    return <div className="card p-8 text-center text-slate-400">This day is already closed.</div>;
  }

  const allResolved = unresolved.every((i) => dispositions[i.id]);

  return (
    <div className="space-y-4">
      {unresolved.length === 0 ? (
        <div className="card p-4 text-sm text-slate-500">Everything today is already resolved — you&rsquo;re clear to close.</div>
      ) : (
        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-slate-700">What happens to what&rsquo;s left?</h2>
          {unresolved.map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-lg border border-slate-100 p-2">
              <ItemTaskLine task={item.task} />
              <select
                className="input w-40 shrink-0 text-xs"
                value={dispositions[item.id] ?? ""}
                onChange={(e) => setDispositions((prev) => ({ ...prev, [item.id]: e.target.value as DispositionAction }))}
              >
                <option value="">Choose…</option>
                <option value="COMPLETE">Mark complete</option>
                <option value="CARRY_FORWARD">Carry to tomorrow</option>
                <option value="MOVE_TO_BACKLOG">Back to Inbox</option>
                <option value="DROP">Drop for today</option>
              </select>
            </div>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="card space-y-1.5 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Already resolved</h2>
          {resolved.map((item) => (
            <div key={item.id} className="flex items-center gap-2 text-sm text-slate-500">
              <span className="badge bg-slate-100">{item.status.replace(/_/g, " ")}</span>
              <span className="truncate">{item.task.title}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card space-y-2 p-4">
        <label className="label">Reflection (optional)</label>
        <textarea
          className="input"
          rows={3}
          placeholder="How did today go?"
          value={reflectionNote}
          onChange={(e) => setReflectionNote(e.target.value)}
        />
        <div className="flex justify-end">
          <button
            className="btn-primary"
            disabled={busy || !allResolved}
            onClick={() =>
              onClose(
                unresolved.map((i) => ({ itemId: i.id, action: dispositions[i.id]! })),
                reflectionNote.trim() || null
              )
            }
          >
            Close day
          </button>
        </div>
      </div>
    </div>
  );
}
