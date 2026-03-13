"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import { Trash2, Plus, MessageSquare, Paperclip, FileText, Download } from "lucide-react";
import { linkify } from "@/lib/linkify";
import { track } from "@/lib/track";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

interface ProjectUpdateRecord {
  id: string;
  content: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentMimeType?: string;
  hasAttachment: boolean;
  fileId?: string;
  author: { id: string; name: string };
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export function UpdatesSection({
  projectId,
  isArchived,
  onFileChange,
}: {
  projectId: string;
  isArchived: boolean;
  onFileChange?: () => void;
}) {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [updates, setUpdates] = useState<ProjectUpdateRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [newContent, setNewContent] = useState("");
  const [newAttachment, setNewAttachment] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const [showCompose, setShowCompose] = useState(false);

  const loadUpdates = useCallback(() => {
    apiFetch<PaginatedResponse<ProjectUpdateRecord>>(
      `/updates/project/${projectId}?page=${page}&limit=10`,
    )
      .then((res) => {
        setUpdates(res.data);
        setTotalPages(res.meta.totalPages);
      })
      .catch(console.error);
  }, [projectId, page]);

  useEffect(() => {
    loadUpdates();
  }, [loadUpdates]);

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
      loadUpdates();
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
      loadUpdates();
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
        {updates.map((update) => {
          const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
          const isImage = IMAGE_TYPES.has(update.attachmentMimeType || "");
          const attachmentSrc = update.fileId
            ? `${API_URL}/api/files/${update.fileId}/download`
            : update.attachmentUrl || `${API_URL}/api/updates/${update.id}/attachment`;
          return (
            <div
              key={update.id}
              className="border border-[var(--border)] rounded-lg p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{update.author.name}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {formatRelativeTime(update.createdAt)}
                  </span>
                </div>
                {!isArchived && (
                  <button
                    onClick={() => handleDelete(update.id)}
                    className="flex items-center gap-1 text-xs text-red-500 hover:underline"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                )}
              </div>
              <p className="text-sm whitespace-pre-wrap">{linkify(update.content)}</p>
              {update.hasAttachment && isImage && (
                <img
                  src={attachmentSrc}
                  alt=""
                  className="mt-3 max-w-full max-h-80 rounded-lg border border-[var(--border)]"
                />
              )}
              {update.hasAttachment && !isImage && (
                <button
                  onClick={() =>
                    update.fileId
                      ? handleAttachmentDownload(update.fileId, update.attachmentName || "download")
                      : window.open(attachmentSrc, "_blank")
                  }
                  className="mt-3 flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors w-fit"
                >
                  <FileText size={16} className="text-[var(--muted-foreground)] shrink-0" />
                  <span className="truncate max-w-[200px]">{update.attachmentName || "Download"}</span>
                  <Download size={14} className="text-[var(--muted-foreground)] shrink-0" />
                </button>
              )}
            </div>
          );
        })}
        {updates.length === 0 && (
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
