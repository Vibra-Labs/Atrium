"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { formatBytes, formatRelativeTime } from "@/lib/utils";
import { ProjectDetailSkeleton } from "@/components/skeletons";
import { Pagination } from "@/components/pagination";
import {
  Download,
  FileX,
  FileText,
  MessageSquare,
  CheckSquare,
  Square,
  ListTodo,
  Upload,
  Calendar,
  Vote,
  Lock,
  FileCheck,
  PenTool,
  Award,
  Ban,
  Clock,
  Plus,
  Paperclip,
} from "lucide-react";
import { PortalInvoicesSection } from "./components/portal-invoices-section";
import { linkify } from "@/lib/linkify";
import { getEmbeds, EmbedPreview } from "@/lib/embeds";
import { downloadFile } from "@/lib/download";
import { SigningViewer } from "@/components/signing-viewer";
import { DocumentViewer } from "@/components/document-viewer";
import { useToast } from "@/components/toast";
import { CommentsSection } from "@/components/comments-section";
import { Avatar } from "@/components/avatar";
import { TaskDetailModal } from "@/components/task-detail-modal";
import { getTaskStatusBadge, getTaskStatusLabel } from "@/lib/task-status";

interface FileRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  files: FileRecord[];
}

interface TimelineEntry {
  id: string;
  kind: "update" | "activity";
  createdAt: string;
  // Update fields
  content?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentMimeType?: string;
  hasAttachment?: boolean;
  fileId?: string;
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

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

interface ProjectStatus {
  id: string;
  name: string;
  slug: string;
  color: string;
  order: number;
}

interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  status: string;
  requestedById?: string | null;
  assigneeId?: string | null;
  requester?: { id: string; name: string; image?: string | null } | null;
  assignee?: { id: string; name: string; image?: string | null } | null;
  order: number;
  type: string;
  question?: string;
  closedAt?: string | null;
  createdAt?: string;
  options?: {
    id: string;
    label: string;
    order: number;
    _count: { votes: number };
  }[];
  votes?: { optionId: string }[];
  labels?: { label: { id: string; name: string; color: string } }[];
  _count?: { votes: number; comments: number };
}

