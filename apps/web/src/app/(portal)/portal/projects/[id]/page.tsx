"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
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
  Check,
  X,
} from "lucide-react";
import { PortalInvoicesSection } from "./components/portal-invoices-section";
import { linkify } from "@/lib/linkify";
import { downloadFile } from "@/lib/download";
import { DocumentViewer } from "@/components/document-viewer";
import { useToast } from "@/components/toast";

// -- From agent-a6c3c855: unified file record with document fields --
interface FileRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  documentType?: string | null;
  documentTitle?: string | null;
  documentStatus?: string | null;
  respondedAt?: string | null;
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

// -- From agent-a2624ff7: timeline entry for activity feed --
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
  // Activity fields
  type?: string;
  action?: string;
  actor?: { id: string; name: string };
  targetId?: string;
  targetTitle?: string;
  detail?: string;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// -- From agent-a6c3c855: unified status/type badge styles --
const DOC_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pending" },
  viewed: { bg: "bg-blue-50", text: "text-blue-700", label: "Viewed" },
  accepted: { bg: "bg-green-50", text: "text-green-700", label: "Accepted" },
  rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rejected" },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  quote: "Quote",
  contract: "Contract",
  nda: "NDA",
  proposal: "Proposal",
  other: "Document",
};

const DOC_TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  quote: { bg: "bg-purple-50", text: "text-purple-700" },
  contract: { bg: "bg-blue-50", text: "text-blue-700" },
  nda: { bg: "bg-orange-50", text: "text-orange-700" },
  proposal: { bg: "bg-teal-50", text: "text-teal-700" },
  other: { bg: "bg-gray-50", text: "text-gray-700" },
};

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
  completed: boolean;
  order: number;
  type: string;
  question?: string;
  closedAt?: string | null;
  options?: {
    id: string;
    label: string;
    order: number;
    _count: { votes: number };
  }[];
  votes?: { optionId: string }[];
  _count?: { votes: number };
}

// -- Documents are still loaded separately for the document viewer / signing features --
interface DocumentRecord {
  id: string;
  type: string;
  title: string;
  status: string;
  file: { id: string; filename: string; mimeType: string; sizeBytes: number };
  responses: { id: string; action: string; createdAt: string }[];
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const docTypeLabels: Record<string, string> = {
  quote: "Quote",
  contract: "Contract",
  nda: "NDA",
  other: "Other",
};

const docActions: Record<string, string[]> = {
  quote: ["accepted", "declined"],
  contract: ["accepted", "declined"],
  proposal: ["accepted", "declined"],
  nda: ["acknowledged"],
  other: ["acknowledged"],
};

const tabs = [
  { id: "updates", label: "Updates" },
  { id: "tasks", label: "Tasks" },
  { id: "files", label: "Files" },
  { id: "invoices", label: "Invoices" },
] as const;

type TabId = (typeof tabs)[number]["id"];

// -- From agent-a3c3fd72: confirmation dialog state --
interface PendingDocAction {
  docId: string;
  docTitle: string;
  docType: string;
  action: string;
}

export default function PortalProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
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
  const [activeTab, setActiveTab] = useState<TabId>("updates");
  const [uploading, setUploading] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  // -- From agent-acabd59e: inline document viewer --
  const [viewingDoc, setViewingDoc] = useState<DocumentRecord | null>(null);
  // -- From agent-a3c3fd72: confirmation dialog --
  const [pendingDocAction, setPendingDocAction] = useState<PendingDocAction | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  // -- From agent-a6c3c855: responding state for unified files --
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  // State for viewing a file-based document in the viewer
  const [viewingFile, setViewingFile] = useState<FileRecord | null>(null);
  const [viewingFileDecline, setViewingFileDecline] = useState(false);

  const loadProject = useCallback(() => {
    apiFetch<Project>(`/projects/mine/${id}`)
      .then(setProject)
      .catch((err) => setError(err.message || "Failed to load project"));
  }, [id]);

