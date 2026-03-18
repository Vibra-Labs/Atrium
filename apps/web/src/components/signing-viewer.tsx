"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Check, Download, Calendar, Type, PenLine, ListChecks } from "lucide-react";
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
  type: string; // "signature" | "date" | "initials" | "text"
  label?: string;
  signerOrder: number;
  assignedTo?: string;
}

interface SigningInfo {
  documentId: string;
  requiresSignature: boolean;
  signatureFields: SignatureField[];
  signedFieldIds: string[];
  signedFileId: string | null;
  signingOrderEnabled?: boolean;
  status?: string;
}

interface SigningViewerProps {
  documentId: string;
  tokenMode?: string; // access token for public signing
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

const fieldTypeIcons: Record<string, typeof PenLine> = {
  signature: PenLine,
  initials: PenLine,
  date: Calendar,
  text: Type,
  select: ListChecks,
};

const fieldTypeLabels: Record<string, string> = {
  signature: "Sign Here",
  initials: "Initial Here",
  date: "Date",
  text: "Enter Text",
  select: "Select",
};

export function SigningViewer({
  documentId,
  tokenMode,
  onClose,
  onSigned,
}: SigningViewerProps) {
  // When tokenMode is set, use public token-based endpoints
  const signingInfoUrl = tokenMode
    ? `/documents/sign-via-token/${tokenMode}/signing-info`
    : `/documents/${documentId}/signing-info`;
  const signUrl = tokenMode
    ? `/documents/sign-via-token/${tokenMode}/sign`
    : `/documents/${documentId}/sign`;
  const viewUrl = tokenMode
    ? `${API_URL}/api/documents/sign-via-token/${tokenMode}/view`
    : `${API_URL}/api/documents/${documentId}/view`;
  const [signingInfo, setSigningInfo] = useState<SigningInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [activeFieldType, setActiveFieldType] = useState<string>("signature");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [signatureMethod, setSignatureMethod] = useState<"draw" | "type">("draw");
  const [textValue, setTextValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfVersion, setPdfVersion] = useState(0);

  const closeFieldCapture = useCallback(() => {
    setActiveFieldId(null);
    setActiveFieldType("signature");
    setSignatureDataUrl(null);
    setTextValue("");
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
        `${signingInfoUrl}`,
      );
      setSigningInfo(info);
    } catch (err) {
      console.error("Failed to fetch signing info:", err);
    } finally {
      setLoading(false);
    }
  }, [signingInfoUrl]);

  useEffect(() => {
    fetchSigningInfo();
  }, [fetchSigningInfo]);

  // Close on Escape (only if field modal is not open)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeFieldId) {
          closeFieldCapture();
        } else {
          handleClose();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeFieldId, closeFieldCapture]);

  const allSigned =
    signingInfo &&
    signingInfo.signatureFields.length > 0 &&
    signingInfo.signedFieldIds.length === signingInfo.signatureFields.length;

  const handleClose = () => {
    if (allSigned) onSigned();
    onClose();
  };

  const isFieldLocked = (field: SignatureField): boolean => {
    if (!signingInfo?.signingOrderEnabled || field.signerOrder === 0) return false;
    // Check if all prior-order fields are signed
    const priorFields = signingInfo.signatureFields.filter(
      (f) => f.signerOrder > 0 && f.signerOrder < field.signerOrder,
    );
    return priorFields.some((f) => !signingInfo.signedFieldIds.includes(f.id));
  };

  const handleFieldClick = (field: SignatureField) => {
    if (signingInfo?.signedFieldIds.includes(field.id)) return;
    if (isFieldLocked(field)) return;

    setActiveFieldId(field.id);
    setActiveFieldType(field.type || "signature");

    // Auto-fill date fields
    if (field.type === "date") {
      setTextValue(
        new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      );
    }
  };

  const handleApplyField = async () => {
    if (!activeFieldId) return;

    const field = signingInfo?.signatureFields.find((f) => f.id === activeFieldId);
    if (!field) return;

    setSubmitting(true);
    setError(null);
    try {
      const fieldType = field.type || "signature";

      if (fieldType === "date" || fieldType === "text") {
        // Text-based fields — send as JSON
        await apiFetch(`${signUrl}`, {
          method: "POST",
          body: (() => {
            const formData = new FormData();
            formData.append("method", "type");
            formData.append("fieldId", activeFieldId);
            formData.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
            formData.append("textValue", textValue);
            return formData;
          })(),
        });
      } else {
        // Signature/initials — send with image
        if (!signatureDataUrl) return;
        const blob = dataURLtoBlob(signatureDataUrl);
        const formData = new FormData();
        formData.append("signature", blob, "signature.png");
        formData.append("method", signatureMethod);
        formData.append("fieldId", activeFieldId);
        formData.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);

        await apiFetch(`${signUrl}`, {
          method: "POST",
          body: formData,
        });
      }

      closeFieldCapture();
      setPdfVersion((v) => v + 1);

      const updatedInfo = await apiFetch<SigningInfo>(
        `${signingInfoUrl}`,
      );
      setSigningInfo(updatedInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
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
  const pdfUrl = `${viewUrl}${pdfVersion ? `?v=${pdfVersion}` : ""}`;

  const activeField = signingInfo?.signatureFields.find((f) => f.id === activeFieldId);
  const isImageField = activeFieldType === "signature" || activeFieldType === "initials";
  const isTextBasedField = activeFieldType === "date" || activeFieldType === "text" || activeFieldType === "select";
  const selectOptions = activeFieldType === "select" && activeField?.label
    ? activeField.label.split(",").map((o) => o.trim()).filter(Boolean)
    : [];

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
              ? "All fields have been completed."
              : "Click on the highlighted fields to complete them."}
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
                          const isSigned = signingInfo.signedFieldIds.includes(field.id);
                          const locked = isFieldLocked(field);
                          const fieldType = field.type || "signature";
                          const Icon = fieldTypeIcons[fieldType] || PenLine;
                          const label = fieldTypeLabels[fieldType] || "Sign Here";

                          return (
                            <div
                              key={field.id}
                              className={`absolute flex items-center justify-center rounded border-2 transition-colors ${
                                isSigned
                                  ? "border-green-500 bg-green-50/60"
                                  : locked
                                    ? "border-gray-300 bg-gray-50/60 cursor-not-allowed"
                                    : "border-amber-400 bg-amber-50/70 cursor-pointer hover:bg-amber-100/80"
                              }`}
                              style={{
                                left: `${field.x * 100}%`,
                                top: `${field.y * 100}%`,
                                width: `${field.width * 100}%`,
                                height: `${field.height * 100}%`,
                              }}
                              onClick={() => handleFieldClick(field)}
                            >
                              {isSigned ? (
                                <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                                  <Check size={14} /> Done
                                </span>
                              ) : locked ? (
                                <span className="text-xs text-gray-400 font-medium">
                                  Waiting...
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs text-amber-700 font-medium">
                                  <Icon size={12} />
                                  {label}
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

      {/* Field capture modal */}
      {activeFieldId && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeFieldCapture();
          }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md mx-4 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {activeFieldType === "signature" && "Add Your Signature"}
                {activeFieldType === "initials" && "Add Your Initials"}
                {activeFieldType === "date" && "Confirm Date"}
                {activeFieldType === "text" && (activeField?.label || "Enter Text")}
                {activeFieldType === "select" && "Select an Option"}
              </h3>
              <button
                onClick={closeFieldCapture}
                className="p-1 rounded-lg hover:bg-[var(--muted)] transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Signature/initials: show signature pad */}
            {isImageField && (
              <SignaturePad
                onSignatureChange={handleSignatureChange}
              />
            )}

            {/* Date field: show pre-filled date */}
            {activeFieldType === "date" && (
              <div>
                <label className="block text-sm text-[var(--muted-foreground)] mb-1.5">Date</label>
                <input
                  type="text"
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                />
              </div>
            )}

            {/* Text field: show input */}
            {activeFieldType === "text" && (
              <div>
                <label className="block text-sm text-[var(--muted-foreground)] mb-1.5">
                  {activeField?.label || "Text"}
                </label>
                <input
                  type="text"
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="Type here..."
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                  autoFocus
                />
              </div>
            )}

            {/* Select field: show options */}
            {activeFieldType === "select" && selectOptions.length > 0 && (
              <div>
                <label className="block text-sm text-[var(--muted-foreground)] mb-2">
                  Choose an option
                </label>
                <div className="space-y-1.5">
                  {selectOptions.map((option) => (
                    <label
                      key={option}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        textValue === option
                          ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]"
                          : "border-[var(--border)] hover:bg-[var(--muted)]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="select-option"
                        value={option}
                        checked={textValue === option}
                        onChange={() => setTextValue(option)}
                        className="accent-[var(--primary)]"
                      />
                      <span className="text-sm">{option}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {activeFieldType === "select" && selectOptions.length === 0 && (
              <p className="text-sm text-[var(--muted-foreground)]">
                No options configured for this field.
              </p>
            )}

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={closeFieldCapture}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyField}
                disabled={
                  submitting ||
                  (isImageField && !signatureDataUrl) ||
                  (isTextBasedField && !textValue.trim())
                }
                className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? "Applying..." : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