interface DocumentRecord {
  id: string;
  type: string;
  title: string;
  status: string;
  requiresSignature: boolean;
  requiresApproval: boolean;
  signedFileId?: string;
  signedFile?: { id: string; filename: string; sizeBytes: number };
  signatureFields?: { id: string }[];
  file: { id: string; filename: string; mimeType: string; sizeBytes: number };
  responses: { id: string; action: string; createdAt: string; fieldId?: string; reason?: string }[];
  createdAt: string;
  expiresAt?: string;
  voidReason?: string;
  options?: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const docTypeLabels: Record<string, string> = {
  quote: "Quote",
  contract: "Contract",
  proposal: "Proposal",
  nda: "NDA",
  other: "Other",
};

const docActions: Record<string, string[]> = {
  quote: ["accepted", "declined"],
  contract: ["accepted", "declined"],
  proposal: ["accepted", "declined"],
  nda: ["accepted", "declined"],
  other: ["accepted", "declined"],
};

const tabs = [
  { id: "updates", label: "Updates" },
  { id: "tasks", label: "Tasks" },
  { id: "files", label: "Files" },
  { id: "invoices", label: "Invoices" },
] as const;

type TabId = (typeof tabs)[number]["id"];

interface PendingDocAction {
  docId: string;
  docTitle: string;
  docType: string;
  action: string;
}

export default function PortalProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [updates, setUpdates] = useState<TimelineEntry[]>([]);
  const [updatesPage, setUpdatesPage] = useState(1);
  const [updatesTotalPages, setUpdatesTotalPages] = useState(1);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [tasksPage, setTasksPage] = useState(1);
  const [tasksTotalPages, setTasksTotalPages] = useState(1);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [docsPage, setDocsPage] = useState(1);
  const [docsTotalPages, setDocsTotalPages] = useState(1);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    searchParams.get("task") ? "tasks" : "updates",
  );

  // When a ?task=<id> deep link is set, jump to the Tasks tab so the detail
  // modal can open (it's rendered inside the tasks tab).
  useEffect(() => {
    if (searchParams.get("task")) setActiveTab("tasks");
  }, [searchParams]);
  const [uploading, setUploading] = useState(false);
  const [signingDocId, setSigningDocId] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<DocumentRecord | null>(null);
  const [pendingDocAction, setPendingDocAction] = useState<PendingDocAction | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [selectedDocOptions, setSelectedDocOptions] = useState<Record<string, string>>({});
  const [showCompose, setShowCompose] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newAttachment, setNewAttachment] = useState<File | null>(null);
  const [postingUpdate, setPostingUpdate] = useState(false);
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [newRequestTitle, setNewRequestTitle] = useState("");
  const [newRequestDesc, setNewRequestDesc] = useState("");
  const [postingRequest, setPostingRequest] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // Deep-link sync for task modal
  useEffect(() => {
    const t = searchParams.get("task");
    if (t) setOpenTaskId(t);
  }, [searchParams]);

  const updateTaskInUrl = useCallback(
    (taskId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (taskId) params.set("task", taskId);
      else params.delete("task");
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  const openTaskModal = (taskId: string) => {
    setOpenTaskId(taskId);
    updateTaskInUrl(taskId);
  };
  const closeTaskModal = () => {
    setOpenTaskId(null);
    updateTaskInUrl(null);
  };

  const loadProject = useCallback(() => {
    apiFetch<Project>(`/projects/mine/${id}`)
      .then(setProject)
      .catch((err) => setError(err.message || "Failed to load project"));
  }, [id]);

  const loadUpdates = useCallback(() => {
    apiFetch<PaginatedResponse<TimelineEntry>>(
      `/updates/timeline/mine/${id}?page=${updatesPage}&limit=10`,
    )
      .then((res) => {
        setUpdates(res.data);
        setUpdatesTotalPages(res.meta.totalPages);
      })
      .catch(console.error);
  }, [id, updatesPage]);

  const loadTasks = useCallback(() => {
    apiFetch<PaginatedResponse<TaskRecord>>(
      `/tasks/mine/${id}?page=${tasksPage}&limit=20`,
    )
      .then((res) => {
        setTasks(res.data);
        setTasksTotalPages(res.meta.totalPages);
      })
      .catch(console.error);
  }, [id, tasksPage]);

  const loadDocuments = useCallback(() => {
    apiFetch<PaginatedResponse<DocumentRecord>>(`/documents/mine/${id}?page=${docsPage}&limit=20`)
      .then((res) => {
        setDocuments(res.data);
        setDocsTotalPages(res.meta.totalPages);
        // Track view for first pending document only (avoids N requests)
        const firstPending = res.data.find((d) => d.status === "pending");
        if (firstPending) {
          apiFetch(`/documents/${firstPending.id}/track-view`, { method: "POST" }).catch(() => {});
        }
      })
      .catch(console.error);
  }, [id, docsPage]);

  const handlePostUpdate = async () => {
    if (!newContent.trim()) return;
    setPostingUpdate(true);
    try {
      const formData = new FormData();
      formData.append("content", newContent);
      if (newAttachment) {
        formData.append("attachment", newAttachment);
      }
      await apiFetch(`/updates?projectId=${id}`, {
        method: "POST",
        body: formData,
      });
      setNewContent("");
      setNewAttachment(null);
      setShowCompose(false);
      loadUpdates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post update");
    } finally {
      setPostingUpdate(false);
    }
  };

  const handlePostRequest = async () => {
    if (!newRequestTitle.trim()) return;
    setPostingRequest(true);
    try {
      await apiFetch(`/tasks/mine?projectId=${id}`, {
        method: "POST",
        body: JSON.stringify({
          title: newRequestTitle,
          description: newRequestDesc || undefined,
        }),
      });
      setNewRequestTitle("");
      setNewRequestDesc("");
      setShowNewRequest(false);
      loadTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit request");
    } finally {
      setPostingRequest(false);
    }
  };

  const openDocumentConfirm = (doc: DocumentRecord, action: string) => {
    setPendingDocAction({
      docId: doc.id,
      docTitle: doc.title,
      docType: doc.type,
      action,
    });
    setDeclineReason("");
  };

  const handleDocumentConfirm = async () => {
    if (!pendingDocAction) return;
    setConfirmSubmitting(true);
    try {
      const body: Record<string, string> = { action: pendingDocAction.action };
      if (pendingDocAction.action === "declined" && declineReason.trim()) {
        body.reason = declineReason.trim();
      }
      await apiFetch(`/documents/${pendingDocAction.docId}/respond`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const actionLabel = pendingDocAction.action === "accepted"
        ? "accepted"
        : "declined";
      toast.success(`Document "${pendingDocAction.docTitle}" ${actionLabel} successfully.`);
      setPendingDocAction(null);
      setDeclineReason("");
      loadDocuments();
      loadProject();
    } catch (err) {
      console.error(err);
      toast.error("Failed to respond to document. Please try again.");
    } finally {
      setConfirmSubmitting(false);
    }
  };

  const handleDocumentRespond = async (docId: string, action: string, reason?: string) => {
    try {
      await apiFetch(`/documents/${docId}/respond`, {
        method: "POST",
        body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
      });
      loadDocuments();
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    apiFetch<{ user: { id: string } }>("/auth/get-session")
      .then((s) => setCurrentUserId(s.user.id))
      .catch((err) => {
        console.error(err);
        toast.error("Could not load your session. Some actions may be unavailable.");
      })
      .finally(() => setSessionLoaded(true));
  }, [toast]);

  useEffect(() => {
    loadProject();
    loadDocuments();
    apiFetch<ProjectStatus[]>("/projects/statuses")
      .then(setStatuses)
      .catch(console.error);
  }, [loadProject, loadDocuments]);

  useEffect(() => {
    loadUpdates();
  }, [loadUpdates]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await apiFetch(`/files/upload/mine?projectId=${id}`, {
        method: "POST",
        body: formData,
      });
      loadProject();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDownload = async (fileId: string, filename: string) => {
    try {
      await downloadFile(fileId, filename);
    } catch (err) {
      console.error(err);
    }
  };

  if (!project) return <ProjectDetailSkeleton />;

  const currentIndex = statuses.findIndex((s) => s.slug === project.status);

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
      )}

      {/* Left sidebar */}
      <aside className="w-full lg:w-72 lg:shrink-0 lg:sticky lg:top-8 space-y-4">
        <h1 className="text-lg font-bold leading-tight">{project.name}</h1>
        {project.description && (
          <p className="text-xs text-[var(--muted-foreground)] leading-relaxed -mt-1">
            {project.description}
          </p>
        )}

        {/* Progress bar */}
        <div className="flex gap-1">
          {statuses.map((s, i) => (
            <div
              key={s.id}
              className="flex-1 text-center py-1.5 text-[10px] font-medium rounded overflow-hidden text-ellipsis whitespace-nowrap px-0.5"
              style={{
                backgroundColor: i <= currentIndex ? s.color : "var(--muted)",
                color: i <= currentIndex ? "#fff" : "var(--muted-foreground)",
              }}
            >
              {s.name}
            </div>
          ))}
        </div>

        {/* Timeline */}
        {(project.startDate || project.endDate) && (
          <>
            <div className="border-t border-[var(--border)]" />
            <div className="space-y-1.5">
              <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-1.5 mb-2">
                <Calendar size={12} />
                Timeline
              </h2>
              {project.startDate && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted-foreground)]">Start</span>
                  <span>{formatDateDisplay(project.startDate)}</span>
                </div>
              )}
              {project.endDate && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted-foreground)]">End</span>
                  <span>{formatDateDisplay(project.endDate)}</span>
                </div>
              )}
              {project.endDate && (() => {
                const end = new Date(project.endDate);
                const diffDays = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                if (diffDays < 0) {
                  return (
                    <p className="text-xs text-red-500 font-medium">
                      {Math.abs(diffDays)} day{Math.abs(diffDays) !== 1 ? "s" : ""} overdue
                    </p>
                  );
                }
                if (diffDays === 0) {
                  return <p className="text-xs text-amber-600 font-medium">Due today</p>;
                }
                return (
                  <p className={`text-xs font-medium ${diffDays <= 7 ? "text-amber-600" : "text-[var(--muted-foreground)]"}`}>
                    {diffDays} day{diffDays !== 1 ? "s" : ""} left
                  </p>
                );
              })()}
            </div>
          </>
        )}
      </aside>

      {/* Right content area -- tabbed sections */}
      <div className="flex-1 min-w-0">
        {/* Pending actions banner */}
        {(() => {
          const pendingDocs = documents.filter(
            (d) => d.status === "pending" && d.responses.length === 0
          );
          if (pendingDocs.length === 0) return null;
          return (
            <button
              onClick={() => setActiveTab("files")}
              className="w-full mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3 text-left hover:bg-amber-100 transition-colors"
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-white text-sm font-bold shrink-0">
                {pendingDocs.length}
              </span>
              <div>
                <p className="text-sm font-medium text-amber-900">
                  {pendingDocs.length === 1 ? "1 document needs" : `${pendingDocs.length} documents need`} your attention
                </p>
                <p className="text-xs text-amber-700">
                  {pendingDocs.length} document{pendingDocs.length > 1 ? "s" : ""} to review
                </p>
              </div>
            </button>
          );
        })()}

        <div className="relative mb-6">
          <div className="flex overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {tabs.map((tab) => {
              const pendingCount = tab.id === "files"
                ? documents.filter((d) => d.status === "pending" && d.responses.length === 0).length
                : 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full ${
                    activeTab === tab.id
                      ? "text-[var(--primary)] after:bg-[var(--primary)]"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] after:bg-transparent"
                  }`}
                >
                  {tab.label}
                  {pendingCount > 0 && (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                      {pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-[var(--border)] -z-10" />
        </div>

        {/* Updates Tab */}
        {activeTab === "updates" && (
          <div>
            <div className="mb-4">
              <button
                onClick={() => setShowCompose(true)}
                className="flex items-center gap-2 px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
              >
                <Plus size={14} />
                Add Update
              </button>
            </div>

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
                    placeholder="Write an update..."
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
                      onClick={handlePostUpdate}
                      disabled={postingUpdate || !newContent.trim()}
                      className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                    >
                      {postingUpdate ? "Posting..." : "Post"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {updates.map((entry) => {
                if (entry.kind === "activity") {
                  const actorName = entry.actor?.name || "Someone";
                  const actionLabels: Record<string, string> = {
                    accepted: "accepted",
                    declined: "declined",
                    acknowledged: "acknowledged",
                    signed: "signed",
                    voted: "voted on",
                    closed: "closed voting on",
                  };
                  const actionBg: Record<string, string> = {
                    accepted: "#dcfce7",
                    declined: "#fee2e2",
                    acknowledged: "#dbeafe",
                    signed: "#ccfbf1",
                    voted: "#fef3c7",
                    closed: "#f3f4f6",
                  };
                  const actionFg: Record<string, string> = {
                    accepted: "#15803d",
                    declined: "#b91c1c",
                    acknowledged: "#1d4ed8",
                    signed: "#0f766e",
                    voted: "#92400e",
                    closed: "#374151",
                  };
                  const label = actionLabels[entry.action || ""] || entry.action;

                  return (
                    <div
                      key={entry.id}
                      data-testid="activity-entry"
                      className="flex items-start gap-3 px-4 py-3 border border-[var(--border)] rounded-lg bg-[var(--muted)]/30"
                    >
                      <div className="mt-0.5">
                        {entry.type === "document_response" && <FileCheck size={14} className="text-blue-500" />}
                        {entry.type === "decision_vote" && <Vote size={14} className="text-amber-500" />}
                        {entry.type === "decision_closed" && <Lock size={14} className="text-gray-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">
                          <span className="font-medium">{actorName}</span>
                          {" "}
                          <span className="text-[var(--muted-foreground)]">{label}</span>
                          {" "}
                          <span className="font-medium">{entry.targetTitle}</span>
                          {entry.detail && (
                            <span className="text-[var(--muted-foreground)]"> &mdash; {entry.detail}</span>
                          )}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{
                              backgroundColor: actionBg[entry.action || ""] || "#f3f4f6",
                              color: actionFg[entry.action || ""] || "#374151",
                            }}
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
                return (
                  <div
                    key={entry.id}
                    className="border border-[var(--border)] rounded-lg p-4"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium">{entry.author?.name}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {formatRelativeTime(entry.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{linkify(entry.content || "")}</p>
                    {getEmbeds(entry.content || "").map((embed) => (
                      <EmbedPreview key={embed.embedUrl} embed={embed} />
                    ))}
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
                            ? handleDownload(entry.fileId, entry.attachmentName || "download")
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
              {updates.length === 0 && (
                <div className="text-center py-8">
                  <MessageSquare size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
                  <p className="text-sm text-[var(--muted-foreground)]">
                    No updates shared yet.
                  </p>
                </div>
              )}
            </div>
            <div className="mt-3">
              <Pagination page={updatesPage} totalPages={updatesTotalPages} onPageChange={setUpdatesPage} />
            </div>
          </div>
        )}

        {/* Tasks Tab */}
        {activeTab === "tasks" && (() => {
          const hiddenCount = tasks.filter(
            (t) => t.status === "done" || t.status === "cancelled",
          ).length;
          const visibleTasks = showCompletedTasks
            ? tasks
            : tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
          return (
          <div>
            <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
              <button
                onClick={() => setShowNewRequest(true)}
                className="flex items-center gap-2 px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
              >
                <Plus size={14} />
                New Request
              </button>
              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowCompletedTasks((v) => !v)}
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline"
                >
                  {showCompletedTasks
                    ? `Hide done/cancelled (${hiddenCount})`
                    : `Show done/cancelled (${hiddenCount})`}
                </button>
              )}
            </div>

            {showNewRequest && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    setShowNewRequest(false);
                    setNewRequestTitle("");
                    setNewRequestDesc("");
                  }
                }}
              >
                <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-lg mx-4 p-6 space-y-4">
                  <h3 className="text-lg font-semibold">New Request</h3>
                  <input
                    type="text"
                    value={newRequestTitle}
                    onChange={(e) => setNewRequestTitle(e.target.value)}
                    placeholder="What do you need?"
                    maxLength={255}
                    autoFocus
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  />
                  <textarea
                    value={newRequestDesc}
                    onChange={(e) => setNewRequestDesc(e.target.value)}
                    placeholder="More details (optional)..."
                    maxLength={5000}
                    rows={3}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm resize-none outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setShowNewRequest(false);
                        setNewRequestTitle("");
                        setNewRequestDesc("");
                      }}
                      className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePostRequest}
                      disabled={postingRequest || !newRequestTitle.trim()}
                      className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                    >
                      {postingRequest ? "Submitting..." : "Submit"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {visibleTasks.map((task) => {
                if (task.type === "decision") {
                  const isClosed = !!task.closedAt;
                  const totalVotes = task._count?.votes ?? 0;
                  const hasVoted = !!task.votes?.[0];

                  return (
                    <div
                      key={task.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openTaskModal(task.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openTaskModal(task.id);
                        }
                      }}
                      data-testid={`task-row-${task.id}`}
                      className="p-2 border border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--muted)]/40 transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
                          <Vote size={12} />
                        </span>
                        <span className="flex-1 text-sm min-w-0 break-words">
                          {task.question || task.title}
                        </span>
                        {isClosed ? (
                          <span className="shrink-0 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                            <Lock size={10} />
                            Closed
                          </span>
                        ) : !hasVoted ? (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium">
                            Needs vote
                          </span>
                        ) : null}
                        {totalVotes > 0 && (
                          <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                            {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
                          </span>
                        )}
                        {task._count && task._count.comments > 0 && (
                          <span className="shrink-0 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                            <MessageSquare size={12} />
                            {task._count.comments}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                }

                // Checkbox / request task — clickable row opens detail modal
                const isOwnRequest = sessionLoaded && currentUserId !== null && task.requestedById === currentUserId;

                return (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openTaskModal(task.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openTaskModal(task.id);
                      }
                    }}
                    data-testid={`task-row-${task.id}`}
                    className="p-2 border border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--muted)]/40 transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${getTaskStatusBadge(task.status)}`}
                      >
                        {getTaskStatusLabel(task.status)}
                      </span>
                      <span
                        className={`flex-1 text-sm min-w-0 ${task.status === "done" || task.status === "cancelled" ? "line-through text-[var(--muted-foreground)]" : ""}`}
                      >
                        <span className="break-words">{task.title}</span>
                        {isOwnRequest && (
                          <span className="ml-2 shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium align-middle">
                            Your request
                          </span>
                        )}
                        {!isOwnRequest && task.requester && (
                          <span className="ml-2 text-xs text-[var(--muted-foreground)] align-middle">
                            • {task.requester.name}
                          </span>
                        )}
                      </span>
                      {task._count && task._count.comments > 0 && (
                        <span className="shrink-0 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                          <MessageSquare size={12} />
                          {task._count.comments}
                        </span>
                      )}
                      {task.dueDate && (
                        <span className="shrink-0 text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)]">
                          {formatDateDisplay(task.dueDate)}
                        </span>
                      )}
                      {task.assignee && (
                        <span className="shrink-0" title={task.assignee.name}>
                          <Avatar
                            name={task.assignee.name}
                            image={task.assignee.image}
                            size={22}
                          />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {visibleTasks.length === 0 && (
                <div className="text-center py-8">
                  <ListTodo size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {tasks.length === 0
                      ? "No tasks yet."
                      : "No active tasks."}
                  </p>
                </div>
              )}
            </div>
            <div className="mt-3">
              <Pagination page={tasksPage} totalPages={tasksTotalPages} onPageChange={setTasksPage} />
            </div>
          </div>
          );
        })()}

        {/* Files Tab */}
        {activeTab === "files" && (() => {
          const sortedFiles = [...project.files].sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );

          return (
            <div>
              <div className="flex justify-end mb-4">
                <label className="flex items-center gap-2 px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm cursor-pointer hover:opacity-90">
                  <Upload size={14} />
                  {uploading ? "Uploading..." : "Upload File"}
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleUpload}
                    disabled={uploading}
                  />
                </label>
              </div>
              <div className="space-y-2">
                {sortedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="p-3 border border-[var(--border)] rounded-lg"
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {file.filename}
                        </p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {formatBytes(file.sizeBytes)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDownload(file.id, file.filename)}
                        className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline shrink-0"
                      >
                        <Download size={14} />
                        Download
                      </button>
                    </div>
                  </div>
                ))}
                {project.files.length === 0 && documents.length === 0 && (
                  <div className="text-center py-8">
                    <FileX size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
                    <p className="text-sm text-[var(--muted-foreground)]">
                      No files shared yet.
                    </p>
                  </div>
                )}
              </div>

              {/* Documents section */}
              {documents.length > 0 && (
                <div className="mt-6">
                  <div className="border-t border-[var(--border)] pt-4 mb-3">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <FileCheck size={16} className="text-[var(--muted-foreground)]" />
                      Documents
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {documents.map((doc) => {
                      const isVoided = doc.status === "voided";
                      const isExpired = doc.status === "expired";
                      const isReadOnly = isVoided || isExpired;

                      // Approval responses (non-signing)
                      const approvalResponses = doc.responses.filter((r) => r.action !== "signed");
                      const hasResponded = approvalResponses.length > 0;
                      const lastResponse = hasResponded ? approvalResponses[0] : null;

                      // Check if this document requires signing and has unsigned fields
                      const needsSigning = doc.requiresSignature &&
                        doc.signatureFields &&
                        doc.signatureFields.length > 0;
                      const signedFieldIds = doc.responses
                        .filter((r) => r.action === "signed" && r.fieldId)
                        .map((r) => r.fieldId);
                      const allFieldsSigned = needsSigning &&
                        doc.signatureFields!.every((f) => signedFieldIds.includes(f.id));
                      const hasUnsignedFields = needsSigning && !allFieldsSigned && !isReadOnly;

                      // Options — format: "question|choice1,choice2" or "choice1,choice2"
                      const hasQuestionSep = doc.options?.includes("|");
                      const optionsQuestion = hasQuestionSep ? doc.options!.split("|")[0] : null;
                      const optionsRaw = hasQuestionSep ? doc.options!.split("|")[1] : doc.options;
                      const docOptionsList = optionsRaw ? optionsRaw.split(",").map((o) => o.trim()).filter(Boolean) : [];
                      const hasOptions = docOptionsList.length > 0;
                      const selectedOption = selectedDocOptions[doc.id] || lastResponse?.reason || "";

                      return (
                        <div
                          key={doc.id}
                          className={`p-3 border border-[var(--border)] rounded-lg transition-colors ${
                            isReadOnly ? "opacity-60" : ""
                          }`}
                        >
                          {/* Header row */}
                          <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap">
                            <button
                              onClick={() => setViewingDoc(doc)}
                              className="flex items-center gap-3 min-w-0 text-left cursor-pointer flex-1"
                              data-testid={`view-document-${doc.id}`}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate text-[var(--primary)] hover:underline">{doc.title}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)]">
                                    {docTypeLabels[doc.type] || doc.type}
                                  </span>
                                  <span className="text-xs text-[var(--muted-foreground)]">
                                    {formatBytes(doc.file.sizeBytes)}
                                  </span>
                                  {doc.expiresAt && !isExpired && (
                                    <span className="text-xs text-amber-600 flex items-center gap-1">
                                      <Clock size={10} />
                                      Expires {new Date(doc.expiresAt).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => handleDownload(doc.file.id, doc.file.filename)}
                                className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
                              >
                                <Download size={14} />
                              </button>
                              {doc.status === "signed" && (
                                <button
                                  onClick={async () => {
                                    try {
                                      const response = await fetch(
                                        `${process.env.NEXT_PUBLIC_API_URL || ""}/api/documents/${doc.id}/certificate`,
                                        { credentials: "include" },
                                      );
                                      if (!response.ok) throw new Error("Failed");
                                      const blob = await response.blob();
                                      const url = URL.createObjectURL(blob);
                                      const a = document.createElement("a");
                                      a.href = url;
                                      a.download = `certificate-${doc.id.slice(0, 8)}.pdf`;
                                      a.click();
                                      URL.revokeObjectURL(url);
                                    } catch {
                                      console.error("Failed to download certificate");
                                    }
                                  }}
                                  className="flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                                >
                                  <Award size={12} />
                                  Certificate
                                </button>
                              )}
                              {isVoided && (
                                <span className="text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1" style={{ backgroundColor: "#fce7f3", color: "#9d174d" }}>
                                  <Ban size={10} /> Voided
                                </span>
                              )}
                              {isExpired && (
                                <span className="text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1" style={{ backgroundColor: "#f3f4f6", color: "#9ca3af" }}>
                                  <Clock size={10} /> Expired
                                </span>
                              )}
                              {!isReadOnly && !hasOptions && (
                                <>
                                  {doc.requiresApproval && hasResponded && lastResponse ? (
                                    <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: lastResponse.action === "declined" ? "#fee2e2" : "#dcfce7", color: lastResponse.action === "declined" ? "#b91c1c" : "#15803d" }}>
                                      {lastResponse.action.charAt(0).toUpperCase() + lastResponse.action.slice(1)}
                                    </span>
                                  ) : (
                                    <>
                                      {doc.requiresApproval && !hasResponded && (
                                        <>
                                          <button onClick={() => openDocumentConfirm(doc, "accepted")} className="px-3 py-1 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "#15803d" }}>Accept</button>
                                          <button onClick={() => openDocumentConfirm(doc, "declined")} className="px-3 py-1 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "#b91c1c" }}>Decline</button>
                                        </>
                                      )}
                                      {hasUnsignedFields && (
                                        <button onClick={() => setSigningDocId(doc.id)} className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "#d97706" }}>
                                          <PenTool size={12} /> Review & Sign
                                        </button>
                                      )}
                                      {allFieldsSigned && (
                                        <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: "#ccfbf1", color: "#0f766e" }}>Signed</span>
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {/* Radio options — shown when document has options */}
                          {hasOptions && !isReadOnly && (
                            <div className="mt-3 pt-3 border-t border-[var(--border)]">
                              {optionsQuestion && (
                                <p className="text-sm font-medium mb-2">{optionsQuestion}</p>
                              )}
                              {hasResponded && lastResponse?.reason ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-[var(--muted-foreground)]">Selected:</span>
                                  <span className="text-sm font-medium px-3 py-1 bg-[var(--primary)]/10 rounded-full" style={{ color: "var(--primary)" }}>
                                    {lastResponse.reason}
                                  </span>
                                </div>
                              ) : (
                                <>
                                  <div className="space-y-1.5">
                                    {docOptionsList.map((option) => (
                                      <label
                                        key={option}
                                        className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                                          selectedOption === option
                                            ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]"
                                            : "border-[var(--border)] hover:bg-[var(--muted)]"
                                        }`}
                                      >
                                        <input
                                          type="radio"
                                          name={`doc-option-${doc.id}`}
                                          value={option}
                                          checked={selectedOption === option}
                                          onChange={() => setSelectedDocOptions((prev) => ({ ...prev, [doc.id]: option }))}
                                          className="accent-[var(--primary)]"
                                        />
                                        <span className="text-sm">{option}</span>
                                      </label>
                                    ))}
                                  </div>
                                  <div className="flex items-center gap-2 mt-3">
                                    <button
                                      onClick={async () => {
                                        const selected = selectedDocOptions[doc.id];
                                        if (!selected) return;
                                        try {
                                          await apiFetch(`/documents/${doc.id}/respond`, {
                                            method: "POST",
                                            body: JSON.stringify({ action: "accepted", reason: selected }),
                                          });
                                          toast.success(`Selection "${selected}" submitted.`);
                                          setSelectedDocOptions((prev) => { const next = { ...prev }; delete next[doc.id]; return next; });
                                          loadDocuments();
                                        } catch (err) {
                                          toast.error("Failed to submit selection.");
                                        }
                                      }}
                                      disabled={!selectedDocOptions[doc.id]}
                                      className="px-4 py-1.5 text-sm rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                                    >
                                      Submit Selection
                                    </button>
                                    {doc.requiresApproval && (
                                      <>
                                        <button onClick={() => openDocumentConfirm(doc, "accepted")} className="px-3 py-1 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "#15803d" }}>Accept</button>
                                        <button onClick={() => openDocumentConfirm(doc, "declined")} className="px-3 py-1 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "#b91c1c" }}>Decline</button>
                                      </>
                                    )}
                                    {hasUnsignedFields && (
                                      <button onClick={() => setSigningDocId(doc.id)} className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "#d97706" }}>
                                        <PenTool size={12} /> Review & Sign
                                      </button>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {docsTotalPages > 1 && (
                    <div className="mt-3">
                      <Pagination page={docsPage} totalPages={docsTotalPages} onPageChange={setDocsPage} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Invoices Tab */}
        {activeTab === "invoices" && (
          <PortalInvoicesSection projectId={id} />
        )}
      </div>

      {/* Task Detail Modal */}
      {openTaskId && (() => {
        const t = tasks.find((x) => x.id === openTaskId);
        if (!t) return null;
        return (
          <TaskDetailModal
            task={t}
            viewer="client"
            currentUserId={currentUserId}
            onClose={closeTaskModal}
            onChange={loadTasks}
          />
        );
      })()}

      {/* Signing Viewer Modal */}
      {signingDocId && (
        <SigningViewer
          documentId={signingDocId}
          onClose={() => setSigningDocId(null)}
          onSigned={() => {
            setSigningDocId(null);
            loadDocuments();
          }}
        />
      )}

      {/* Document Viewer Modal */}
      {viewingDoc && (
        <DocumentViewer
          documentId={viewingDoc.id}
          title={viewingDoc.title}
          typeLabel={docTypeLabels[viewingDoc.type] || viewingDoc.type}
          mimeType={viewingDoc.file.mimeType}
          fileId={viewingDoc.file.id}
          filename={viewingDoc.file.filename}
          hasResponded={viewingDoc.requiresApproval && viewingDoc.responses.filter((r) => r.action !== "signed").length > 0}
          lastResponseAction={viewingDoc.responses.filter((r) => r.action !== "signed")[0]?.action}
          actions={viewingDoc.requiresApproval ? (docActions[viewingDoc.type] || ["accepted", "declined"]) : []}
          onRespond={async (action, reason) => {
            await handleDocumentRespond(viewingDoc.id, action, reason);
          }}
          onClose={() => setViewingDoc(null)}
        />
      )}

      {/* Document Response Confirmation Dialog */}
      {pendingDocAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget && !confirmSubmitting) {
              setPendingDocAction(null);
              setDeclineReason("");
            }
          }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="text-lg font-semibold">
              {pendingDocAction.action === "accepted"
                ? "Accept Document"
                : "Decline Document"}
            </h3>
            <div className="text-sm text-[var(--muted-foreground)] space-y-2">
              <p>
                Are you sure you want to{" "}
                <span className="font-medium text-[var(--foreground)]">
                  {pendingDocAction.action === "accepted" ? "accept" : "decline"}
                </span>{" "}
                this document?
              </p>
              <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--muted)]">
                <p className="text-sm font-medium text-[var(--foreground)]">{pendingDocAction.docTitle}</p>
                <span className="text-xs px-2 py-0.5 bg-[var(--background)] rounded-full text-[var(--muted-foreground)] mt-1 inline-block">
                  {docTypeLabels[pendingDocAction.docType] || pendingDocAction.docType}
                </span>
              </div>
            </div>
            {pendingDocAction.action === "declined" && (
              <div>
                <label className="block text-sm text-[var(--muted-foreground)] mb-1.5">
                  Reason for declining (optional)
                </label>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Provide a reason for declining..."
                  rows={3}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)] resize-none"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setPendingDocAction(null);
                  setDeclineReason("");
                }}
                disabled={confirmSubmitting}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleDocumentConfirm}
                disabled={confirmSubmitting}
                className={
                  pendingDocAction.action === "declined"
                    ? "px-4 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors disabled:opacity-40"
                    : "px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors disabled:opacity-40"
                }
              >
                {confirmSubmitting
                  ? "Submitting..."
                  : pendingDocAction.action === "accepted"
                    ? "Confirm Accept"
                    : "Confirm Decline"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