  // -- From agent-a2624ff7: timeline API endpoint --
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
      })
      .catch(console.error);
  }, [id, docsPage]);

  const handleVote = async (taskId: string) => {
    const optionId = selectedOptions[taskId];
    if (!optionId) return;
    try {
      await apiFetch(`/tasks/${taskId}/vote`, {
        method: "POST",
        body: JSON.stringify({ optionId }),
      });
      setSelectedOptions((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      loadTasks();
    } catch (err) {
      console.error(err);
    }
  };

  // -- From agent-a3c3fd72: confirmation dialog for document accept/decline --
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
        : pendingDocAction.action === "declined"
          ? "declined"
          : "acknowledged";
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

  // -- From agent-a6c3c855: respond to files with document fields --
  const handleFileDocumentRespond = async (fileId: string, action: "accepted" | "rejected", reason?: string) => {
    setRespondingTo(fileId);
    try {
      await apiFetch(`/files/${fileId}/respond`, {
        method: "PATCH",
        body: JSON.stringify({ action, reason }),
      });
      loadProject();
    } catch (err) {
      console.error(err);
    } finally {
      setRespondingTo(null);
    }
  };

  const handleDocumentRespond = async (docId: string, action: string) => {
    try {
      await apiFetch(`/documents/${docId}/respond`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      loadDocuments();
    } catch (err) {
      console.error(err);
    }
  };

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
              className="flex-1 text-center py-1.5 text-[10px] font-medium rounded"
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
          const pendingFiles = (project?.files || []).filter(
            (f: FileRecord) => f.documentType && (f.documentStatus === "pending" || f.documentStatus === "viewed")
          );
          const pendingTasks: unknown[] = [];
          const totalPending = pendingFiles.length + pendingTasks.length;
          if (totalPending === 0) return null;
          return (
            <button
              onClick={() => setActiveTab("files")}
              className="w-full mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3 text-left hover:bg-amber-100 transition-colors"
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-white text-sm font-bold shrink-0">
                {totalPending}
              </span>
              <div>
                <p className="text-sm font-medium text-amber-900">
                  {totalPending === 1 ? "1 item needs" : `${totalPending} items need`} your attention
                </p>
                <p className="text-xs text-amber-700">
                  {pendingFiles.length > 0 && `${pendingFiles.length} document${pendingFiles.length > 1 ? "s" : ""} to review`}
                  {pendingFiles.length > 0 && pendingTasks.length > 0 && " · "}
                  {pendingTasks.length > 0 && `${pendingTasks.length} decision${pendingTasks.length > 1 ? "s" : ""} to vote on`}
                </p>
              </div>
            </button>
          );
        })()}

        <div className="flex border-b border-[var(--border)] mb-6">
          {tabs.map((tab) => {
            const pendingCount = tab.id === "files"
              ? (project?.files || []).filter((f: FileRecord) => f.documentType && (f.documentStatus === "pending" || f.documentStatus === "viewed")).length
              : 0;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
                  activeTab === tab.id
                    ? "border-[var(--primary)] text-[var(--primary)]"
                    : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--border)]"
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

        {/* Updates Tab -- From agent-a2624ff7: activity feed in timeline */}
        {activeTab === "updates" && (
          <div>
            <div className="space-y-3">
              {updates.map((entry) => {
                // -- Activity entry rendering from agent-a2624ff7 --
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
                        className="mt-3 flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors w-fit"
                      >
                        <FileText size={16} className="text-[var(--muted-foreground)] shrink-0" />
                        <span className="truncate max-w-[200px]">{entry.attachmentName || "Download"}</span>
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
        {activeTab === "tasks" && (
          <div>
            <div className="space-y-2">
              {tasks.map((task) => {
                if (task.type === "decision") {
                  const userVote = task.votes?.[0];
                  const isClosed = !!task.closedAt;
                  const totalVotes = task._count?.votes ?? 0;
                  const hasResults = totalVotes > 0 && task.options?.some((o) => o._count.votes > 0);

                  return (
                    <div
                      key={task.id}
                      className="border border-[var(--border)] rounded-lg p-4 space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <Vote size={18} className="text-[var(--primary)] shrink-0" />
                        <span className="text-sm font-medium flex-1">
                          {task.question || task.title}
                        </span>
                        {isClosed && (
                          <span className="text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)] flex items-center gap-1">
                            <Lock size={10} />
                            Closed
                          </span>
                        )}
                      </div>

                      {task.options && task.options.length > 0 && (
                        <div className="space-y-1.5">
                          {task.options.map((opt) => {
                            const isSelected =
                              selectedOptions[task.id]
                                ? selectedOptions[task.id] === opt.id
                                : userVote?.optionId === opt.id;

                            return (
                              <label
                                key={opt.id}
                                className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                                  isSelected
                                    ? "border-[var(--primary)] bg-[var(--primary)]/5"
                                    : "border-[var(--border)] hover:bg-[var(--muted)]"
                                } ${isClosed && !isSelected ? "opacity-60" : ""}`}
                                style={isSelected ? { borderColor: "var(--primary)", backgroundColor: "color-mix(in srgb, var(--primary) 5%, transparent)" } : undefined}
                              >
                                <input
                                  type="radio"
                                  name={`vote-${task.id}`}
                                  value={opt.id}
                                  checked={isSelected}
                                  disabled={isClosed}
                                  onChange={() => {
                                    setSelectedOptions((prev) => ({ ...prev, [task.id]: opt.id }));
                                  }}
                                  className="accent-[var(--primary)]"
                                />
                                <span className="text-sm flex-1">{opt.label}</span>
                                {(isClosed || hasResults) && (
                                  <span className="text-xs text-[var(--muted-foreground)]">
                                    {opt._count.votes} vote{opt._count.votes !== 1 ? "s" : ""}
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {!isClosed && (
                        <div className="flex justify-end">
                          <button
                            onClick={() => handleVote(task.id)}
                            disabled={!selectedOptions[task.id]}
                            className="px-4 py-1.5 text-sm rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                          >
                            {userVote ? "Change Vote" : "Vote"}
                          </button>
                        </div>
                      )}

                      {(isClosed || hasResults) && totalVotes > 0 && (
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {totalVotes} total vote{totalVotes !== 1 ? "s" : ""}
                        </p>
                      )}
                    </div>
                  );
                }

                // Checkbox task (default)
                return (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 p-2 border border-[var(--border)] rounded-lg"
                  >
                    <span className="shrink-0 text-[var(--primary)]">
                      {task.completed ? <CheckSquare size={18} /> : <Square size={18} />}
                    </span>
                    <span
                      className={`flex-1 text-sm ${task.completed ? "line-through text-[var(--muted-foreground)]" : ""}`}
                    >
                      {task.title}
                    </span>
                    {task.dueDate && (
                      <span className="text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)]">
                        {formatDateDisplay(task.dueDate)}
                      </span>
                    )}
                  </div>
                );
              })}
              {tasks.length === 0 && (
                <div className="text-center py-8">
                  <ListTodo size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
                  <p className="text-sm text-[var(--muted-foreground)]">
                    No tasks yet.
                  </p>
                </div>
              )}
            </div>
            <div className="mt-3">
              <Pagination page={tasksPage} totalPages={tasksTotalPages} onPageChange={setTasksPage} />
            </div>
          </div>
        )}

        {/* Files Tab -- From agent-a6c3c855: unified files + documents section */}
        {activeTab === "files" && (() => {
          // Sort: documents needing action first, then by date descending
          const sortedFiles = [...project.files].sort((a, b) => {
            const aAction = a.documentType && (a.documentStatus === "pending" || a.documentStatus === "viewed") ? 1 : 0;
            const bAction = b.documentType && (b.documentStatus === "pending" || b.documentStatus === "viewed") ? 1 : 0;
            if (aAction !== bAction) return bAction - aAction;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });

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
                {sortedFiles.map((file) => {
                  const isDoc = !!file.documentType;
                  const needsAction = isDoc && (file.documentStatus === "pending" || file.documentStatus === "viewed");
                  const statusStyle = file.documentStatus ? DOC_STATUS_STYLES[file.documentStatus] || DOC_STATUS_STYLES.pending : null;
                  const typeStyle = file.documentType ? DOC_TYPE_STYLES[file.documentType] || DOC_TYPE_STYLES.other : null;

                  return (
                    <div
                      key={file.id}
                      className={`p-3 border rounded-lg ${
                        needsAction
                          ? "border-amber-200 bg-amber-50/30"
                          : "border-[var(--border)]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          {isDoc && (
                            <FileText size={18} className="text-[var(--primary)] shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {isDoc ? (
                                <button
                                  onClick={() => setViewingFile(file)}
                                  className="text-sm font-medium truncate text-[var(--primary)] hover:underline text-left"
                                >
                                  {file.documentTitle || file.filename}
                                </button>
                              ) : (
                                <p className="text-sm font-medium truncate">
                                  {file.filename}
                                </p>
                              )}
                              {isDoc && typeStyle && (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${typeStyle.bg} ${typeStyle.text}`}>
                                  {DOC_TYPE_LABELS[file.documentType!] || file.documentType}
                                </span>
                              )}
                              {isDoc && statusStyle && (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                                  {statusStyle.label}
                                </span>
                              )}
                              {needsAction && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600">
                                  Action Required
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[var(--muted-foreground)]">
                              {isDoc && file.documentTitle ? file.filename + " \u00B7 " : ""}
                              {formatBytes(file.sizeBytes)}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDownload(file.id, file.filename)}
                          className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline shrink-0"
                        >
                          <Download size={14} />
                          Download
                        </button>
                      </div>
                      {/* Document action buttons */}
                      {needsAction && (
                        <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--border)]">
                          <button
                            onClick={() => handleFileDocumentRespond(file.id, "accepted")}
                            disabled={respondingTo === file.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
                          >
                            <Check size={14} />
                            Accept
                          </button>
                          <button
                            onClick={() => { setViewingFile(file); setViewingFileDecline(true); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50"
                          >
                            <X size={14} />
                            Decline
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {project.files.length === 0 && documents.length === 0 && (
                  <div className="text-center py-8">
                    <FileX size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
                    <p className="text-sm text-[var(--muted-foreground)]">
                      No files shared yet.
                    </p>
                  </div>
                )}
              </div>

              {/* Documents section -- separate document records with signing, viewer, and confirmation features */}
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
                      const hasResponded = doc.responses.length > 0;
                      const lastResponse = hasResponded ? doc.responses[0] : null;
                      const actions = docActions[doc.type] || ["acknowledged"];

                      return (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between p-3 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)]/50 transition-colors"
                        >
                          {/* From agent-acabd59e: clickable doc title to open viewer */}
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
                            {hasResponded && lastResponse ? (
                              <span
                                className="text-xs px-2 py-1 rounded-full font-medium"
                                style={{
                                  backgroundColor:
                                    lastResponse.action === "declined"
                                      ? "#fee2e2"
                                      : "#dcfce7",
                                  color:
                                    lastResponse.action === "declined"
                                      ? "#b91c1c"
                                      : "#15803d",
                                }}
                              >
                                {lastResponse.action.charAt(0).toUpperCase() +
                                  lastResponse.action.slice(1)}
                              </span>
                            ) : (
                              <>
                                {/* From agent-a3c3fd72: use confirmation dialog instead of direct respond */}
                                {actions.includes("accepted") && (
                                  <>
                                    <button
                                      onClick={() =>
                                        openDocumentConfirm(doc, "accepted")
                                      }
                                      className="px-3 py-1 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90"
                                      style={{ backgroundColor: "#15803d" }}
                                    >
                                      Accept
                                    </button>
                                    <button
                                      onClick={() =>
                                        openDocumentConfirm(doc, "declined")
                                      }
                                      className="px-3 py-1 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90"
                                      style={{ backgroundColor: "#b91c1c" }}
                                    >
                                      Decline
                                    </button>
                                  </>
                                )}
                                {!actions.includes("accepted") && (
                                  <button
                                    onClick={() =>
                                      openDocumentConfirm(doc, "acknowledged")
                                    }
                                    className="px-3 py-1 text-xs font-medium rounded-lg bg-[var(--primary)] text-white transition-opacity hover:opacity-90"
                                  >
                                    Acknowledge
                                  </button>
                                )}
                              </>
                            )}
                          </div>
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

      {/* From agent-acabd59e: Document Viewer Modal */}
      {viewingDoc && (
        <DocumentViewer
          documentId={viewingDoc.id}
          title={viewingDoc.title}
          typeLabel={docTypeLabels[viewingDoc.type] || viewingDoc.type}
          mimeType={viewingDoc.file.mimeType}
          fileId={viewingDoc.file.id}
          filename={viewingDoc.file.filename}
          hasResponded={viewingDoc.responses.length > 0}
          lastResponseAction={viewingDoc.responses[0]?.action}
          actions={docActions[viewingDoc.type] || ["acknowledged"]}
          onRespond={async (action) => {
            await handleDocumentRespond(viewingDoc.id, action);
          }}
          onClose={() => setViewingDoc(null)}
        />
      )}

      {/* File-based Document Viewer Modal */}
      {viewingFile && (
        <DocumentViewer
          documentId={viewingFile.id}
          title={viewingFile.documentTitle || viewingFile.filename}
          typeLabel={viewingFile.documentType ? (DOC_TYPE_LABELS[viewingFile.documentType] || viewingFile.documentType) : "File"}
          mimeType={viewingFile.mimeType}
          fileId={viewingFile.id}
          filename={viewingFile.filename}
          hasResponded={viewingFile.documentStatus !== "pending" && viewingFile.documentStatus !== "viewed"}
          lastResponseAction={viewingFile.documentStatus === "accepted" ? "accepted" : viewingFile.documentStatus === "rejected" ? "declined" : undefined}
          actions={viewingFile.documentType === "nda" ? ["acknowledged"] : ["accepted", "declined"]}
          useFileEndpoint
          initialDecline={viewingFileDecline}
          onRespond={async (action, reason) => {
            await handleFileDocumentRespond(viewingFile.id, action === "declined" ? "rejected" : action as "accepted" | "rejected", reason);
            setViewingFile(null);
            setViewingFileDecline(false);
          }}
          onClose={() => { setViewingFile(null); setViewingFileDecline(false); }}
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
                : pendingDocAction.action === "declined"
                  ? "Decline Document"
                  : "Acknowledge Document"}
            </h3>
            <div className="text-sm text-[var(--muted-foreground)] space-y-2">
              <p>
                Are you sure you want to{" "}
                <span className="font-medium text-[var(--foreground)]">
                  {pendingDocAction.action === "accepted"
                    ? "accept"
                    : pendingDocAction.action === "declined"
                      ? "decline"
                      : "acknowledge"}
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
                    : pendingDocAction.action === "declined"
                      ? "Confirm Decline"
                      : "Confirm Acknowledge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
