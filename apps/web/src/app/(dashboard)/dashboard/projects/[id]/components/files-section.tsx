"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Upload, Download, Trash2, FileX } from "lucide-react";
import { track } from "@/lib/track";
import { DocumentsSection } from "./documents-section";

interface FileRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      await apiFetch(`/files/upload?projectId=${projectId}`, {
        method: "POST",
        body: formData,
      });
      track("file_uploaded", { size: file.size });
      onFileChange();
      success("File uploaded");
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

  return (
    <>
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">Files</h2>
        {!isArchived && (
          <label className="flex items-center gap-2 px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm cursor-pointer hover:opacity-90">
            <Upload size={14} />
            {uploading ? "Uploading..." : "Upload File"}
            <input
              type="file"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        )}
      </div>

      <div className="space-y-2">
        {files.map((file) => (
          <div
            key={file.id}
            className="flex items-center justify-between p-3 border border-[var(--border)] rounded-lg"
          >
            <div>
              <p className="text-sm font-medium">{file.filename}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {formatBytes(file.sizeBytes)} &middot; {file.mimeType}
              </p>
            </div>
            <div className="flex gap-2">
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
        ))}
        {files.length === 0 && (
          <div className="text-center py-8">
            <FileX size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">
              No files uploaded yet.
            </p>
          </div>
        )}
      </div>
    </div>
    <DocumentsSection projectId={projectId} isArchived={isArchived} />
    </>
  );
}
