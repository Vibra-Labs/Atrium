"use client";

import { useEffect, useState } from "react";
import { X, Download, ExternalLink, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { track } from "@/lib/track";
import { usePreviewMode } from "@/lib/preview-mode";
import { useToast } from "@/components/toast";

const API_URL: string = process.env.NEXT_PUBLIC_API_URL || "";

const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface PortalDeliverable {
  id: string;
  title: string;
  status: string;
  currentVersion?: number;
  requestNote?: string | null;
  file: {
    id: string;
    filename: string;
    mimeType: string;
    type?: "UPLOAD" | "LINK";
    url?: string | null;
  };
  decision: {
    action: string;
    reason: string | null;
    createdAt: string;
    user: { name: string };
  } | null;
}

interface PortalDeliverableReviewProps {
  doc: PortalDeliverable;
  onClose: () => void;
  onDecided: () => void;
}

type Mode = "idle" | "approving" | "requesting";

export function PortalDeliverableReview({ doc, onClose, onDecided }: PortalDeliverableReviewProps): React.ReactElement {
  const toast = useToast();
  const preview: boolean = !!usePreviewMode().preview;
  const [mode, setMode] = useState<Mode>("idle");
  const [changing, setChanging] = useState<boolean>(false);
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isLink: boolean = doc.file.type === "LINK";
  const isPdf: boolean = doc.file.mimeType === "application/pdf";
  const isImage: boolean = IMAGE_TYPES.has(doc.file.mimeType);
  const canPreview: boolean = !isLink && (isPdf || isImage);
  const version: number = doc.currentVersion ?? 1;

  useEffect(() => {
    if (!canPreview) return;
    let revoked = false;
    const controller = new AbortController();
    (async (): Promise<void> => {
      try {
        setLoading(true);
        setLoadError(null);
        const res = await fetch(`${API_URL}/api/documents/${doc.id}/view`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Failed to load document (${res.status})`);
        const url: string = URL.createObjectURL(await res.blob());
        if (revoked) URL.revokeObjectURL(url);
        else setBlobUrl(url);
      } catch (err) {
        if (!revoked && (err as Error).name !== "AbortError") {
          console.error(err);
          setLoadError((err as Error).message);
        }
      } finally {
        if (!revoked) setLoading(false);
      }
    })();
    return () => {
      revoked = true;
      controller.abort();
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [doc.id, doc.currentVersion, canPreview]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow: string = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const decide = async (action: "accepted" | "declined", reason: string): Promise<void> => {
    setSubmitting(true);
    try {
      await apiFetch(`/documents/${doc.id}/respond`, {
        method: "POST",
        body: JSON.stringify({
          action,
          version,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      track("portal_deliverable_decided", { action });
      toast.success(
        action === "accepted"
          ? "Approved. The agency has been notified."
          : "Sent. The agency will follow up with a new version.",
      );
      onDecided();
    } catch (err) {
      console.error(err);
      const message: string = err instanceof Error ? err.message : "";
      if (/newer version/i.test(message)) {
        toast.error("A newer version was just uploaded. Showing the latest.");
        onDecided();
      } else {
        toast.error("Couldn't save your decision. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async (): Promise<void> => {
    try {
      await downloadFile(doc.file.id, doc.file.filename);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't download the file.");
    }
  };

  const showDecision: boolean = !!doc.decision && !changing;
  const disabled: boolean = preview || submitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="deliverable-review">
      <div
        role="dialog"
        aria-label={`Review ${doc.title}`}
        className="bg-[var(--background)] w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)]">
          <div className="min-w-0 flex items-center gap-2">
            <h2 className="font-semibold truncate">{doc.title}</h2>
            <span className="text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)] shrink-0">
              v{version}
            </span>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-[var(--muted)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="min-h-[200px] flex items-center justify-center bg-[var(--muted)] rounded-lg overflow-hidden">
            {isLink ? (
              <a
                href={doc.file.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-6 py-3 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90"
              >
                <ExternalLink size={18} />
                Open link
              </a>
            ) : canPreview ? (
              loading ? (
                <Loader2 className="animate-spin text-[var(--muted-foreground)]" size={24} />
              ) : loadError ? (
                <p className="text-sm text-red-600 p-4">{loadError}</p>
              ) : blobUrl ? (
                isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={blobUrl} alt={doc.title} className="max-w-full max-h-[60vh] object-contain" />
                ) : (
                  <iframe src={blobUrl} title={doc.title} className="w-full h-[60vh] bg-white" />
                )
              ) : null
            ) : (
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-4 py-2 border border-[var(--border)] bg-[var(--background)] rounded-lg text-sm"
              >
                <Download size={16} />
                Download
              </button>
            )}
          </div>

          {doc.requestNote && (
            <blockquote className="border-l-4 border-[var(--border)] pl-3 text-sm text-[var(--muted-foreground)] whitespace-pre-wrap">
              {doc.requestNote}
            </blockquote>
          )}

          <div className="space-y-3">
            {preview && (
              <p className="text-sm text-[var(--muted-foreground)]">Read-only preview</p>
            )}

            {showDecision && doc.decision ? (
              <div className="space-y-2">
                <p
                  className={`text-sm font-medium ${
                    doc.decision.action === "accepted" ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {doc.decision.action === "accepted" ? "Approved by" : "Changes requested by"}{" "}
                  {doc.decision.user.name} · {new Date(doc.decision.createdAt).toLocaleDateString()}
                </p>
                {doc.decision.reason && (
                  <p className="text-sm text-[var(--muted-foreground)] whitespace-pre-wrap">{doc.decision.reason}</p>
                )}
                <button
                  onClick={() => { setNote(""); setMode("idle"); setChanging(true); }}
                  disabled={preview}
                  className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg disabled:opacity-50"
                >
                  Change decision
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => { setNote(""); setMode("approving"); }}
                    disabled={disabled}
                    className="px-4 py-2 text-sm font-medium rounded-lg text-white disabled:opacity-50"
                    style={{ backgroundColor: "#15803d" }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => { setNote(""); setMode("requesting"); }}
                    disabled={disabled}
                    className="px-4 py-2 text-sm font-medium rounded-lg text-white disabled:opacity-50"
                    style={{ backgroundColor: "#b91c1c" }}
                  >
                    Request changes
                  </button>
                </div>

                {mode === "approving" && (
                  <div className="space-y-2 p-3 border border-[var(--border)] rounded-lg">
                    <p className="text-sm font-medium">
                      Approve v{version} of {doc.title}?
                    </p>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Add a note (optional)"
                      rows={2}
                      maxLength={500}
                      className="w-full p-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--background)]"
                    />
                    <button
                      onClick={() => decide("accepted", note)}
                      disabled={disabled}
                      className="px-4 py-1.5 text-sm font-medium rounded-lg text-white disabled:opacity-50"
                      style={{ backgroundColor: "#15803d" }}
                    >
                      Confirm
                    </button>
                  </div>
                )}

                {mode === "requesting" && (
                  <div className="space-y-2 p-3 border border-[var(--border)] rounded-lg">
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What should change?"
                      rows={3}
                      maxLength={500}
                      className="w-full p-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--background)]"
                    />
                    <button
                      onClick={() => decide("declined", note)}
                      disabled={disabled || !note.trim()}
                      className="px-4 py-1.5 text-sm font-medium rounded-lg text-white disabled:opacity-50"
                      style={{ backgroundColor: "#b91c1c" }}
                    >
                      Send
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
