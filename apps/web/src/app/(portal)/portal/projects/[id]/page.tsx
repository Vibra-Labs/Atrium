"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { useCachedApi } from "@/lib/cached";
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
  ExternalLink,
  Link as LinkIcon,
  Pencil,
  ArrowLeft,
  Send,
  CreditCard,
  CheckCircle2,
} from "lucide-react";
import { PortalDeliverableReview, type PortalDeliverable } from "./components/portal-deliverable-review";
import { deliverableStatus } from "@/lib/deliverable";
import { PortalInvoicesSection } from "./components/portal-invoices-section";
import { linkify } from "@/lib/linkify";
import { Embeds, type PreviewPrefs } from "@/lib/embeds";
import { downloadFile } from "@/lib/download";
import { track } from "@/lib/track";
import { SigningViewer } from "@/components/signing-viewer";
import { DocumentViewer } from "@/components/document-viewer";
import { useToast } from "@/components/toast";
import { CommentsSection } from "@/components/comments-section";
import { Avatar } from "@/components/avatar";
import { TaskDetailModal } from "@/components/task-detail-modal";
import { getTaskStatusBadge, getTaskStatusLabel } from "@/lib/task-status";
import { formatCurrency } from "@/lib/format";
import { useCurrency } from "@/lib/app-config";
import { usePreviewMode } from "@/lib/preview-mode";

interface FileRecord {
  id: string;
  filename: string;
  type?: "UPLOAD" | "LINK";
  mimeType?: string | null;
  sizeBytes?: number | null;
  url?: string | null;
  description?: string | null;
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
  /** Open decision tasks this client hasn't voted on, across all task pages. */
  openVotes?: number;
  organization?: {
    name: string;
    members?: { user: { id: string; name: string; email: string; image?: string | null } }[];
  };
}

interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  status: string;
  type: string;
  amount?: number | null;
  dueDate?: string | null;
  notes?: string | null;
  lineItems: { id: string; description: string; quantity: number; unitPrice: number }[];
}

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
  file: { id: string; filename: string; mimeType: string; sizeBytes: number; type?: "UPLOAD" | "LINK"; url?: string | null };
  currentVersion?: number;
  requestNote?: string | null;
  decision?: PortalDeliverable["decision"];
  responses: { id: string; action: string; createdAt: string; fieldId?: string; reason?: string }[];
  createdAt: string;
  sentAt?: string | null;
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
  deliverable: "For approval",
};

