"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { AttachmentChip, type AttachmentSummary } from "./AttachmentChip";

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
  attachments: AttachmentSummary[];
}

const QUICK_EMOJIS = ["👍", "❤️", "🎉", "😂", "👀"];

/** Task-scoped and project-scoped conversations use the exact same message model and UI —
 * only the base URL differs (doc 17 §11, mirroring ConversationService's own
 * generalization). `uploadPath` differs from `conversation`'s base because the file-upload
 * route is named differently for a project (`/files`) than a task (`/attachments`) — see
 * doc 17 §16's API contract. */
export type ConversationScope =
  | { kind: "TASK"; id: string }
  | { kind: "PROJECT"; id: string };

function scopeUrls(scope: ConversationScope) {
  const base = scope.kind === "TASK" ? `/api/v1/tasks/${scope.id}` : `/api/v1/projects/${scope.id}`;
  return {
    conversation: `${base}/conversation`,
    upload: scope.kind === "TASK" ? `${base}/attachments` : `${base}/files`,
  };
}

export function ConversationTab({
  scope,
  currentUserId,
  mentionCandidates,
  onActivity,
}: {
  scope: ConversationScope;
  currentUserId: string;
  mentionCandidates: PersonRef[];
  /** Called after any mutation, so the parent can refresh e.g. the Activity tab / unread badge. */
  onActivity?: () => void;
}) {
  const urls = scopeUrls(scope);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<PersonRef[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const res = await api.get<{ items: Message[] }>(`${urls.conversation}/messages?limit=50`);
      setMessages(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load conversation");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    api.post(`${urls.conversation}/read`).then(() => onActivity?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.kind, scope.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function send() {
    if (!body.trim() && pendingFiles.length === 0) return;
    setError(null);
    try {
      let attachmentIds: string[] = [];
      if (pendingFiles.length > 0) {
        setUploading(true);
        const uploaded = await api.uploadFiles<Array<{ id: string }>>(urls.upload, pendingFiles);
        attachmentIds = uploaded.map((a) => a.id);
      }
      await api.post(`${urls.conversation}/messages`, {
        body: body.trim() || undefined,
        parentMessageId: replyingTo?.id ?? null,
        mentionedUserIds: selectedMentions.map((m) => m.id),
        attachmentIds,
      });
      setBody("");
      setPendingFiles([]);
      setReplyingTo(null);
      setSelectedMentions([]);
      setMentionPickerOpen(false);
      await load();
      onActivity?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send message");
    } finally {
      setUploading(false);
    }
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    setPendingFiles((prev) => [...prev, ...Array.from(fileList)]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
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

                {!m.isDeleted && m.attachments.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {m.attachments.map((a) => (
                      <AttachmentChip key={a.id} attachment={a} compact />
                    ))}
                  </div>
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
            {mentionCandidates.length === 0 && (
              <span className="text-xs text-slate-400">
                No one else has access to this {scope.kind === "TASK" ? "task" : "project"} yet.
              </span>
            )}
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
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 rounded bg-slate-50 p-2">
            {pendingFiles.map((file, i) => (
              <span key={`${file.name}-${i}`} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-2.5 pr-1 text-xs text-slate-600">
                {file.name}
                <button
                  onClick={() => removePendingFile(i)}
                  disabled={uploading}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  title="Remove"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <div className="flex gap-2">
          <button className="btn-secondary shrink-0" onClick={() => setMentionPickerOpen((o) => !o)} title="Mention someone">
            @
          </button>
          <button
            className="btn-secondary shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Attach files"
          >
            📎
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
          <button className="btn-primary shrink-0" disabled={(!body.trim() && pendingFiles.length === 0) || uploading} onClick={send}>
            {uploading ? "Uploading…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
