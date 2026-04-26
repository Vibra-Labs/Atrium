"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import {
  Trash2,
  Plus,
  MessageSquare,
  Paperclip,
  FileText,
  Download,
  FileCheck,
  Vote,
  Lock,
  Pencil,
} from "lucide-react";
import { linkify } from "@/lib/linkify";
import { Embeds, type PreviewPrefs } from "@/lib/embeds";
import { track } from "@/lib/track";
import { CommentsSection } from "@/components/comments-section";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

interface TimelineEntry {
  id: string;
  kind: "update" | "activity";
  createdAt: string;
  updatedAt?: string;
  // Update fields
  content?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentMimeType?: string;
  hasAttachment?: boolean;
  fileId?: string;
  previewPrefs?: PreviewPrefs | null;
  author?: { id: string; name: string };
  commentCount?: number;
  // Activity fields
  type?: string;
  action?: string;
  actor?: { id: string; name: string };
  targetId?: string;
  targetTitle?: string;
  detail?: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const actionLabels: Record<string, string> = {
  accepted: "accepted",
  declined: "declined",
  acknowledged: "acknowledged",
  signed: "signed",
  voted: "voted on",
  closed: "closed voting on",
};

const actionColors: Record<string, { bg: string; text: string }> = {
  accepted: { bg: "#dcfce7", text: "#15803d" },
  declined: { bg: "#fee2e2", text: "#b91c1c" },
  acknowledged: { bg: "#dbeafe", text: "#1d4ed8" },
  signed: { bg: "#ccfbf1", text: "#0f766e" },
  voted: { bg: "#fef3c7", text: "#92400e" },
  closed: { bg: "#f3f4f6", text: "#374151" },
};

function ActivityIcon({ type }: { type?: string }) {
  switch (type) {
    case "document_response":
      return <FileCheck size={14} className="text-blue-500" />;
    case "decision_vote":
      return <Vote size={14} className="text-amber-500" />;
    case "decision_closed":
      return <Lock size={14} className="text-gray-500" />;
    default:
      return <MessageSquare size={14} className="text-[var(--muted-foreground)]" />;
  }
}

export function UpdatesSection({
  projectId,
  isArchived,
  onFileChange,
  currentUserId = null,
  currentRole = null,
}: {
  projectId: string;
  isArchived: boolean;
  onFileChange?: () => void;
  currentUserId?: string | null;
  currentRole?: string | null;
}) {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [newContent, setNewContent] = useState("");
  const [newAttachment, setNewAttachment] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const isPrivileged = currentRole === "owner" || currentRole === "admin";

  const loadTimeline = useCallback(() => {
    apiFetch<PaginatedResponse<TimelineEntry>>(
      `/updates/timeline/${projectId}?page=${page}&limit=10`,
    )
      .then((res) => {
        setTimeline(res.data);
        setTotalPages(res.meta.totalPages);
      })
      .catch(console.error);
  }, [projectId, page]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  const startEdit = (entry: TimelineEntry): void => {
    setEditingId(entry.id);
    setEditDraft(entry.content || "");
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setEditDraft("");
  };

  const saveEdit = async (updateId: string): Promise<void> => {
    const content = editDraft.trim();
    if (!content) return;
    setEditSaving(true);
    try {
      await apiFetch(`/updates/${updateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setEditingId(null);
      setEditDraft("");
      loadTimeline();
      success("Update edited");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to edit update");
    } finally {
      setEditSaving(false);
    }
  };

  const handlePost = async () => {
    if (!newContent.trim()) return;
    setPosting(true);
    try {
      const formData = new FormData();
      formData.append("content", newContent);
      if (newAttachment) {
        formData.append("attachment", newAttachment);
      }
      await apiFetch(`/updates?projectId=${projectId}`, {
        method: "POST",
        body: formData,
      });
      track("update_posted", { has_attachment: !!newAttachment });
      setNewContent("");
      setNewAttachment(null);
      setShowCompose(false);
      loadTimeline();
      onFileChange?.();
      success("Update posted");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to post update");
    } finally {
      setPosting(false);
    }
  };

  const handleAttachmentDownload = async (fileId: string, filename: string) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ""}/api/files/${fileId}/download`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to download file");
    }
  };

  const handlePrefsChange = async (updateId: string, next: PreviewPrefs) => {
    // Optimistic update — server errors are silent (prefs are a display hint).
    setTimeline((prev) =>
      prev.map((e) => (e.id === updateId ? { ...e, previewPrefs: next } : e)),
    );
    try {
      await apiFetch(`/updates/${updateId}/preview-prefs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewPrefs: next }),
      });
    } catch (err) {
      console.error("Failed to save preview prefs", err);
    }
  };

  const handleDelete = async (updateId: string) => {
    const ok = await confirm({
      title: "Delete Update",
      message: "Delete this update? This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/updates/${updateId}`, { method: "DELETE" });
      loadTimeline();
      onFileChange?.();
      success("Update deleted");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete update");
    }
  };

  return (
    <div>
      {!isArchived && (
        <div className="mb-4">
          <button
            onClick={() => setShowCompose(true)}
            className="flex items-center gap-2 px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
          >
            <Plus size={14} />
            Add Update
          </button>
        </div>
      )}

      {showCompose && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCompose(false);
              setNewContent("");
              setNewAttachment(null);
            }
          }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-lg mx-4 p-6 space-y-4">
            <h3 className="text-lg font-semibold">Post Update</h3>
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Write a status update..."
              maxLength={5000}
              rows={4}
              autoFocus
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm resize-none outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm cursor-pointer hover:bg-[var(--muted)] transition-colors">
                <Paperclip size={14} />
                Attach File
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => setNewAttachment(e.target.files?.[0] ?? null)}
                />
              </label>
              {newAttachment && (
                <span className="text-xs text-[var(--muted-foreground)] flex items-center gap-1">
                  {newAttachment.name}
                  <button
                    type="button"
                    onClick={() => setNewAttachment(null)}
                    className="hover:text-red-500"
                  >
                    &times;
                  </button>
                </span>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCompose(false);
                  setNewContent("");
                  setNewAttachment(null);
                }}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePost}
                disabled={posting || !newContent.trim()}
                className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
              >
                {posting ? "Posting..." : "Post"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {timeline.map((entry) => {
          if (entry.kind === "activity") {
            const colors = actionColors[entry.action || ""] || actionColors.closed;
            const actorName = entry.actor?.name || "Someone";
            const label = actionLabels[entry.action || ""] || entry.action;

            return (
              <div
                key={entry.id}
                data-testid="activity-entry"
                className="flex items-start gap-3 px-4 py-3 border border-[var(--border)] rounded-lg bg-[var(--muted)]/30"
              >
                <div className="mt-0.5">
                  <ActivityIcon type={entry.type} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{actorName}</span>
                    {" "}
                    <span className="text-[var(--muted-foreground)]">{label}</span>
                    {" "}
                    <span className="font-medium">{entry.targetTitle}</span>
                    {entry.detail && (
                      <span className="text-[var(--muted-foreground)]">
                        {" "}
                        &mdash; {entry.detail}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: colors.bg, color: colors.text }}
                    >
                      {entry.action}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {formatRelativeTime(entry.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          // Regular update entry
          const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
          const isImage = IMAGE_TYPES.has(entry.attachmentMimeType || "");
          const attachmentSrc = entry.fileId
            ? `${API_URL}/api/files/${entry.fileId}/download`
            : entry.attachmentUrl || `${API_URL}/api/updates/${entry.id}/attachment`;
          const isAuthor =
            !!currentUserId && !!entry.author?.id && entry.author.id === currentUserId;
          const canEdit = isAuthor || isPrivileged || !currentRole;
          const isEditing = editingId === entry.id;
          const showEdited =
            !!entry.updatedAt &&
            new Date(entry.updatedAt).getTime() - new Date(entry.createdAt).getTime() >
              2 * 60 * 1000;
          return (
            <div
              key={entry.id}
              data-testid={`update-entry-${entry.id}`}
              className="border border-[var(--border)] rounded-lg p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{entry.author?.name}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {formatRelativeTime(entry.createdAt)}
                  </span>
                  {showEdited && (
                    <span
                      data-testid="update-edited-indicator"
                      className="text-xs text-[var(--muted-foreground)] italic"
                    >
                      (edited)
                    </span>
                  )}
                </div>
                {!isArchived && !isEditing && (
                  <div className="flex items-center gap-1">
                    {canEdit && (
                      <button
                        onClick={() => startEdit(entry)}
                        aria-label="Edit update"
                        data-testid={`edit-update-${entry.id}`}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline"
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:underline"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    maxLength={5000}
                    rows={4}
                    autoFocus
                    data-testid={`edit-update-textarea-${entry.id}`}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm resize-none outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={cancelEdit}
                      className="px-3 py-1 border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--muted)] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveEdit(entry.id)}
                      disabled={editSaving || !editDraft.trim()}
                      data-testid={`save-update-${entry.id}`}
                      className="px-3 py-1 bg-[var(--primary)] text-white rounded-lg text-xs hover:opacity-90 disabled:opacity-50"
                    >
                      {editSaving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm whitespace-pre-wrap">{linkify(entry.content || "")}</p>
                  <Embeds
                    text={entry.content || ""}
                    prefs={entry.previewPrefs ?? undefined}
                    onPrefsChange={(next) => handlePrefsChange(entry.id, next)}
                  />
                </>
              )}
              {entry.hasAttachment && isImage && (
                <img
                  src={attachmentSrc}
                  alt=""
                  className="mt-3 max-w-full max-h-80 rounded-lg border border-[var(--border)]"
                />
              )}
              {entry.hasAttachment && !isImage && (
                <button
                  onClick={() =>
                    entry.fileId
                      ? handleAttachmentDownload(entry.fileId, entry.attachmentName || "download")
                      : window.open(attachmentSrc, "_blank")
                  }
                  className="mt-3 flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors w-full sm:w-fit"
                >
                  <FileText size={16} className="text-[var(--muted-foreground)] shrink-0" />
                  <span className="truncate min-w-0 flex-1">{entry.attachmentName || "Download"}</span>
                  <Download size={14} className="text-[var(--muted-foreground)] shrink-0" />
                </button>
              )}
              <CommentsSection
                targetType="update"
                targetId={entry.id}
                commentCount={entry.commentCount ?? 0}
              />
            </div>
          );
        })}
        {timeline.length === 0 && (
          <div className="text-center py-8">
            <MessageSquare size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">
              No updates posted yet.
            </p>
          </div>
        )}
      </div>
      <div className="mt-3">
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}
