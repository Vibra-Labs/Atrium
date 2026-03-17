"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatBytes, formatRelativeTime } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import {
  Upload,
  Download,
  Trash2,
  FileX,
  FileText,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  MessageSquare,
} from "lucide-react";
import { track } from "@/lib/track";

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
  respondedBy?: { name: string } | null;
  respondReason?: string | null;
}

const DOCUMENT_TYPES = [
  { value: "quote", label: "Quote" },
  { value: "contract", label: "Contract" },
  { value: "nda", label: "NDA" },
  { value: "proposal", label: "Proposal" },
  { value: "other", label: "Other" },
] as const;

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pending" },
  viewed: { bg: "bg-blue-50", text: "text-blue-700", label: "Viewed" },
  accepted: { bg: "bg-green-50", text: "text-green-700", label: "Accepted" },
  rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rejected" },
};

const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  quote: { bg: "bg-purple-50", text: "text-purple-700" },
  contract: { bg: "bg-blue-50", text: "text-blue-700" },
  nda: { bg: "bg-orange-50", text: "text-orange-700" },
  proposal: { bg: "bg-teal-50", text: "text-teal-700" },
  other: { bg: "bg-gray-50", text: "text-gray-700" },
};

export function FilesSection({
  projectId,
  isArchived,
  files,
  onFileChange,
}: {
  projectId: string;
  isArchived: boolean;
  files: FileRecord[];
  onFileChange: () => void;
}) {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [isDocument, setIsDocument] = useState(false);
  const [documentType, setDocumentType] = useState("contract");
  const [documentTitle, setDocumentTitle] = useState("");

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      let url = `/files/upload?projectId=${projectId}`;
      if (isDocument) {
        url += `&documentType=${encodeURIComponent(documentType)}`;
        if (documentTitle.trim()) {
          url += `&documentTitle=${encodeURIComponent(documentTitle.trim())}`;
        }
      }

      await apiFetch(url, {
        method: "POST",
        body: formData,
      });
      track("file_uploaded", { size: file.size, isDocument });
      onFileChange();
      success(isDocument ? "Document uploaded" : "File uploaded");
      // Reset form state
      setShowUploadForm(false);
      setIsDocument(false);
      setDocumentTitle("");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (fileId: string, filename: string) => {
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

  const handleDelete = async (fileId: string) => {
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

  // Sort: rejected docs first (need admin attention), then pending, then rest by date
  const sortedFiles = [...files].sort((a, b) => {
    const priority = (f: FileRecord) => {
      if (f.documentType && f.documentStatus === "rejected") return 2;
      if (f.documentType && (f.documentStatus === "pending" || f.documentStatus === "viewed")) return 1;
      return 0;
    };
    const pa = priority(a), pb = priority(b);
    if (pa !== pb) return pb - pa;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">Files</h2>
        {!isArchived && (
          <button
            onClick={() => setShowUploadForm(!showUploadForm)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
          >
            <Upload size={14} />
            Upload
            {showUploadForm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {/* Upload form */}
      {showUploadForm && !isArchived && (
        <div className="mb-4 p-4 border border-[var(--border)] rounded-lg bg-[var(--muted)]/30 space-y-3">
          {/* Document toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isDocument}
              onChange={(e) => setIsDocument(e.target.checked)}
              className="rounded border-[var(--border)]"
            />
            <span className="text-sm">This is a document requiring client response</span>
          </label>

          {/* Document fields (shown when toggle is on) */}
          {isDocument && (
            <div className="space-y-2 pl-6">
              <div>
                <label className="text-xs text-[var(--muted-foreground)] block mb-1">
                  Document Type
                </label>
                <select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm bg-[var(--background)]"
                >
                  {DOCUMENT_TYPES.map((dt) => (
                    <option key={dt.value} value={dt.value}>
                      {dt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--muted-foreground)] block mb-1">
                  Document Title (optional)
                </label>
                <input
                  type="text"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  placeholder="e.g. Website Redesign Contract"
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm bg-[var(--background)]"
                />
              </div>
            </div>
          )}

          {/* File input */}
          <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-[var(--border)] rounded-lg text-sm cursor-pointer hover:bg-[var(--muted)] transition-colors justify-center">
            <Upload size={14} className="text-[var(--muted-foreground)]" />
            {uploading ? "Uploading..." : "Choose file to upload"}
            <input
              type="file"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        </div>
      )}

      <div className="space-y-2">
        {sortedFiles.map((file) => {
          const isDoc = !!file.documentType;
          const statusStyle = file.documentStatus
            ? STATUS_STYLES[file.documentStatus] || STATUS_STYLES.pending
            : null;
          const typeStyle = file.documentType
            ? TYPE_STYLES[file.documentType] || TYPE_STYLES.other
            : null;
          const needsAction =
            isDoc &&
            (file.documentStatus === "pending" ||
              file.documentStatus === "viewed");

          const isRejected = file.documentStatus === "rejected";

          return (
            <div
              key={file.id}
              className={`p-3 border rounded-lg ${
                isRejected
                  ? "border-red-200 bg-red-50/30"
                  : needsAction
                    ? "border-amber-200 bg-amber-50/30"
                    : "border-[var(--border)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  {isDoc && (
                    <FileText
                      size={18}
                      className="text-[var(--primary)] shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">
                        {isDoc && file.documentTitle
                          ? file.documentTitle
                          : file.filename}
                      </p>
                      {isDoc && typeStyle && (
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${typeStyle.bg} ${typeStyle.text}`}
                        >
                          {DOCUMENT_TYPES.find(
                            (dt) => dt.value === file.documentType,
                          )?.label || file.documentType}
                        </span>
                      )}
                      {isDoc && statusStyle && (
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyle.bg} ${statusStyle.text}`}
                        >
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
                      {formatBytes(file.sizeBytes)} &middot;{" "}
                      {formatRelativeTime(file.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {/* Reset to pending button for rejected/accepted docs */}
                  {isDoc && !isArchived && (file.documentStatus === "rejected" || file.documentStatus === "accepted") && (
                    <button
                      onClick={async () => {
                        try {
                          await apiFetch(`/files/${file.id}/status`, {
                            method: "PATCH",
                            body: JSON.stringify({ status: "pending" }),
                          });
                          onFileChange();
                          success("Document reset to pending");
                        } catch (err) {
                          showError(err instanceof Error ? err.message : "Failed to update status");
                        }
                      }}
                      className="flex items-center gap-1.5 text-xs text-amber-600 hover:underline"
                      title="Reset to pending — client will be asked to respond again"
                    >
                      <RotateCcw size={13} />
                      Reset
                    </button>
                  )}
                  <button
                    onClick={() => handleDownload(file.id, file.filename)}
                    className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
                  >
                    <Download size={14} />
                    Download
                  </button>
                  {!isArchived && (
                    <button
                      onClick={() => handleDelete(file.id)}
                      className="flex items-center gap-1.5 text-sm text-red-500 hover:underline"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {/* Decline reason banner */}
              {isRejected && (
                <div className="mt-2 pt-2 border-t border-red-100">
                  <div className="flex items-start gap-2">
                    <MessageSquare size={14} className="text-red-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-red-700">
                        Declined{file.respondedBy?.name ? ` by ${file.respondedBy.name}` : ""}
                        {file.respondedAt ? ` · ${formatRelativeTime(file.respondedAt)}` : ""}
                      </p>
                      {file.respondReason && (
                        <p className="text-xs text-red-600 mt-0.5">
                          &ldquo;{file.respondReason}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {files.length === 0 && (
          <div className="text-center py-8">
            <FileX
              size={32}
              className="mx-auto text-[var(--muted-foreground)] mb-2"
            />
            <p className="text-sm text-[var(--muted-foreground)]">
              No files uploaded yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
