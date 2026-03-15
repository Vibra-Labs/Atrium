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
} from "lucide-react";
import { PortalInvoicesSection } from "./components/portal-invoices-section";
import { linkify } from "@/lib/linkify";
import { downloadFile } from "@/lib/download";

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

interface DocumentRecord {
  id: string;
  type: string;
  title: string;
  status: string;
  file: { id: string; filename: string; sizeBytes: number };
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

export default function PortalProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [updates, setUpdates] = useState<ProjectUpdateRecord[]>([]);
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

  const loadProject = useCallback(() => {
    apiFetch<Project>(`/projects/mine/${id}`)
      .then(setProject)
      .catch((err) => setError(err.message || "Failed to load project"));
  }, [id]);

  const loadUpdates = useCallback(() => {
    apiFetch<PaginatedResponse<ProjectUpdateRecord>>(
      `/updates/mine/${id}?page=${updatesPage}&limit=10`,
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
    <div className="flex gap-8">
      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
      )}

      {/* Left sidebar */}
      <aside className="w-72 shrink-0 sticky top-8 space-y-4">
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

      {/* Right content area — tabbed sections */}
      <div className="flex-1 min-w-0">
        <div className="flex border-b border-[var(--border)] mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--border)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Updates Tab */}
        {activeTab === "updates" && (
          <div>
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
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium">{update.author.name}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {formatRelativeTime(update.createdAt)}
                      </span>
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
                            ? handleDownload(update.fileId, update.attachmentName || "download")
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
                                {isClosed && (
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

                      {isClosed && totalVotes > 0 && (
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

        {/* Files Tab */}
        {activeTab === "files" && (
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
              {project.files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-3 border border-[var(--border)] rounded-lg"
                >
                  <div>
                    <p className="text-sm font-medium">{file.filename}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {formatBytes(file.sizeBytes)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDownload(file.id, file.filename)}
                    className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
                  >
                    <Download size={14} />
                    Download
                  </button>
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
                    const hasResponded = doc.responses.length > 0;
                    const lastResponse = hasResponded ? doc.responses[0] : null;
                    const actions = docActions[doc.type] || ["acknowledged"];

                    return (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between p-3 border border-[var(--border)] rounded-lg"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{doc.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)]">
                                {docTypeLabels[doc.type] || doc.type}
                              </span>
                              <span className="text-xs text-[var(--muted-foreground)]">
                                {formatBytes(doc.file.sizeBytes)}
                              </span>
                            </div>
                          </div>
                        </div>
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
                              {actions.includes("accepted") && (
                                <>
                                  <button
                                    onClick={() =>
                                      handleDocumentRespond(doc.id, "accepted")
                                    }
                                    className="px-3 py-1 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90"
                                    style={{ backgroundColor: "#15803d" }}
                                  >
                                    Accept
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleDocumentRespond(doc.id, "declined")
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
                                    handleDocumentRespond(doc.id, "acknowledged")
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
        )}

        {/* Invoices Tab */}
        {activeTab === "invoices" && (
          <PortalInvoicesSection projectId={id} />
        )}
      </div>
    </div>
  );
}
