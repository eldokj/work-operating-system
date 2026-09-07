"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";

interface PersonRef {
  id: string;
  fullName: string;
  email: string;
}
interface Reaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  users: Array<{ id: string; fullName: string }>;
}
interface Message {
  id: string;
  body: string | null;
  isDeleted: boolean;
  isEdited: boolean;
  editedAt: string | null;
  createdAt: string;
  sender: PersonRef;
  parentMessage: { id: string; body: string | null; isDeleted: boolean; sender: PersonRef } | null;
  mentions: PersonRef[];
  reactions: Reaction[];
}

const QUICK_EMOJIS = ["👍", "❤️", "🎉", "😂", "👀"];

export function ConversationTab({
  taskId,
  currentUserId,
  mentionCandidates,
  onActivity,
}: {
  taskId: string;
  currentUserId: string;
  mentionCandidates: PersonRef[];
  /** Called after any mutation, so the parent can refresh e.g. the Activity tab / unread badge. */
  onActivity?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<PersonRef[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await api.get<{ items: Message[] }>(`/api/v1/tasks/${taskId}/conversation/messages?limit=50`);
      setMessages(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load conversation");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    api.post(`/api/v1/tasks/${taskId}/conversation/read`).then(() => onActivity?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function send() {
    if (!body.trim()) return;
    try {
      await api.post(`/api/v1/tasks/${taskId}/conversation/messages`, {
        body: body.trim(),
        parentMessageId: replyingTo?.id ?? null,
        mentionedUserIds: selectedMentions.map((m) => m.id),
      });
      setBody("");
      setReplyingTo(null);
      setSelectedMentions([]);
      setMentionPickerOpen(false);
      await load();
      onActivity?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send message");
    }
  }

  async function saveEdit(messageId: string) {
    if (!editBody.trim()) return;
    try {
      await api.patch(`/api/v1/messages/${messageId}`, { body: editBody.trim() });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not edit message");
    }
  }

  async function remove(messageId: string) {
    try {
      await api.delete(`/api/v1/messages/${messageId}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete message");
    }
  }

  async function toggleReaction(message: Message, emoji: string) {
    const existing = message.reactions.find((r) => r.emoji === emoji);
    try {
      if (existing?.reactedByMe) {
        await api.delete(`/api/v1/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`);
      } else {
        await api.post(`/api/v1/messages/${message.id}/reactions`, { emoji });
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not react");
    }
  }

  function toggleMention(person: PersonRef) {
    setSelectedMentions((prev) =>
      prev.some((p) => p.id === person.id) ? prev.filter((p) => p.id !== person.id) : [...prev, person]
    );
  }

  if (loading) return <p className="text-sm text-slate-400">Loading conversation…</p>;

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card max-h-[28rem] space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && <p className="text-sm text-slate-400">No messages yet — start the conversation.</p>}
        {messages.map((m) => (
          <div key={m.id} className="group text-sm">
            {m.parentMessage && (
              <div className="mb-1 ml-8 truncate rounded border-l-2 border-slate-200 pl-2 text-xs text-slate-400">
                Replying to {m.parentMessage.sender.fullName}: {m.parentMessage.isDeleted ? "(deleted)" : m.parentMessage.body}
              </div>
            )}
            <div className="flex items-start gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-600">
                {m.sender.fullName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-slate-800">{m.sender.fullName}</span>
                  <span className="text-xs text-slate-400">{new Date(m.createdAt).toLocaleString()}</span>
                  {m.isEdited && <span className="text-xs text-slate-400">(edited)</span>}
                </div>

                {editingId === m.id ? (
                  <div className="mt-1 flex gap-2">
                    <input className="input" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                    <button className="btn-secondary shrink-0" onClick={() => saveEdit(m.id)}>
                      Save
                    </button>
                    <button className="btn-ghost shrink-0" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className={m.isDeleted ? "italic text-slate-400" : "text-slate-700"}>
                    {m.isDeleted ? "Message deleted" : m.body}
                  </p>
                )}

                {m.mentions.length > 0 && (
                  <p className="text-xs text-brand-600">Mentioned: {m.mentions.map((p) => p.fullName).join(", ")}</p>
                )}

                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {m.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      onClick={() => toggleReaction(m, r.emoji)}
                      className={`rounded-full border px-1.5 py-0.5 text-xs ${
                        r.reactedByMe ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"
                      }`}
                      title={r.users.map((u) => u.fullName).join(", ")}
                    >
                      {r.emoji} {r.count}
                    </button>
                  ))}
                  {!m.isDeleted && (
                    <div className="hidden gap-1 group-hover:flex">
                      {QUICK_EMOJIS.map((emoji) => (
                        <button key={emoji} className="text-xs opacity-60 hover:opacity-100" onClick={() => toggleReaction(m, emoji)}>
                          {emoji}
                        </button>
                      ))}
                      <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setReplyingTo(m)}>
                        Reply
                      </button>
                      {m.sender.id === currentUserId && (
                        <>
                          <button
                            className="text-xs text-slate-400 hover:text-slate-600"
                            onClick={() => {
                              setEditingId(m.id);
                              setEditBody(m.body ?? "");
                            }}
                          >
                            Edit
                          </button>
                          <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => remove(m.id)}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="card space-y-2 p-3">
        {replyingTo && (
          <div className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs text-slate-500">
            <span>
              Replying to {replyingTo.sender.fullName}: {replyingTo.isDeleted ? "(deleted)" : replyingTo.body}
            </span>
            <button onClick={() => setReplyingTo(null)}>✕</button>
          </div>
        )}
        {mentionPickerOpen && (
          <div className="flex flex-wrap gap-2 rounded bg-slate-50 p-2">
            {mentionCandidates.length === 0 && <span className="text-xs text-slate-400">No one else has access to this task yet.</span>}
            {mentionCandidates.map((p) => (
              <button
                key={p.id}
                onClick={() => toggleMention(p)}
                className={`badge ${selectedMentions.some((s) => s.id === p.id) ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600"}`}
              >
                @{p.fullName}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button className="btn-secondary shrink-0" onClick={() => setMentionPickerOpen((o) => !o)} title="Mention someone">
            @
          </button>
          <input
            className="input"
            placeholder="Write a message…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn-primary shrink-0" disabled={!body.trim()} onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
