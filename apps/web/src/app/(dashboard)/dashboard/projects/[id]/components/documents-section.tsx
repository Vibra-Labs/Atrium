"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import { Upload, Download, Trash2, FileCheck, ChevronDown, ChevronRight } from "lucide-react";
import { track } from "@/lib/track";
import { downloadFile } from "@/lib/download";

interface DocumentResponse {
  id: string;
  userId: string;
  action: string;
  createdAt: string;
  user: { id: string; name: string };
}

interface DocumentFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

interface DocumentRecord {
  id: string;
  type: string;
  title: string;
  status: string;
  file: DocumentFile;
  responses: DocumentResponse[];
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const typeLabels: Record<string, string> = {
  quote: "Quote",
  contract: "Contract",
  nda: "NDA",
  other: "Other",
};

const statusColors: Record<string, { bg: string; text: string }> = {
  pending: { bg: "#fef3c7", text: "#92400e" },
  accepted: { bg: "#dcfce7", text: "#15803d" },
  declined: { bg: "#fee2e2", text: "#b91c1c" },
  acknowledged: { bg: "#dbeafe", text: "#1d4ed8" },
};

export function DocumentsSection({
  projectId,
  isArchived,
}: {
  projectId: string;
  isArchived: boolean;
}) {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Upload form state
  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState("quote");
  const [docFile, setDocFile] = useState<File | null>(null);

  const loadDocuments = useCallback(async () => {
    try {
      const res = await apiFetch<PaginatedResponse<DocumentRecord>>(
        `/documents/project/${projectId}?page=${page}&limit=20`,
      );
      setDocuments(res.data);
      setTotalPages(res.meta.totalPages);
    } catch (err) {
      console.error(err);
    }
  }, [projectId, page]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleUpload = async () => {
    if (!docFile || !docTitle.trim()) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", docFile);
      formData.append("projectId", projectId);
      formData.append("type", docType);
      formData.append("title", docTitle);

      await apiFetch("/documents", {
        method: "POST",
        body: formData,
      });
      track("document_uploaded", { type: docType });
      setShowUploadModal(false);
      setDocTitle("");
      setDocType("quote");
      setDocFile(null);
      loadDocuments();
      success("Document uploaded");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (fileId: string, filename: string) => {
    try {
      await downloadFile(fileId, filename);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (docId: string) => {
    const ok = await confirm({
      title: "Delete Document",
      message: "Delete this document and all responses? This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/documents/${docId}`, { method: "DELETE" });
      loadDocuments();
      success("Document deleted");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete document");
    }
  };

  return (
    <div className="mt-6 pt-6 border-t border-[var(--border)]">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <FileCheck size={14} />
          Documents{documents.length > 0 && ` (${documents.length})`}
        </h2>
        {!isArchived && (
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
          >
            <Upload size={14} />
            Upload Document
          </button>
        )}
      </div>

      {/* Upload modal */}
      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowUploadModal(false);
          }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md mx-4 p-6 space-y-4">
            <h3 className="text-lg font-semibold">Upload Document</h3>

            <div>
              <label className="text-sm text-[var(--muted-foreground)]">Title</label>
              <input
                type="text"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="e.g., Project Quote v2"
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted-foreground)]">Type</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              >
                <option value="quote">Quote</option>
                <option value="contract">Contract</option>
                <option value="nda">NDA</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="text-sm text-[var(--muted-foreground)]">File</label>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.odt,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                className="w-full mt-1 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowUploadModal(false)}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || !docTitle.trim() || !docFile}
                className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
              >
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Documents list */}
      <div className="space-y-2">
        {documents.map((doc) => {
          const colors = statusColors[doc.status] || statusColors.pending;
          const isExpanded = expandedId === doc.id;

          return (
            <div key={doc.id} className="border border-[var(--border)] rounded-lg">
              <button
                onClick={() => setExpandedId(isExpanded ? null : doc.id)}
                className="flex items-center justify-between w-full p-3 text-left hover:bg-[var(--muted)] transition-colors rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <div>
                    <p className="text-sm font-medium">{doc.title}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {doc.file.filename} &middot; {formatBytes(doc.file.sizeBytes)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "#f3f4f6", color: "#374151" }}>
                    {typeLabels[doc.type] || doc.type}
                  </span>
                  <span
                    className="text-xs px-2 py-1 rounded-full font-medium"
                    style={{ backgroundColor: colors.bg, color: colors.text }}
                  >
                    {doc.status}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {doc.responses.length} response{doc.responses.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-[var(--border)]">
                  <div className="flex items-center gap-2 pt-3">
                    <button
                      onClick={() => handleDownload(doc.file.id, doc.file.filename)}
                      className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
                    >
                      <Download size={14} />
                      Download
                    </button>
                    {!isArchived && (
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="ml-auto flex items-center gap-1 text-xs text-red-500 hover:underline"
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    )}
                  </div>

                  {/* Responses */}
                  {doc.responses.length > 0 && (
                    <div>
                      <p className="text-xs font-medium mb-2">Responses</p>
                      <div className="space-y-1">
                        {doc.responses.map((r) => (
                          <div
                            key={r.id}
                            className="flex items-center justify-between text-xs p-2 bg-[var(--muted)] rounded"
                          >
                            <span>{r.user.name}</span>
                            <div className="flex items-center gap-2">
                              <span
                                className="px-2 py-0.5 rounded-full font-medium"
                                style={{
                                  backgroundColor: statusColors[r.action]?.bg || "#f3f4f6",
                                  color: statusColors[r.action]?.text || "#374151",
                                }}
                              >
                                {r.action}
                              </span>
                              <span className="text-[var(--muted-foreground)]">
                                {new Date(r.createdAt).toLocaleDateString()}
                              </span>
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
        {documents.length === 0 && (
          <p className="text-sm text-[var(--muted-foreground)] text-center py-4">
            No documents yet.
          </p>
        )}
      </div>
      {documents.length > 0 && (
        <div className="mt-3">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
