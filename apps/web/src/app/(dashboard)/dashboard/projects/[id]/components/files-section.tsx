"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { formatBytes, formatRelativeTime } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import {
  Upload,
  Download,
  Trash2,
  FileX,
  ChevronDown,
  ChevronRight,
  PenTool,
  Send,
  Ban,
  Award,
  History,
  X,
  File as FileIcon,
  FilePlus,
  RotateCcw,
  Link2,
  Copy,
  XCircle,
  ExternalLink,
  LinkIcon,
  Plus,
  Pencil,
} from "lucide-react";
import { track } from "@/lib/track";
import { downloadFile } from "@/lib/download";
import dynamic from "next/dynamic";

const SignatureFieldPlacer = dynamic(
  () => import("@/components/signature-field-placer").then((m) => m.SignatureFieldPlacer),
  { ssr: false },
);

const SigningViewer = dynamic(
  () => import("@/components/signing-viewer").then((m) => m.SigningViewer),
  { ssr: false },
);

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

interface DocumentResponse {
  id: string;
  userId: string;
  action: string;
  createdAt: string;
  signedAt?: string;
  signatureMethod?: string;
  fieldId?: string;
  user: { id: string; name: string };
}

interface DocumentFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

interface DocumentVersion {
  id: string;
  version: number;
  file: { id: string; filename: string; sizeBytes: number };
  uploadedBy?: { id: string; name: string };
  createdAt: string;
}

interface DocumentRecord {
  id: string;
  type: string;
  title: string;
  status: string;
  requiresSignature: boolean;
  signedFileId?: string;
  signedFile?: DocumentFile;
  file: DocumentFile;
  signatureFields?: { id: string }[];
  responses: DocumentResponse[];
  versions?: DocumentVersion[];
  currentVersion?: number;
  createdAt: string;
  sentAt?: string;
  expiresAt?: string;
  voidReason?: string;
  options?: string;
}