const docActions: Record<string, string[]> = {
  quote: ["accepted", "declined"],
  contract: ["accepted", "declined"],
  proposal: ["accepted", "declined"],
  nda: ["accepted", "declined"],
  other: ["accepted", "declined"],
  deliverable: ["accepted", "declined"],
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
  const statuses: ProjectStatus[] = useCachedApi<ProjectStatus[]>("/projects/statuses") ?? [];
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
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && tabs.some((t) => t.id === tabParam)) return tabParam as TabId;
    if (searchParams.get("task")) return "tasks";
    return "updates";
  });

  // When a ?task=<id> deep link is set, jump to the Tasks tab so the detail
  // modal can open (it's rendered inside the tasks tab).
  // When a ?tab=<id> deep link is set (e.g. from a notification email), jump to
  // it so the client lands on what the notification was about.
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && tabs.some((t) => t.id === tabParam)) {
      setActiveTab(tabParam as TabId);
      return;
    }
    if (searchParams.get("task")) setActiveTab("tasks");
  }, [searchParams]);
  const [uploading, setUploading] = useState(false);
  const [signingDocId, setSigningDocId] = useState<string | null>(null);
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);
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
  const { userId } = useSession();
  const currentUserId: string | null = userId || null;
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const currency = useCurrency();
  const { preview } = usePreviewMode();
  const session = useSession();
  const [latestInvoice, setLatestInvoice] = useState<InvoiceSummary | null>(null);
  const [quickReplyText, setQuickReplyText] = useState("");
  const [sendingQuickReply, setSendingQuickReply] = useState(false);

  useEffect(() => {
    apiFetch<PaginatedResponse<InvoiceSummary>>(`/invoices/mine?projectId=${id}&limit=5`)
      .then((res) => {
        if (res.data && res.data.length > 0) {
          const unpaid = res.data.find((i) => i.status === "sent" || i.status === "overdue");
          setLatestInvoice(unpaid || res.data[0]);
        }
      })
      .catch(() => {});
  }, [id]);

  const handleSendQuickReply = async () => {
    if (!quickReplyText.trim() || sendingQuickReply) return;
    setSendingQuickReply(true);
    try {
      await apiFetch("/updates", {
        method: "POST",
        body: JSON.stringify({ projectId: id, content: quickReplyText.trim() }),
      });
      setQuickReplyText("");
      loadUpdates();
      toast.success("Reply sent");
    } catch {
      toast.error("Failed to post reply");
    } finally {
      setSendingQuickReply(false);
    }
  };

  const handleDownloadInvoicePdf = async (invoiceId: string, invoiceNumber: string) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ""}/api/invoices/mine/${invoiceId}/pdf`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice-${invoiceNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download invoice PDF");
    }
  };

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

  useEffect(() => {
    const d = searchParams.get("doc");
    if (d) {
      setActiveTab("files");
      setReviewDocId(d);
    }
  }, [searchParams]);

  const closeReview = (): void => {
    setReviewDocId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("doc");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  const needsReview = documents.filter(
    (d) => d.status === "pending" && (d.type === "deliverable" ? !d.decision : d.responses.length === 0),
  );

  // Items that need an action from this client (FYI documents don't count)
  const pendingDocActions = documents.filter((d) => {
    if (d.status !== "pending") return false;
    if (d.type === "deliverable") return !d.decision;
    if (d.requiresApproval) return d.responses.filter((r) => r.action !== "signed").length === 0;
    if (d.requiresSignature && d.signatureFields && d.signatureFields.length > 0) {
      const signedIds = d.responses.filter((r) => r.action === "signed" && r.fieldId).map((r) => r.fieldId);
      return !d.signatureFields.every((f) => signedIds.includes(f.id));
    }
    return false;
  });
  const toSignCount = pendingDocActions.filter((d) => d.type !== "deliverable" && !d.requiresApproval).length;
  const toApproveCount = pendingDocActions.length - toSignCount;
  const openVoteCount: number = project?.openVotes ?? 0;
  const actionTotal = toApproveCount + toSignCount + openVoteCount;

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

  const handlePrefsChange = async (updateId: string, next: PreviewPrefs) => {
    // Optimistic — prefs are display state, tolerate PATCH failures silently.
    setUpdates((prev) =>
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

  const handleStartEdit = (entry: TimelineEntry): void => {
    setEditingId(entry.id);
    setEditDraft(entry.content || "");
  };

  const handleCancelEdit = (): void => {
    setEditingId(null);
    setEditDraft("");
  };

  const handleSaveEdit = async (updateId: string): Promise<void> => {
    const content = editDraft.trim();
    if (!content) return;
    setSavingEdit(true);
    try {
      await apiFetch(`/updates/${updateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      toast.success("Update edited");
      setEditingId(null);
      setEditDraft("");
      loadUpdates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to edit update");
    } finally {
      setSavingEdit(false);
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
      track("portal_request_posted");
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
      track("portal_document_responded", { action });
      loadDocuments();
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadProject();
    loadDocuments();
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
      // Extension only. File names carry client and project detail.
      const ext: string = filename.includes(".")
        ? filename.split(".").pop()!.toLowerCase().slice(0, 8)
        : "none";
      track("portal_file_downloaded", { type: ext });
    } catch (err) {
      console.error(err);
    }
  };

  if (!project) return <ProjectDetailSkeleton />;

  const currentStatus = statuses.find((s) => s.slug === project.status);
  const clientName = preview?.clientName || session.userName || "there";
  const clientFirstName = clientName.split(" ")[0] || "there";
  const agencyName = project.organization?.name || "your team";
  const projectLead = project.organization?.members?.[0]?.user;
  const projectLeadName = projectLead?.name || agencyName;
  const projectLeadInitials = projectLeadName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const highlightedReviewItem = needsReview[0] || null;

  const defaultPhases = [
    { key: "discovery", label: "Discovery" },
    { key: "in_progress", label: "Execution" },
    { key: "review", label: "Review" },
    { key: "completed", label: "Launch" },
  ];

  const phases =
    statuses.length >= 3
      ? statuses.slice(0, 4).map((s) => ({ key: s.slug, label: s.name }))
      : defaultPhases;

  const currentStatusIndex = Math.max(
    0,
    phases.findIndex(
      (p) =>
        p.key === project.status ||
        p.label.toLowerCase() === project.status?.toLowerCase(),
    ),
  );

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
      )}

      {/* Top Greeting & Back Button */}
      <div>
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-2"
        >
          <ArrowLeft size={14} />
          All projects
        </button>
        <p className="text-sm text-[var(--muted-foreground)]">Hi {clientFirstName},</p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--foreground)] mt-0.5">
          Here&apos;s where your {project.name} stands
        </h1>
      </div>

      {/* Project Status & Milestone Track Card */}
      <section className="p-5 sm:p-6 rounded-2xl bg-[var(--background)] border border-[var(--border)] space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-bold text-[var(--foreground)]">{project.name}</h2>
            {currentStatus && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: `color-mix(in srgb, ${currentStatus.color} 15%, transparent)`,
                  color: currentStatus.color,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: currentStatus.color }}
                />
                {currentStatus.name}
              </span>
            )}
          </div>
          {project.endDate && (
            <span className="text-xs sm:text-sm text-[var(--muted-foreground)]">
              Launch planned for{" "}
              <strong className="text-[var(--foreground)] font-semibold">
                {new Date(project.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </strong>
            </span>
          )}
        </div>

        <ol className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {phases.map((phase, idx) => {
            const isDone = idx < currentStatusIndex;
            const isCurrent = idx === currentStatusIndex;
            return (
              <li key={phase.key} className="flex flex-col gap-2">
                <span
                  className={`h-1.5 rounded-full ${
                    isDone
                      ? "bg-[var(--primary)]"
                      : isCurrent
                        ? "bg-gradient-to-r from-[var(--primary)] to-[var(--border)]"
                        : "bg-[var(--border)]"
                  }`}
                />
                <span
                  className={`text-xs sm:text-sm font-semibold truncate ${
                    isCurrent
                      ? "text-[var(--primary)]"
                      : isDone
                        ? "text-[var(--foreground)]"
                        : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {phase.label}
                </span>
                <span className="text-[11px] sm:text-xs text-[var(--muted-foreground)]">
                  {isDone
                    ? "Completed"
                    : isCurrent
                      ? "Now · In progress"
                      : idx === phases.length - 1 && project.endDate
                        ? new Date(project.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                        : "Upcoming"}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column (2 cols) */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {/* Actionable "Needs your review" Deliverable Highlight */}
          {highlightedReviewItem && (
            <section className="p-5 sm:p-6 rounded-2xl bg-[var(--background)] border-2 border-[var(--primary)] space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex px-2.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] text-xs font-semibold">
                  Needs your review
                </span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {formatDateDisplay(highlightedReviewItem.createdAt)}
                </span>
              </div>
              <div className="flex gap-4 items-center">
                <div className="w-20 sm:w-28 h-16 sm:h-20 rounded-lg bg-[var(--muted)] border border-[var(--border)] flex flex-col items-center justify-center shrink-0 text-[var(--muted-foreground)]">
                  <FileText size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-[var(--foreground)] truncate">
                    {highlightedReviewItem.title}
                  </h3>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    {highlightedReviewItem.file.filename}
                    {highlightedReviewItem.file.sizeBytes ? ` · ${formatBytes(highlightedReviewItem.file.sizeBytes)}` : ""}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-1.5 line-clamp-2">
                    {highlightedReviewItem.requestNote || "Leave comments on the file, then approve or ask for changes."}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {highlightedReviewItem.type === "deliverable" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setReviewDocId(highlightedReviewItem.id)}
                      className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-xs sm:text-sm font-semibold hover:opacity-90 transition-opacity"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewDocId(highlightedReviewItem.id)}
                      className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)] text-xs sm:text-sm font-semibold hover:bg-[var(--muted)] transition-colors"
                    >
                      Request changes
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewDocId(highlightedReviewItem.id)}
                      className="text-xs sm:text-sm font-semibold text-[var(--primary)] hover:underline ml-1"
                    >
                      Open file
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => openDocumentConfirm(highlightedReviewItem, "accepted")}
                      className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-xs sm:text-sm font-semibold hover:opacity-90 transition-opacity"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => openDocumentConfirm(highlightedReviewItem, "declined")}
                      className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)] text-xs sm:text-sm font-semibold hover:bg-[var(--muted)] transition-colors"
                    >
                      Request changes
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewingDoc(highlightedReviewItem)}
                      className="text-xs sm:text-sm font-semibold text-[var(--primary)] hover:underline ml-1"
                    >
                      Open file
                    </button>
                  </>
                )}
              </div>
            </section>
          )}

          {/* Pending actions banner for other items */}
          {(() => {
            if (actionTotal === 0 || highlightedReviewItem) return null;
            const parts: string[] = [];
            if (toApproveCount > 0) parts.push(`${toApproveCount} to approve`);
            if (toSignCount > 0) parts.push(`${toSignCount} to sign`);
            if (openVoteCount > 0) parts.push(`${openVoteCount} ${openVoteCount === 1 ? "vote" : "votes"}`);
            return (
              <button
                onClick={() => setActiveTab(toApproveCount + toSignCount === 0 ? "tasks" : "files")}
                className="w-full p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl flex items-center gap-3 text-left hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
              >
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-white text-sm font-bold shrink-0">
                  {actionTotal}
                </span>
                <div>
                  <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                    {actionTotal === 1 ? "1 item to review" : `${actionTotal} items to review`}
                  </p>
                  <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">{parts.join(" · ")}</p>
                </div>
              </button>
            );
          })()}

        <div className="relative mb-6">
          <div className="flex overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {tabs.map((tab) => {
              const pendingCount = tab.id === "files"
                ? toApproveCount + toSignCount
                : tab.id === "tasks"
                  ? openVoteCount
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
                    version_uploaded: "uploaded a new version of",
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
                const isOwnUpdate =
                  currentUserId !== null &&
                  entry.author?.id === currentUserId;
                const isEditing = editingId === entry.id;
                const wasEdited =
                  !!entry.updatedAt &&
                  new Date(entry.updatedAt).getTime() -
                    new Date(entry.createdAt).getTime() >
                    2 * 60 * 1000;
                return (
                  <div
                    key={entry.id}
                    className="border border-[var(--border)] rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium">{entry.author?.name}</span>
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {formatRelativeTime(entry.createdAt)}
                        </span>
                        {wasEdited && (
                          <span
                            data-testid="update-edited-indicator"
                            className="text-xs text-[var(--muted-foreground)] italic"
                          >
                            (edited)
                          </span>
                        )}
                      </div>
                      {isOwnUpdate && !isEditing && (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(entry)}
                          aria-label="Edit update"
                          data-testid={`edit-update-${entry.id}`}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        >
                          <Pencil size={12} />
                          Edit
                        </button>
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
                            type="button"
                            onClick={handleCancelEdit}
                            disabled={savingEdit}
                            className="px-3 py-1 border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(entry.id)}
                            disabled={savingEdit || !editDraft.trim()}
                            data-testid={`save-update-${entry.id}`}
                            className="px-3 py-1 bg-[var(--primary)] text-white rounded-lg text-xs hover:opacity-90 disabled:opacity-50"
                          >
                            {savingEdit ? "Saving..." : "Save"}
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
                        loading="lazy"
                        decoding="async"
                        className="mt-3 max-w-full max-h-80 min-h-32 rounded-lg border border-[var(--border)] object-contain"
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

            {/* Inline Quick Reply matching the artboard */}
            <div className="mt-6 pt-4 border-t border-[var(--border)] flex gap-2.5 items-center">
              <label htmlFor="portal-quick-reply" className="sr-only">Reply to {agencyName}</label>
              <input
                id="portal-quick-reply"
                value={quickReplyText}
                onChange={(e) => setQuickReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendQuickReply();
                  }
                }}
                placeholder={`Reply to ${agencyName}...`}
                className="flex-1 min-w-0 px-3.5 py-2.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
              <button
                type="button"
                onClick={handleSendQuickReply}
                disabled={sendingQuickReply || !quickReplyText.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
              >
                <Send size={14} />
                <span>Send</span>
              </button>
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
                const isOwnRequest = currentUserId !== null && task.requestedById === currentUserId;

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
              {needsReview.some((d) => d.type === "deliverable") && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold mb-2.5 text-[var(--foreground)]">Needs your review</h3>
                  <div className="space-y-2.5">
                    {needsReview.filter((d) => d.type === "deliverable").map((d) => (
                      <div
                        key={d.id}
                        data-testid={`needs-review-${d.id}`}
                        className="p-4 border border-amber-300/80 bg-amber-50/90 dark:border-amber-700/40 dark:bg-amber-950/30 rounded-xl flex items-center justify-between gap-4 shadow-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-amber-950 dark:text-amber-100 truncate">
                            {d.title}
                            {(d.currentVersion ?? 1) > 1 && (
                              <span className="ml-2 text-xs font-normal text-amber-800/80 dark:text-amber-300/70">v{d.currentVersion}</span>
                            )}
                          </p>
                          {d.requestNote && (
                            <p className="text-xs text-amber-900/90 dark:text-amber-200/80 line-clamp-2 mt-1 leading-relaxed">
                              {d.requestNote}
                            </p>
                          )}
                          <p className="text-xs text-amber-800/70 dark:text-amber-400/70 mt-1">
                            sent {formatRelativeTime(d.sentAt ?? d.createdAt)}
                          </p>
                        </div>
                        <button
                          onClick={() => setReviewDocId(d.id)}
                          className="px-4 py-2 text-xs font-semibold rounded-lg text-white bg-[var(--primary)] hover:opacity-90 shrink-0 shadow-sm transition-opacity"
                        >
                          Review
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                  const isLink = file.type === "LINK";
                  let hostname = "";
                  if (isLink && file.url) {
                    try { hostname = new URL(file.url).hostname; } catch { hostname = file.url; }
                  }
                  const handleCardClick = () => {
                    if (isLink && file.url) {
                      window.open(file.url, "_blank", "noopener,noreferrer");
                    } else {
                      handleDownload(file.id, file.filename);
                    }
                  };
                  return (
                    <div
                      key={file.id}
                      role="button"
                      tabIndex={0}
                      onClick={handleCardClick}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleCardClick();
                        }
                      }}
                      className="p-3 border border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--muted)]/40 transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                    >
                      <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap">
                        <div className="min-w-0 flex items-start gap-2">
                          {isLink ? (
                            <LinkIcon size={14} className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" />
                          ) : (
                            <FileText size={14} className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {file.filename}
                            </p>
                            {isLink ? (
                              <p className="text-xs text-[var(--muted-foreground)] truncate">
                                {hostname}
                              </p>
                            ) : (
                              <p className="text-xs text-[var(--muted-foreground)]">
                                {formatBytes(file.sizeBytes ?? 0)}
                              </p>
                            )}
                            {isLink && file.description && (
                              <p className="text-xs text-[var(--muted-foreground)] mt-1">{file.description}</p>
                            )}
                          </div>
                        </div>
                        {isLink ? (
                          <ExternalLink size={14} className="text-[var(--muted-foreground)] shrink-0" />
                        ) : (
                          <Download size={14} className="text-[var(--muted-foreground)] shrink-0" />
                        )}
                      </div>
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
                              onClick={() => (doc.type === "deliverable" ? setReviewDocId(doc.id) : setViewingDoc(doc))}
                              className="flex items-center gap-3 min-w-0 text-left cursor-pointer flex-1"
                              data-testid={`view-document-${doc.id}`}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate text-[var(--primary)] hover:underline">{doc.title}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {doc.type !== "deliverable" && (
                                    <span className="text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)] whitespace-nowrap shrink-0">
                                      {docTypeLabels[doc.type] || doc.type}
                                    </span>
                                  )}
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
                              {!(doc.type === "deliverable" && doc.file.type === "LINK") && (
                                <button
                                  onClick={() => handleDownload(doc.file.id, doc.file.filename)}
                                  className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
                                >
                                  <Download size={14} />
                                </button>
                              )}
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
                              {doc.type === "deliverable" && !isReadOnly && (
                                <>
                                  <span className="text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap shrink-0" style={{ backgroundColor: deliverableStatus(doc.status).bg, color: deliverableStatus(doc.status).text }}>
                                    {deliverableStatus(doc.status).label}
                                  </span>
                                  <button onClick={() => setReviewDocId(doc.id)} className="px-3 py-1 text-xs font-medium rounded-lg text-white bg-[var(--primary)] hover:opacity-90">Review</button>
                                </>
                              )}
                              {doc.type !== "deliverable" && !isReadOnly && !hasOptions && (
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

      {/* Right Column (1 col) */}
      <div className="space-y-6 lg:sticky lg:top-6 min-w-0">
        {/* Active Invoice Card */}
        {latestInvoice && (
          <section className="p-5 sm:p-6 rounded-2xl bg-[var(--background)] border border-[var(--border)] space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--foreground)]">Invoice #{latestInvoice.invoiceNumber}</h2>
              {latestInvoice.dueDate && (
                <span className="text-xs text-[var(--muted-foreground)]">
                  Due {new Date(latestInvoice.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
            <p className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--foreground)]">
              {formatCurrency(
                (latestInvoice.amount ?? latestInvoice.lineItems?.reduce((s, item) => s + (item.quantity * item.unitPrice), 0)) || 0,
                currency,
              )}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] line-clamp-2">
              {latestInvoice.notes || latestInvoice.lineItems?.[0]?.description || "Project milestone"}
            </p>
            <button
              type="button"
              onClick={() => setActiveTab("invoices")}
              className="w-full py-2.5 px-4 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 transition-opacity text-center"
            >
              Pay invoice
            </button>
            <div>
              <button
                type="button"
                onClick={() => handleDownloadInvoicePdf(latestInvoice.id, latestInvoice.invoiceNumber)}
                className="text-xs font-semibold text-[var(--primary)] hover:underline inline-block"
              >
                Download PDF
              </button>
            </div>
          </section>
        )}

        {/* Recent Files Card */}
        <section className="p-5 sm:p-6 rounded-2xl bg-[var(--background)] border border-[var(--border)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-[var(--foreground)]">Recent files</h2>
            <button
              type="button"
              onClick={() => setActiveTab("files")}
              className="text-xs font-semibold text-[var(--primary)] hover:underline"
            >
              All files
            </button>
          </div>
          {project.files && project.files.length > 0 ? (
            <ul className="divide-y divide-[var(--border)]">
              {project.files.slice(0, 4).map((f) => (
                <li
                  key={f.id}
                  onClick={() => handleDownload(f.id, f.filename)}
                  className="py-2.5 flex items-center gap-2.5 cursor-pointer hover:text-[var(--primary)] transition-colors group"
                >
                  <FileText size={16} className="text-[var(--muted-foreground)] group-hover:text-[var(--primary)] shrink-0" />
                  <span className="text-xs font-medium truncate flex-1">{f.filename}</span>
                  <span className="text-[11px] text-[var(--muted-foreground)] shrink-0">
                    {new Date(f.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--muted-foreground)] py-2">No files shared yet.</p>
          )}
        </section>

        {/* Project Lead Card */}
        <section className="p-4 sm:p-5 rounded-2xl bg-[var(--background)] border border-[var(--border)] flex items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center text-xs font-bold shrink-0">
            {projectLeadInitials || "TL"}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate text-[var(--foreground)]">{projectLeadName}</p>
            <p className="text-xs text-[var(--muted-foreground)] truncate">Your project lead at {agencyName}</p>
          </div>
        </section>
      </div>
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
            onChange={() => {
              loadTasks();
              loadProject();
            }}
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

      {(() => {
        const reviewDoc = documents.find((d) => d.id === reviewDocId && d.type === "deliverable");
        if (!reviewDoc) return null;
        return (
          <PortalDeliverableReview
            doc={{ ...reviewDoc, decision: reviewDoc.decision ?? null }}
            onClose={closeReview}
            onDecided={() => {
              loadDocuments();
              loadProject();
              closeReview();
            }}
          />
        );
      })()}

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
