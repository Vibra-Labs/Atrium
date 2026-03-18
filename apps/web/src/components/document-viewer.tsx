"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Download, FileText, Loader2 } from "lucide-react";
import { downloadFile } from "@/lib/download";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

const PDF_TYPES = new Set(["application/pdf"]);
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

interface DocumentViewerProps {
  documentId: string;
  title: string;
  typeLabel: string;
  mimeType: string;
  fileId: string;
  filename: string;
  hasResponded: boolean;
  lastResponseAction?: string;
  actions: string[];
  onRespond: (action: string, reason?: string) => Promise<void>;
  onClose: () => void;
  /** If true, fetch from /api/files/:fileId/download instead of /api/documents/:documentId/view */
  useFileEndpoint?: boolean;
  /** If true, open with the decline form visible immediately */
  initialDecline?: boolean;
}

export function DocumentViewer({
  documentId,
  title,
  typeLabel,
  mimeType,
  fileId,
  filename,
  hasResponded,
  lastResponseAction,
  actions,
  onRespond,
  onClose,
  useFileEndpoint,
  initialDecline,
}: DocumentViewerProps) {
  const [responding, setResponding] = useState(false);
  const [currentResponse, setCurrentResponse] = useState(lastResponseAction);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDeclineForm, setShowDeclineForm] = useState(initialDecline ?? false);
  const [declineReason, setDeclineReason] = useState("");

  const isPdf = PDF_TYPES.has(mimeType);
  const isImage = IMAGE_TYPES.has(mimeType);
  const canPreview = isPdf || isImage;

  const viewUrl = useFileEndpoint
    ? `${API_URL}/api/files/${fileId}/download`
    : `${API_URL}/api/documents/${documentId}/view`;

  useEffect(() => {
    if (!canPreview) {
      setLoading(false);
      return;
    }

    let revoked = false;
    const controller = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const res = await fetch(viewUrl, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Failed to load document (${res.status})`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (!revoked) setBlobUrl(url);
      } catch (err: unknown) {
        if (!revoked && (err as Error).name !== "AbortError") {
          setLoadError((err as Error).message);
        }
      } finally {
        if (!revoked) setLoading(false);
      }
    })();

    return () => {
      revoked = true;
      controller.abort();
      // Revoke previous blob URL to prevent memory leak on re-fetch
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [viewUrl, canPreview]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const handleRespond = useCallback(
    async (action: string, reason?: string) => {
      setResponding(true);
      try {
        await onRespond(action, reason);
        setCurrentResponse(action);
        setShowDeclineForm(false);
        setDeclineReason("");
      } finally {
        setResponding(false);
      }
    },
    [onRespond],
  );

  const handleDownload = useCallback(async () => {
    try {
      await downloadFile(fileId, filename);
    } catch (err) {
      console.error(err);
    }
  }, [fileId, filename]);

  const alreadyResponded = hasResponded || !!currentResponse;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--background)] rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold truncate">{title}</h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              {typeLabel}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {alreadyResponded && currentResponse ? (
              <span
                className="text-xs px-3 py-1.5 rounded-full font-medium"
                style={{
                  backgroundColor:
                    currentResponse === "declined" || currentResponse === "rejected"
                      ? "#fee2e2"
                      : "#dcfce7",
                  color:
                    currentResponse === "declined" || currentResponse === "rejected"
                      ? "#b91c1c"
                      : "#15803d",
                }}
              >
                {currentResponse.charAt(0).toUpperCase() +
                  currentResponse.slice(1)}
              </span>
            ) : (
              <>
                {actions.includes("accepted") && (
                  <>
                    <button
                      onClick={() => handleRespond("accepted")}
                      disabled={responding}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
                      style={{ backgroundColor: "#15803d" }}
                    >
                      {responding ? "..." : "Accept"}
                    </button>
                    <button
                      onClick={() => setShowDeclineForm(true)}
                      disabled={responding}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
                      style={{ backgroundColor: "#b91c1c" }}
                    >
                      Decline
                    </button>
                  </>
                )}
                {!actions.includes("accepted") && (
                  <button
                    onClick={() => handleRespond("acknowledged")}
                    disabled={responding}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--primary)] text-white transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
                  >
                    {responding ? "..." : "Acknowledge"}
                  </button>
                )}
              </>
            )}

            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors cursor-pointer"
              title="Download file"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Download</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[var(--muted)] transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Decline reason form */}
        {showDeclineForm && (
          <div className="px-5 py-4 border-b border-[var(--border)] bg-red-50/50 shrink-0">
            <p className="text-sm font-medium text-red-900 mb-2">
              Decline this {typeLabel.toLowerCase()}?
            </p>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Add a reason or message (optional)"
              className="w-full px-3 py-2 text-sm border border-red-200 rounded-lg bg-white resize-none focus:outline-none focus:ring-2 focus:ring-red-300"
              rows={2}
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => handleRespond("declined", declineReason || undefined)}
                disabled={responding}
                className="px-4 py-1.5 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
                style={{ backgroundColor: "#b91c1c" }}
              >
                {responding ? "Submitting..." : "Confirm Decline"}
              </button>
              <button
                onClick={() => { setShowDeclineForm(false); setDeclineReason(""); }}
                disabled={responding}
                className="px-4 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-auto min-h-0">
          {loading && canPreview && (
            <div className="flex items-center justify-center h-96">
              <Loader2 size={32} className="animate-spin text-[var(--muted-foreground)]" />
            </div>
          )}

          {loadError && (
            <div className="flex flex-col items-center justify-center h-96 p-8 text-center">
              <p className="text-sm text-red-500 mb-4">{loadError}</p>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-6 py-2.5 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Download size={16} />
                Download instead
              </button>
            </div>
          )}

          {!loading && !loadError && isPdf && blobUrl && (
            <iframe
              src={blobUrl}
              className="w-full border-0"
              style={{ height: "75vh" }}
              title={`Document: ${title}`}
            />
          )}

          {!loading && !loadError && isImage && blobUrl && (
            <div className="flex items-center justify-center p-6">
              <img
                src={blobUrl}
                alt={title}
                className="max-w-full max-h-[70vh] rounded-lg border border-[var(--border)] object-contain"
              />
            </div>
          )}

          {!canPreview && (
            <div className="flex flex-col items-center justify-center h-96 p-8 text-center">
              <FileText
                size={64}
                className="text-[var(--muted-foreground)] mb-4"
              />
              <h3 className="text-lg font-medium mb-2">
                Preview not available
              </h3>
              <p className="text-sm text-[var(--muted-foreground)] mb-6 max-w-md">
                This file format ({filename.split(".").pop()?.toUpperCase() || "unknown"}) cannot
                be previewed in the browser. Please download the file to view it.
              </p>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-6 py-2.5 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Download size={16} />
                Download {filename}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