interface AuditEvent {
  id: string;
  action: string;
  createdAt: string;
  ipAddress?: string;
  user?: { id: string; name: string; email: string } | null;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const typeLabels: Record<string, string> = {
  quote: "Quote",
  contract: "Contract",
  proposal: "Proposal",
  nda: "NDA",
  other: "Other",
};

import { documentStatusColors as statusColors } from "@/lib/status-colors";

export function FilesSection({
  projectId,
  isArchived,
  files,
  onFileChange,
  projectClients: projectClientsProp = [],
  currentRole = null,
}: {
  projectId: string;
  isArchived: boolean;
  files: FileRecord[];
  onFileChange: () => void;
  projectClients?: { userId: string; user: { id: string; name: string; email: string } }[];
  currentRole?: string | null;
}) {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();

  // Document state
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [docsPage, setDocsPage] = useState(1);
  const [docsTotalPages, setDocsTotalPages] = useState(1);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [showDocUpload, setShowDocUpload] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [voidModalDocId, setVoidModalDocId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [auditTrail, setAuditTrail] = useState<AuditEvent[]>([]);
  const [showAuditDocId, setShowAuditDocId] = useState<string | null>(null);
  const [signingDocId, setSigningDocId] = useState<string | null>(null);
  const [signingLinksDocId, setSigningLinksDocId] = useState<string | null>(null);
  const [signingLinks, setSigningLinks] = useState<{
    id: string;
    userId: string;
    user: { id: string; name: string; email: string } | null;
    expiresAt: string;
    usedAt?: string;
    revokedAt?: string;
    createdAt: string;
    isActive: boolean;
  }[]>([]);
  const [projectClients, setProjectClients] = useState<{ userId: string; user: { id: string; name: string; email: string } }[]>([]);
  const [newLinkToken, setNewLinkToken] = useState<string | null>(null);
  const [placerDocId, setPlacerDocId] = useState<string | null>(null);

  // Add Link modal state
  const [showAddLink, setShowAddLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkDescription, setLinkDescription] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);

  // Edit file modal state
  const [editFile, setEditFile] = useState<FileRecord | null>(null);
  const [editFilename, setEditFilename] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const canManageFiles = currentRole === "owner" || currentRole === "admin";

  // Add menu (dropdown) state
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showAddMenu) return;
    const onClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showAddMenu]);

  // Doc upload form
  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState("contract");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [docQuestion, setDocQuestion] = useState("");
  const [docChoices, setDocChoices] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<number | "">("");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderIntervalDays, setReminderIntervalDays] = useState(3);

  const loadDocuments = useCallback(async () => {
    try {
      const res = await apiFetch<PaginatedResponse<DocumentRecord>>(
        `/documents/project/${projectId}?page=${docsPage}&limit=20`,
      );
      setDocuments(res.data);
      setDocsTotalPages(res.meta.totalPages);
    } catch (err) {
      console.error(err);
    }
  }, [projectId, docsPage]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const isPdf = docFile?.type === "application/pdf";

  const handleFileSelect = (file: File | null) => {
    setDocFile(file);
    if (file && !docTitle.trim()) {
      setDocTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
    if (file && file.type !== "application/pdf") {
      setRequiresSignature(false);
    }
  };

  const resetDocForm = () => {
    setDocTitle("");
    setDocType("contract");
    setDocFile(null);
    setRequiresSignature(false);
    setRequiresApproval(false);
    setDocQuestion("");
    setDocChoices([]);
    setShowAdvanced(false);
    setExpiresInDays("");
    setReminderEnabled(false);
    setReminderIntervalDays(3);
  };

  const handleFileDownload = async (fileId: string, filename: string) => {
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
      console.error(err);
    }
  };

  const handleFileDelete = async (fileId: string) => {
    const ok = await confirm({
      title: "Delete File",
      message: "Delete this file? This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/files/${fileId}`, { method: "DELETE" });
      onFileChange();
      success("File deleted");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete file");
    }
  };

  const resetLinkForm = () => {
    setLinkUrl("");
    setLinkTitle("");
    setLinkDescription("");
  };

  const openEditFile = (file: FileRecord): void => {
    setEditFile(file);
    setEditFilename(file.filename);
    setEditDescription(file.description ?? "");
    setEditUrl(file.url ?? "");
  };

  const closeEditFile = (): void => {
    setEditFile(null);
    setEditFilename("");
    setEditDescription("");
    setEditUrl("");
  };

  const handleEditFileSave = async (): Promise<void> => {
    if (!editFile) return;
    const nextFilename = editFilename.trim();
    if (!nextFilename) return;
    const body: { filename?: string; description?: string; url?: string } = {};
    if (nextFilename !== editFile.filename) {
      body.filename = nextFilename;
    }
    const nextDescription = editDescription.trim();
    const originalDescription = editFile.description ?? "";
    if (nextDescription !== originalDescription) {
      body.description = nextDescription;
    }
    if (editFile.type === "LINK") {
      const nextUrl = editUrl.trim();
      const originalUrl = editFile.url ?? "";
      if (nextUrl && nextUrl !== originalUrl) {
        body.url = nextUrl;
      }
    }
    if (Object.keys(body).length === 0) {
      closeEditFile();
      return;
    }
    setEditSaving(true);
    try {
      await apiFetch(`/files/${editFile.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      closeEditFile();
      onFileChange();
      success("File updated");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update file");
    } finally {
      setEditSaving(false);
    }
  };

  const handleLinkSubmit = async () => {
    const url = linkUrl.trim();
    const title = linkTitle.trim();
    if (!url || !title) return;
    setLinkSaving(true);
    try {
      await apiFetch("/files/link", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          url,
          title,
          description: linkDescription.trim() || undefined,
        }),
      });
      setShowAddLink(false);
      resetLinkForm();
      onFileChange();
      success("Link added");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to add link");
    } finally {
      setLinkSaving(false);
    }
  };

  // --- Document handlers ---
  const handleDocUpload = async (andSend: boolean) => {
    if (!docFile || !docTitle.trim()) return;
    setDocUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", docFile);
      formData.append("projectId", projectId);
      formData.append("type", docType);
      formData.append("title", docTitle);
      if (requiresSignature) formData.append("requiresSignature", "true");
      if (requiresApproval) formData.append("requiresApproval", "true");
      const validChoices = docChoices.map((c) => c.trim()).filter(Boolean);
      if (validChoices.length > 0) {
        // Store as "question|choice1,choice2,choice3"
        const optionsStr = docQuestion.trim()
          ? `${docQuestion.trim()}|${validChoices.join(",")}`
          : validChoices.join(",");
        formData.append("options", optionsStr);
      }
      if (reminderEnabled) {
        formData.append("reminderEnabled", "true");
        formData.append("reminderIntervalDays", String(reminderIntervalDays));
      }
      const doc = await apiFetch<DocumentRecord>("/documents", {
        method: "POST",
        body: formData,
      });
      track("document_uploaded", { type: docType });
      if (andSend) {
        const sendBody: Record<string, unknown> = {};
        if (expiresInDays && typeof expiresInDays === "number") sendBody.expiresInDays = expiresInDays;
        await apiFetch(`/documents/${doc.id}/send`, { method: "POST", body: JSON.stringify(sendBody) });
      }
      setShowDocUpload(false);
      resetDocForm();
      loadDocuments();
      success(andSend ? "Document uploaded and sent" : "Document saved as draft");
      if (requiresSignature && isPdf) setPlacerDocId(doc.id);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setDocUploading(false);
    }
  };

  const handleDocSend = async (docId: string) => {
    const ok = await confirm({ title: "Send Document", message: "Send this document to project clients? They will be notified by email.", confirmLabel: "Send" });
    if (!ok) return;
    try {
      await apiFetch(`/documents/${docId}/send`, { method: "POST", body: JSON.stringify({}) });
      loadDocuments();
      success("Document sent to clients");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to send document");
    }
  };

  const handleVoid = async () => {
    if (!voidModalDocId) return;
    try {
      await apiFetch(`/documents/${voidModalDocId}/void`, { method: "POST", body: JSON.stringify({ reason: voidReason.trim() || undefined }) });
      setVoidModalDocId(null);
      setVoidReason("");
      loadDocuments();
      success("Document voided");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to void document");
    }
  };

  const handleDocDownload = async (fileId: string, filename: string) => {
    try { await downloadFile(fileId, filename); } catch (err) { console.error(err); }
  };

  const handleDocDelete = async (docId: string) => {
    const ok = await confirm({ title: "Delete Document", message: "Delete this document and all responses? This cannot be undone.", confirmLabel: "Delete", variant: "danger" });
    if (!ok) return;
    try {
      await apiFetch(`/documents/${docId}`, { method: "DELETE" });
      loadDocuments();
      success("Document deleted");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete document");
    }
  };

  const handleDownloadCertificate = async (docId: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/documents/${docId}/certificate`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `certificate-${docId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to download certificate");
    }
  };

  const loadAuditTrail = async (docId: string) => {
    try {
      const res = await apiFetch<PaginatedResponse<AuditEvent>>(`/documents/${docId}/audit-trail?limit=50`);
      setAuditTrail(res.data);
      setShowAuditDocId(docId);
    } catch (err) { console.error(err); }
  };

  const openSigningLinks = async (docId: string) => {
    setSigningLinksDocId(docId);
    setNewLinkToken(null);
    setProjectClients(projectClientsProp);
    try {
      const tokens = await apiFetch<typeof signingLinks>(`/documents/${docId}/access-tokens`);
      setSigningLinks(tokens);
    } catch (err) {
      console.error(err);
    }
  };

  const generateSigningLink = async (docId: string, userId: string) => {
    try {
      const res = await apiFetch<{ token: string; expiresAt: string }>(`/documents/${docId}/generate-access-token`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      setNewLinkToken(res.token);
      // Refresh the list
      const tokens = await apiFetch<typeof signingLinks>(`/documents/${docId}/access-tokens`);
      setSigningLinks(tokens);
      success("Signing link created");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to create signing link");
    }
  };

  const revokeSigningLink = async (docId: string, tokenId: string) => {
    try {
      await apiFetch(`/documents/${docId}/access-tokens/${tokenId}`, { method: "DELETE" });
      const tokens = await apiFetch<typeof signingLinks>(`/documents/${docId}/access-tokens`);
      setSigningLinks(tokens);
      success("Signing link revoked");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to revoke link");
    }
  };

  const sortedFiles = [...files].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div>
      {/* Header with both upload actions */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">Files</h2>
        {!isArchived && (
          <div className="relative" ref={addMenuRef}>
            <button
              onClick={() => setShowAddMenu((v) => !v)}
              className="flex items-center gap-2 px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
            >
              <Plus size={14} />
              Add
              <ChevronDown size={12} />
            </button>
            {showAddMenu && (
              <div className="absolute right-0 mt-1 w-64 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg z-10 py-1">
                <button
                  onClick={() => { setShowAddMenu(false); setShowDocUpload(true); }}
                  className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-[var(--muted)] text-left"
                >
                  <Upload size={14} className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" />
                  <div>
                    <p className="text-sm font-medium">Upload file</p>
                    <p className="text-xs text-[var(--muted-foreground)]">Upload a document from your device</p>
                  </div>
                </button>
                <button
                  onClick={() => { setShowAddMenu(false); setShowAddLink(true); }}
                  className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-[var(--muted)] text-left"
                >
                  <LinkIcon size={14} className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" />
                  <div>
                    <p className="text-sm font-medium">Add link</p>
                    <p className="text-xs text-[var(--muted-foreground)]">Link to an external resource (Nextcloud, Canva, etc.)</p>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Documents list */}
      {documents.length > 0 && (
        <div className="space-y-2 mb-4">
          {documents.map((doc) => {
            const colors = statusColors[doc.status] || statusColors.pending;
            const isExpanded = expandedDocId === doc.id;
            const isDraft = doc.status === "draft";
            const isVoidable = doc.status === "draft" || doc.status === "pending";
            const needsSigning = doc.requiresSignature && doc.signatureFields && doc.signatureFields.length > 0;
            const signedFieldIds = doc.responses.filter((r) => r.action === "signed" && r.fieldId).map((r) => r.fieldId);
            const hasUnsignedFields = needsSigning && !doc.signatureFields!.every((f) => signedFieldIds.includes(f.id));

            return (
              <div key={doc.id} className="border border-[var(--border)] rounded-lg">
                <button
                  onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                  className="flex items-center justify-between w-full p-3 text-left hover:bg-[var(--muted)] transition-colors rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium">{doc.title}</p>
                        {(doc.currentVersion ?? 1) > 1 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)] font-medium">
                            v{doc.currentVersion}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {doc.file.filename} &middot; {formatBytes(doc.file.sizeBytes)}
                        {doc.expiresAt && <span> &middot; Expires {new Date(doc.expiresAt).toLocaleDateString()}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "#f3f4f6", color: "#374151" }}>
                      {typeLabels[doc.type] || doc.type}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: colors.bg, color: colors.text }}>
                      {doc.status}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 space-y-3 border-t border-[var(--border)]">
                    <div className="flex items-center gap-2 pt-3 flex-wrap">
                      {/* Primary action */}
                      {isDraft && !isArchived && (
                        <button
                          onClick={() => handleDocSend(doc.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)] text-white text-xs font-medium rounded-md hover:opacity-90 transition-opacity"
                        >
                          <Send size={12} />
                          Send to Client
                        </button>
                      )}
                      {hasUnsignedFields && !isArchived && doc.status !== "draft" && (
                        <button
                          onClick={() => setSigningDocId(doc.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)] text-white text-xs font-medium rounded-md hover:opacity-90 transition-opacity"
                        >
                          <PenTool size={12} />
                          Sign
                        </button>
                      )}

                      {/* Secondary actions — icon group */}
                      <div className="flex items-center gap-0.5 border border-[var(--border)] rounded-md p-0.5">
                        <button
                          onClick={() => { const f = doc.signedFileId && doc.signedFile ? doc.signedFile : doc.file; handleDocDownload(f.id, f.filename); }}
                          title="Download"
                          className="p-1.5 rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                        >
                          <Download size={14} />
                        </button>
                        {doc.status === "signed" && (
                          <button
                            onClick={() => handleDownloadCertificate(doc.id)}
                            title="Download certificate"
                            className="p-1.5 rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                          >
                            <Award size={14} />
                          </button>
                        )}
                        {doc.requiresSignature && !isArchived && isDraft && (
                          <button
                            onClick={() => setPlacerDocId(doc.id)}
                            title="Edit signature fields"
                            className="p-1.5 rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                          >
                            <PenTool size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => loadAuditTrail(doc.id)}
                          title="Audit trail"
                          className="p-1.5 rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                        >
                          <History size={14} />
                        </button>
                        {doc.requiresSignature && doc.status !== "draft" && (
                          <button
                            onClick={() => openSigningLinks(doc.id)}
                            title="Signing links"
                            className="p-1.5 rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                          >
                            <Link2 size={14} />
                          </button>
                        )}
                        {!isArchived && doc.status !== "voided" && doc.status !== "expired" && (
                          <label
                            title="Upload new version"
                            className="p-1.5 rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
                          >
                            <FilePlus size={14} />
                            <input
                              type="file"
                              className="hidden"
                              accept=".pdf,.doc,.docx,.odt,.jpg,.jpeg,.png,.webp"
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                try {
                                  const formData = new FormData();
                                  formData.append("file", f);
                                  await apiFetch(`/documents/${doc.id}/upload-version`, {
                                    method: "POST",
                                    body: formData,
                                  });
                                  loadDocuments();
                                  success(`Version ${(doc.currentVersion ?? 1) + 1} uploaded`);
                                } catch (err) {
                                  showError(err instanceof Error ? err.message : "Failed to upload version");
                                }
                                e.target.value = "";
                              }}
                            />
                          </label>
                        )}
                      </div>

                      {/* Destructive actions — right-aligned */}
                      <div className="ml-auto flex items-center gap-0.5">
                        {isVoidable && !isArchived && (
                          <button
                            onClick={() => { setVoidModalDocId(doc.id); setVoidReason(""); }}
                            title="Void document"
                            className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
                          >
                            <Ban size={14} />
                          </button>
                        )}
                        {!isArchived && (
                          <button
                            onClick={() => handleDocDelete(doc.id)}
                            title="Delete document"
                            className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {doc.status === "voided" && doc.voidReason && (
                      <div className="text-xs text-pink-700 bg-pink-50 px-3 py-2 rounded">Void reason: {doc.voidReason}</div>
                    )}
                    {doc.options && (() => {
                      const hasQuestion = doc.options.includes("|");
                      const question = hasQuestion ? doc.options.split("|")[0] : null;
                      const choices = (hasQuestion ? doc.options.split("|")[1] : doc.options).split(",");
                      return (
                        <div className="text-xs text-[var(--muted-foreground)]">
                          {question && <p className="font-medium mb-0.5">{question}</p>}
                          <p>Choices: {choices.join(" · ")}</p>
                        </div>
                      );
                    })()}
                    {doc.responses.length > 0 && (() => {
                      const byUser = new Map<string, DocumentResponse>();
                      for (const r of doc.responses) {
                        const existing = byUser.get(r.userId);
                        if (!existing || new Date(r.signedAt || r.createdAt) > new Date(existing.signedAt || existing.createdAt)) byUser.set(r.userId, r);
                      }
                      return (
                        <div>
                          <p className="text-xs font-medium mb-2">Responses</p>
                          <div className="space-y-1">
                            {Array.from(byUser.values()).map((r) => (
                              <div key={r.id} className="flex items-center justify-between text-xs p-2 bg-[var(--muted)] rounded">
                                <span>{r.user.name}</span>
                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: statusColors[r.action]?.bg || "#f3f4f6", color: statusColors[r.action]?.text || "#374151" }}>{r.action}</span>
                                  <span className="text-[var(--muted-foreground)]">{r.signedAt ? new Date(r.signedAt).toLocaleDateString() : new Date(r.createdAt).toLocaleDateString()}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Version history */}
                    {doc.versions && doc.versions.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-2">Version History</p>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs p-2 bg-[var(--primary)]/5 border border-[var(--primary)]/20 rounded">
                            <div>
                              <span className="font-medium">v{doc.currentVersion}</span>
                              <span className="text-[var(--muted-foreground)] ml-1.5">(current)</span>
                            </div>
                            <span className="text-[var(--muted-foreground)]">{formatBytes(doc.file.sizeBytes)}</span>
                          </div>
                          {doc.versions.map((v) => (
                            <div key={v.id} className="flex items-center justify-between text-xs p-2 bg-[var(--muted)] rounded">
                              <div>
                                <span className="font-medium">v{v.version}</span>
                                <span className="text-[var(--muted-foreground)] ml-1.5">
                                  {v.uploadedBy?.name || "Unknown"} &middot; {new Date(v.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} {new Date(v.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[var(--muted-foreground)]">{formatBytes(v.file.sizeBytes)}</span>
                                <button
                                  onClick={() => handleDocDownload(v.file.id, v.file.filename)}
                                  title="Download this version"
                                  className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                                >
                                  <Download size={12} />
                                </button>
                                {doc.status !== "voided" && doc.status !== "expired" && (
                                  <button
                                    onClick={async () => {
                                      try {
                                        await apiFetch(`/documents/${doc.id}/restore-version/${v.id}`, { method: "POST" });
                                        loadDocuments();
                                        success(`Restored to v${v.version}`);
                                      } catch (err) {
                                        showError(err instanceof Error ? err.message : "Failed to restore version");
                                      }
                                    }}
                                    title="Restore this version"
                                    className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                                  >
                                    <RotateCcw size={12} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {docsTotalPages > 1 && (
            <div className="mt-2">
              <Pagination page={docsPage} totalPages={docsTotalPages} onPageChange={setDocsPage} />
            </div>
          )}
        </div>
      )}

      {/* Plain files list */}
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
              handleFileDownload(file.id, file.filename);
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
                    <FileIcon size={14} className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{file.filename}</p>
                    {isLink ? (
                      <p className="text-xs text-[var(--muted-foreground)] truncate">
                        {hostname} &middot; {formatRelativeTime(file.createdAt)}
                      </p>
                    ) : (
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {formatBytes(file.sizeBytes ?? 0)} &middot; {formatRelativeTime(file.createdAt)}
                      </p>
                    )}
                    {isLink && file.description && (
                      <p className="text-xs text-[var(--muted-foreground)] mt-1">{file.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {isLink ? (
                    <ExternalLink size={14} className="text-[var(--muted-foreground)]" />
                  ) : (
                    <Download size={14} className="text-[var(--muted-foreground)]" />
                  )}
                  {!isArchived && canManageFiles && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditFile(file); }}
                      title="Edit"
                      className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  {!isArchived && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleFileDelete(file.id); }}
                      title="Delete"
                      className="p-1.5 rounded text-[var(--muted-foreground)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {files.length === 0 && documents.length === 0 && (
          <div className="text-center py-8">
            <FileX size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">No files or documents yet.</p>
          </div>
        )}
      </div>

      {/* Document Upload Modal */}
      {showDocUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) { setShowDocUpload(false); resetDocForm(); } }}>
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-[480px] mx-4 p-6 space-y-4">
            <h3 className="text-lg font-semibold">Upload File</h3>
            <div>
              <label className="text-sm text-[var(--muted-foreground)]">Title</label>
              <input type="text" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g., Project Contract v2" className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm" />
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-3">
              <div>
                <label className="text-sm text-[var(--muted-foreground)]">Type</label>
                <select value={docType} onChange={(e) => setDocType(e.target.value)} className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm">
                  <option value="contract">Contract</option>
                  <option value="quote">Quote</option>
                  <option value="proposal">Proposal</option>
                  <option value="nda">NDA</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-[var(--muted-foreground)]">File</label>
                {docFile ? (
                  <div className="mt-1 flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded-lg text-sm">
                    <FileIcon size={14} className="text-[var(--muted-foreground)] shrink-0" />
                    <span className="truncate flex-1">{docFile.name}</span>
                    <span className="text-xs text-[var(--muted-foreground)] shrink-0">{formatBytes(docFile.size)}</span>
                    <button onClick={() => setDocFile(null)} className="text-[var(--muted-foreground)] hover:text-red-500"><X size={14} /></button>
                  </div>
                ) : (
                  <label className="mt-1 flex items-center justify-center gap-2 px-3 py-2 border-2 border-dashed border-[var(--border)] rounded-lg text-sm text-[var(--muted-foreground)] cursor-pointer hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors">
                    <Upload size={14} /> Choose file
                    <input type="file" accept=".pdf,.doc,.docx,.odt,.jpg,.jpeg,.png,.webp" onChange={(e) => handleFileSelect(e.target.files?.[0] || null)} className="hidden" />
                  </label>
                )}
              </div>
            </div>
            {isPdf && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={requiresSignature} onChange={(e) => { setRequiresSignature(e.target.checked); if (e.target.checked) setRequiresApproval(false); }} className="accent-[var(--primary)]" />
                <span className="text-sm">Collect signature</span>
              </label>
            )}
            <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] flex items-center gap-1 transition-colors">
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Advanced options
            </button>
            {showAdvanced && (
              <div className="space-y-2.5 pl-5 border-l-2 border-[var(--border)]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={requiresApproval} onChange={(e) => { setRequiresApproval(e.target.checked); if (e.target.checked) setRequiresSignature(false); }} className="accent-[var(--primary)]" />
                  <span className="text-sm">Requires client approval</span>
                </label>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={expiresInDays !== ""} onChange={(e) => setExpiresInDays(e.target.checked ? 30 : "")} className="accent-[var(--primary)]" />
                  <span className="text-sm">Expires after</span>
                  {expiresInDays !== "" && (
                    <select value={expiresInDays} onChange={(e) => setExpiresInDays(parseInt(e.target.value))} className="px-2 py-1 border border-[var(--border)] rounded text-sm bg-[var(--background)]">
                      <option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option>
                    </select>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="checkbox" checked={reminderEnabled} onChange={(e) => setReminderEnabled(e.target.checked)} className="accent-[var(--primary)]" />
                  <span className="text-sm">Send reminder</span>
                  {reminderEnabled && (
                    <select value={reminderIntervalDays} onChange={(e) => setReminderIntervalDays(parseInt(e.target.value))} className="px-2 py-1 border border-[var(--border)] rounded text-sm bg-[var(--background)]">
                      <option value="1">every 1 day</option><option value="2">every 2 days</option><option value="3">every 3 days</option><option value="5">every 5 days</option><option value="7">every 7 days</option>
                    </select>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-[var(--muted-foreground)]">Ask client a question (optional)</label>
                  <input
                    type="text"
                    value={docQuestion}
                    onChange={(e) => setDocQuestion(e.target.value)}
                    placeholder="e.g., Which option do you prefer?"
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                  />
                  {(docQuestion.trim() || docChoices.length > 0) && (
                    <div className="space-y-1.5">
                      {docChoices.map((choice, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-[var(--muted-foreground)] w-4 shrink-0">{i + 1}.</span>
                          <input
                            type="text"
                            value={choice}
                            onChange={(e) => {
                              const next = [...docChoices];
                              next[i] = e.target.value;
                              setDocChoices(next);
                            }}
                            placeholder={`Option ${i + 1}`}
                            className="flex-1 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                          />
                          <button
                            onClick={() => setDocChoices(docChoices.filter((_, j) => j !== i))}
                            className="text-[var(--muted-foreground)] hover:text-red-500 shrink-0"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => setDocChoices([...docChoices, ""])}
                        className="text-xs text-[var(--primary)] hover:underline"
                      >
                        + Add option
                      </button>
                    </div>
                  )}
                  {!docQuestion.trim() && docChoices.length === 0 && (
                    <button
                      onClick={() => {
                        setDocChoices(["", ""]);
                      }}
                      className="text-xs text-[var(--primary)] hover:underline"
                    >
                      + Add question with choices
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button onClick={() => { setShowDocUpload(false); resetDocForm(); }} className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]">Cancel</button>
              <button onClick={() => handleDocUpload(false)} disabled={docUploading || !docTitle.trim() || !docFile} className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] disabled:opacity-40">Save Draft</button>
              <button onClick={() => handleDocUpload(true)} disabled={docUploading || !docTitle.trim() || !docFile} className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50">{docUploading ? "Uploading..." : "Upload & Send"}</button>
            </div>
            <p className="text-[11px] text-[var(--muted-foreground)] text-right -mt-2">Sending notifies the client immediately.</p>
          </div>
        </div>
      )}

      {/* Add Link Modal */}
      {showAddLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) { setShowAddLink(false); resetLinkForm(); } }}>
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-[480px] mx-4 p-6 space-y-4">
            <h3 className="text-lg font-semibold">Add Link</h3>
            <p className="text-sm text-[var(--muted-foreground)]">Link to an external resource like a Nextcloud document, Canva design, or any other URL.</p>
            <div>
              <label className="text-sm text-[var(--muted-foreground)]">URL</label>
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              />
            </div>
            <div>
              <label className="text-sm text-[var(--muted-foreground)]">Title</label>
              <input
                type="text"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="e.g., Design mockup (Canva)"
                maxLength={255}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              />
            </div>
            <div>
              <label className="text-sm text-[var(--muted-foreground)]">Description (optional)</label>
              <textarea
                value={linkDescription}
                onChange={(e) => setLinkDescription(e.target.value)}
                placeholder="What is this link for?"
                rows={2}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button onClick={() => { setShowAddLink(false); resetLinkForm(); }} className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]">Cancel</button>
              <button
                onClick={handleLinkSubmit}
                disabled={linkSaving || !linkUrl.trim() || !linkTitle.trim()}
                className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
              >
                {linkSaving ? "Adding..." : "Add link"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit File Modal */}
      {editFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) closeEditFile(); }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-[480px] mx-4 p-6 space-y-4">
            <h3 className="text-lg font-semibold">
              {editFile.type === "LINK" ? "Edit Link" : "Edit File"}
            </h3>
            {editFile.type === "LINK" && (
              <div>
                <label className="text-sm text-[var(--muted-foreground)]">URL</label>
                <input
                  type="url"
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                />
              </div>
            )}
            <div>
              <label className="text-sm text-[var(--muted-foreground)]">
                {editFile.type === "LINK" ? "Title" : "Filename"}
              </label>
              <input
                type="text"
                value={editFilename}
                onChange={(e) => setEditFilename(e.target.value)}
                maxLength={255}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              />
            </div>
            <div>
              <label className="text-sm text-[var(--muted-foreground)]">Description (optional)</label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="What is this for?"
                rows={2}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button
                onClick={closeEditFile}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]"
              >
                Cancel
              </button>
              <button
                onClick={handleEditFileSave}
                disabled={
                  editSaving ||
                  !editFilename.trim() ||
                  (editFile.type === "LINK" && !editUrl.trim())
                }
                className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
              >
                {editSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void Modal */}
      {voidModalDocId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) { setVoidModalDocId(null); setVoidReason(""); } }}>
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="text-lg font-semibold">Void Document</h3>
            <p className="text-sm text-[var(--muted-foreground)]">This will cancel the document. Clients will no longer be able to respond.</p>
            <div>
              <label className="block text-sm text-[var(--muted-foreground)] mb-1.5">Reason (optional)</label>
              <textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Why are you voiding this document?" rows={3} className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)] resize-none" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setVoidModalDocId(null); setVoidReason(""); }} className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]">Cancel</button>
              <button onClick={handleVoid} className="px-4 py-1.5 bg-pink-600 text-white rounded-lg text-sm hover:bg-pink-700">Void Document</button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Trail Modal */}
      {showAuditDocId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setShowAuditDocId(null); }}>
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-lg mx-4 p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold flex items-center gap-2"><History size={18} /> Audit Trail</h3>
            <div className="space-y-2">
              {auditTrail.map((event) => (
                <div key={event.id} className="flex items-start gap-3 text-sm p-2 border border-[var(--border)] rounded">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{event.user?.name || "System"}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: statusColors[event.action]?.bg || "#f3f4f6", color: statusColors[event.action]?.text || "#374151" }}>{event.action}</span>
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] mt-0.5">{new Date(event.createdAt).toLocaleString()}{event.ipAddress && ` · IP: ${event.ipAddress}`}</div>
                  </div>
                </div>
              ))}
              {auditTrail.length === 0 && <p className="text-sm text-[var(--muted-foreground)] text-center py-4">No events recorded.</p>}
            </div>
            <div className="flex justify-end"><button onClick={() => setShowAuditDocId(null)} className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]">Close</button></div>
          </div>
        </div>
      )}

      {/* Signing Links Modal */}
      {signingLinksDocId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setSigningLinksDocId(null); }}>
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-lg mx-4 p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Link2 size={18} />
              Signing Links
            </h3>

            {/* Generate new link */}
            <div className="space-y-2">
              <p className="text-sm text-[var(--muted-foreground)]">Generate a direct signing link for a client. They can sign without logging into the portal.</p>
              {projectClients.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {projectClients.map((c) => {
                    const hasActiveLink = signingLinks.some((l) => l.userId === c.userId && l.isActive);
                    return (
                      <button
                        key={c.userId}
                        onClick={() => generateSigningLink(signingLinksDocId, c.userId)}
                        disabled={hasActiveLink}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border)] rounded-md text-xs hover:bg-[var(--muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={hasActiveLink ? "Active link already exists" : `Generate link for ${c.user.name}`}
                      >
                        <Link2 size={12} />
                        {c.user.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[var(--muted-foreground)]">No clients assigned to this project.</p>
              )}
            </div>

            {/* Newly generated link — copy box */}
            {newLinkToken && (
              <div className="p-3 border border-green-200 bg-green-50 rounded-lg space-y-2">
                <p className="text-xs font-medium text-green-800">Link created! Copy and share with the client:</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/portal/sign/${newLinkToken}`}
                    className="flex-1 px-3 py-1.5 bg-white border border-green-300 rounded text-xs font-mono"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/portal/sign/${newLinkToken}`);
                      success("Link copied!");
                    }}
                    className="p-1.5 rounded hover:bg-green-100 text-green-700 transition-colors"
                    title="Copy link"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Active links */}
            {signingLinks.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Active & Past Links</p>
                {signingLinks.map((link) => (
                  <div key={link.id} className={`flex items-center justify-between text-xs p-2 rounded border border-[var(--border)] ${link.isActive ? "" : "opacity-50"}`}>
                    <div>
                      <span className="font-medium">{link.user?.name || "Unknown"}</span>
                      <span className="text-[var(--muted-foreground)] ml-1.5">
                        {link.user?.email}
                      </span>
                      <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                        Created {new Date(link.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} {new Date(link.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        {link.usedAt && " · Opened"}
                        {link.revokedAt && " · Revoked"}
                        {!link.isActive && !link.revokedAt && " · Expired"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {link.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">Active</span>
                      )}
                      {link.isActive && (
                        <button
                          onClick={() => revokeSigningLink(signingLinksDocId, link.id)}
                          title="Revoke link"
                          className="p-1 rounded text-[var(--muted-foreground)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <XCircle size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-[var(--border)]">
              <button onClick={() => setSigningLinksDocId(null)} className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]">Close</button>
            </div>
          </div>
        </div>
      )}

      {placerDocId && <SignatureFieldPlacer documentId={placerDocId} onClose={() => setPlacerDocId(null)} onSaved={() => { setPlacerDocId(null); loadDocuments(); success("Signature fields saved"); }} />}
      {signingDocId && <SigningViewer documentId={signingDocId} onClose={() => setSigningDocId(null)} onSigned={() => { setSigningDocId(null); loadDocuments(); }} />}
    </div>
  );
}
