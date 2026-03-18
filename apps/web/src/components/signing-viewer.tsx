"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Check, Download } from "lucide-react";
import { PdfViewer } from "./pdf-viewer";
import { SignaturePad } from "./signature-pad";
import { apiFetch } from "@/lib/api";
import { downloadFile } from "@/lib/download";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface SignatureField {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SigningInfo {
  documentId: string;
  requiresSignature: boolean;
  signatureFields: SignatureField[];
  signedFieldIds: string[];
  signedFileId: string | null;
}

interface SigningViewerProps {
  documentId: string;
  onClose: () => void;
  onSigned: () => void;
}

function dataURLtoBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  const u8arr = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
  return new Blob([u8arr], { type: mime });
}

export function SigningViewer({
  documentId,
  onClose,
  onSigned,
}: SigningViewerProps) {
  const [signingInfo, setSigningInfo] = useState<SigningInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [signatureMethod, setSignatureMethod] = useState<"draw" | "type">("draw");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfVersion, setPdfVersion] = useState(0);

  const closeSignatureCapture = useCallback(() => {
    setActiveFieldId(null);
    setSignatureDataUrl(null);
  }, []);

  const handleSignatureChange = useCallback(
    (dataUrl: string | null, method: "draw" | "type") => {
      setSignatureDataUrl(dataUrl);
      setSignatureMethod(method);
    },
    [],
  );

  const fetchSigningInfo = useCallback(async () => {
    try {
      const info = await apiFetch<SigningInfo>(
        `/documents/${documentId}/signing-info`,
      );
      setSigningInfo(info);
    } catch (err) {
      console.error("Failed to fetch signing info:", err);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    fetchSigningInfo();
  }, [fetchSigningInfo]);

  // Close on Escape (only if signature modal is not open)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeFieldId) {
          closeSignatureCapture();
        } else {
          handleClose();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeFieldId, closeSignatureCapture]);

  const allSigned =
    signingInfo &&
    signingInfo.signatureFields.length > 0 &&
    signingInfo.signedFieldIds.length === signingInfo.signatureFields.length;

  const handleClose = () => {
    if (allSigned) onSigned();
    onClose();
  };

  const handleApplySignature = async () => {
    if (!activeFieldId || !signatureDataUrl) return;

    setSubmitting(true);
    setError(null);
    try {
      const blob = dataURLtoBlob(signatureDataUrl);
      const formData = new FormData();
      formData.append("signature", blob, "signature.png");
      formData.append("method", signatureMethod);
      formData.append("fieldId", activeFieldId);
      formData.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);

      await apiFetch(`/documents/${documentId}/sign`, {
        method: "POST",
        body: formData,
      });

      closeSignatureCapture();

      // Bump version to force PdfViewer to re-fetch the now-signed PDF
      setPdfVersion((v) => v + 1);

      // Refresh signing info
      const updatedInfo = await apiFetch<SigningInfo>(
        `/documents/${documentId}/signing-info`,
      );
      setSigningInfo(updatedInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadSigned = async () => {
    if (!signingInfo?.signedFileId) return;
    try {
      await downloadFile(signingInfo.signedFileId, "signed-document.pdf");
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  // Cache-bust the PDF URL so PdfViewer re-fetches after each signature
  const pdfUrl = `${API_URL}/api/documents/${documentId}/view${pdfVersion ? `?v=${pdfVersion}` : ""}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--background)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)]">
        <div>
          <h2 className="text-lg font-semibold">
            {allSigned ? "Document Signed" : "Sign Document"}
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {allSigned
              ? "All signature fields have been completed."
              : "Click on the highlighted fields to add your signature."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {signingInfo && !allSigned && (
            <span className="text-sm text-[var(--muted-foreground)]">
              {signingInfo.signedFieldIds.length} of{" "}
              {signingInfo.signatureFields.length} signed
            </span>
          )}
          {allSigned && signingInfo?.signedFileId && (
            <button
              onClick={handleDownloadSigned}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors cursor-pointer"
            >
              <Download size={14} />
              Download Signed
            </button>
          )}
          {allSigned ? (
            <button
              onClick={handleClose}
              className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors cursor-pointer"
            >
              Done
            </button>
          ) : (
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-[var(--muted)] transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* PDF area */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-[var(--muted-foreground)] text-sm">
            Loading document...
          </div>
        ) : (
          <PdfViewer
            url={pdfUrl}
            overlay={
              allSigned
                ? undefined
                : (pageNumber) => (
                    <div className="absolute inset-0">
                      {signingInfo?.signatureFields
                        .filter((f) => f.pageNumber === pageNumber - 1)
                        .map((field) => {
                          const isSigned = signingInfo.signedFieldIds.includes(
                            field.id,
                          );
                          return (
                            <div
                              key={field.id}
                              className={`absolute flex items-center justify-center rounded border-2 transition-colors ${
                                isSigned
                                  ? "border-green-500 bg-green-50/60"
                                  : "border-amber-400 bg-amber-50/70 cursor-pointer hover:bg-amber-100/80"
                              }`}
                              style={{
                                left: `${field.x * 100}%`,
                                top: `${field.y * 100}%`,
                                width: `${field.width * 100}%`,
                                height: `${field.height * 100}%`,
                              }}
                              onClick={() => {
                                if (!isSigned) {
                                  setActiveFieldId(field.id);
                                  setSignatureDataUrl(null);
                                }
                              }}
                            >
                              {isSigned ? (
                                <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                                  <Check size={14} /> Signed
                                </span>
                              ) : (
                                <span className="text-xs text-amber-700 font-medium">
                                  Sign Here
                                </span>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )
            }
          />
        )}
      </div>

      {/* Signature capture modal */}
      {activeFieldId && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSignatureCapture();
          }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md mx-4 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Add Your Signature</h3>
              <button
                onClick={closeSignatureCapture}
                className="p-1 rounded-lg hover:bg-[var(--muted)] transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <SignaturePad
              onSignatureChange={handleSignatureChange}
            />

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={closeSignatureCapture}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleApplySignature}
                disabled={!signatureDataUrl || submitting}
                className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? "Applying..." : "Apply Signature"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
