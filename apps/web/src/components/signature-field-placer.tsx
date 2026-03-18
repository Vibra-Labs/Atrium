"use client";

import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { PdfViewer } from "./pdf-viewer";
import { apiFetch } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

type FieldType = "signature" | "date" | "initials" | "text" | "select";

type PlacedField = {
  id: string;
  pageNumber: number; // 0-indexed
  x: number; // 0-1
  y: number; // 0-1
  width: number; // 0-1
  height: number; // 0-1
  type: FieldType;
  label?: string;
  signerOrder: number;
  assignedTo?: string;
};

const fieldTypeLabels: Record<FieldType, string> = {
  signature: "Sign Here",
  date: "Date",
  initials: "Initials",
  text: "Text",
  select: "Select",
};

const fieldTypeColors: Record<FieldType, { border: string; bg: string; text: string }> = {
  signature: { border: "border-amber-500", bg: "bg-amber-50/60", text: "text-amber-700" },
  date: { border: "border-blue-500", bg: "bg-blue-50/60", text: "text-blue-700" },
  initials: { border: "border-purple-500", bg: "bg-purple-50/60", text: "text-purple-700" },
  text: { border: "border-green-500", bg: "bg-green-50/60", text: "text-green-700" },
  select: { border: "border-teal-500", bg: "bg-teal-50/60", text: "text-teal-700" },
};

const defaultFieldSizes: Record<FieldType, { width: number; height: number }> = {
  signature: { width: 0.25, height: 0.06 },
  date: { width: 0.18, height: 0.035 },
  initials: { width: 0.1, height: 0.05 },
  text: { width: 0.25, height: 0.035 },
  select: { width: 0.25, height: 0.035 },
};

interface SignatureFieldPlacerProps {
  documentId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function SignatureFieldPlacer({
  documentId,
  onClose,
  onSaved,
}: SignatureFieldPlacerProps) {
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeFieldType, setActiveFieldType] = useState<FieldType>("signature");
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  // Load existing fields using the admin document endpoint
  useEffect(() => {
    (async () => {
      try {
        const doc = await apiFetch<{
          signatureFields?: {
            id: string;
            pageNumber: number;
            x: number;
            y: number;
            width: number;
            height: number;
            type?: string;
            label?: string;
            signerOrder?: number;
            assignedTo?: string;
          }[];
        }>(`/documents/${documentId}`);
        if (doc.signatureFields?.length) {
          setFields(
            doc.signatureFields.map((f) => ({
              id: f.id,
              pageNumber: f.pageNumber,
              x: f.x,
              y: f.y,
              width: f.width,
              height: f.height,
              type: (f.type || "signature") as FieldType,
              label: f.label,
              signerOrder: f.signerOrder ?? 0,
              assignedTo: f.assignedTo,
            })),
          );
        }
      } catch {
        // No existing fields — this is fine for new documents
      }
    })();
  }, [documentId]);

  // Close on Escape (unless editing a field)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingFieldId) {
          setEditingFieldId(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, editingFieldId]);

  const handlePageClick = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      pageNumber: number,
      dimensions: { width: number; height: number },
    ) => {
      // Don't place if clicking on existing field
      if ((e.target as HTMLElement).closest("[data-field]")) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const sizes = defaultFieldSizes[activeFieldType];

      const normX = Math.max(0, Math.min(1 - sizes.width, clickX / dimensions.width));
      const normY = Math.max(0, Math.min(1 - sizes.height, clickY / dimensions.height));

      const newField: PlacedField = {
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pageNumber: pageNumber - 1, // convert to 0-indexed
        x: normX,
        y: normY,
        width: sizes.width,
        height: sizes.height,
        type: activeFieldType,
        signerOrder: 0,
      };

      setFields((prev) => [...prev, newField]);

      // Auto-open options editor for select fields
      if (activeFieldType === "select") {
        setEditingFieldId(newField.id);
        setEditingLabel("");
      }
    },
    [activeFieldType],
  );

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleDragStart = useCallback(
    (e: React.PointerEvent, fieldId: string, dimensions: { width: number; height: number }) => {
      const field = fields.find((f) => f.id === fieldId);
      if (!field) return;
      const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
      const offsetX = e.clientX - rect.left - field.x * dimensions.width;
      const offsetY = e.clientY - rect.top - field.y * dimensions.height;
      setDragging({ id: fieldId, offsetX, offsetY });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [fields],
  );

  const handleDragMove = useCallback(
    (e: React.PointerEvent, dimensions: { width: number; height: number }) => {
      if (!dragging) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const field = fields.find((f) => f.id === dragging.id);
      if (!field) return;

      const newX = Math.max(0, Math.min(1 - field.width, (e.clientX - rect.left - dragging.offsetX) / dimensions.width));
      const newY = Math.max(0, Math.min(1 - field.height, (e.clientY - rect.top - dragging.offsetY) / dimensions.height));

      setFields((prev) =>
        prev.map((f) => (f.id === dragging.id ? { ...f, x: newX, y: newY } : f)),
      );
    },
    [dragging, fields],
  );

  const handleDragEnd = useCallback(() => {
    setDragging(null);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch(`/documents/${documentId}/signature-fields`, {
        method: "PUT",
        body: JSON.stringify({
          fields: fields.map((f) => ({
            pageNumber: f.pageNumber,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            type: f.type,
            label: f.label,
            signerOrder: f.signerOrder,
            assignedTo: f.assignedTo,
          })),
        }),
      });
      onSaved();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to save signature fields");
    } finally {
      setSaving(false);
    }
  };

  const pdfUrl = `${API_URL}/api/documents/${documentId}/view`;
  const fieldTypes: FieldType[] = ["signature", "date", "initials", "text", "select"];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--background)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)]">
        <div>
          <h2 className="text-lg font-semibold">Place Fields</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Select a field type and click on the document to place it.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loadError && (
            <span className="text-sm text-red-500">{loadError}</span>
          )}
          <span className="text-sm text-[var(--muted-foreground)]">
            {fields.length} field{fields.length !== 1 ? "s" : ""} placed
          </span>
          <button
            onClick={handleSave}
            disabled={saving || fields.length === 0}
            className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? "Saving..." : "Save Fields"}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--muted)] transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Field type selector */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-[var(--border)] bg-[var(--muted)]/30">
        <span className="text-xs font-medium text-[var(--muted-foreground)] mr-2">Field type:</span>
        {fieldTypes.map((type) => {
          const colors = fieldTypeColors[type];
          const isActive = activeFieldType === type;
          return (
            <button
              key={type}
              onClick={() => setActiveFieldType(type)}
              className={`px-3 py-1 text-xs font-medium rounded-full border-2 transition-colors cursor-pointer ${
                isActive
                  ? `${colors.border} ${colors.bg} ${colors.text}`
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              }`}
            >
              {fieldTypeLabels[type]}
            </button>
          );
        })}
      </div>

      {/* Field label/options edit modal */}
      {editingFieldId && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingFieldId(null);
          }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="text-lg font-semibold">
              {fields.find((f) => f.id === editingFieldId)?.type === "select"
                ? "Configure Options"
                : "Configure Field"}
            </h3>
            <div>
              <label className="block text-sm text-[var(--muted-foreground)] mb-1.5">
                {fields.find((f) => f.id === editingFieldId)?.type === "select"
                  ? "Options (one per line)"
                  : "Label"}
              </label>
              {fields.find((f) => f.id === editingFieldId)?.type === "select" ? (
                <textarea
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  placeholder={"Option A\nOption B\nOption C"}
                  rows={5}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)] resize-none"
                  autoFocus
                />
              ) : (
                <input
                  type="text"
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  placeholder="Field label"
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                  autoFocus
                />
              )}
              {fields.find((f) => f.id === editingFieldId)?.type === "select" && (
                <p className="text-xs text-[var(--muted-foreground)] mt-1">
                  Enter each option on a separate line. The signer will choose one.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingFieldId(null)}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const label = fields.find((f) => f.id === editingFieldId)?.type === "select"
                    ? editingLabel.split("\n").map((l) => l.trim()).filter(Boolean).join(",")
                    : editingLabel.trim();
                  setFields((prev) =>
                    prev.map((f) =>
                      f.id === editingFieldId ? { ...f, label: label || undefined } : f,
                    ),
                  );
                  setEditingFieldId(null);
                }}
                className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF area */}
      <div className="flex-1 overflow-auto p-4">
        <PdfViewer
          url={pdfUrl}
          overlay={(pageNumber, dimensions) => (
            <div
              className="absolute inset-0"
              style={{ cursor: dragging ? "grabbing" : "crosshair" }}
              onClick={(e) => {
                if (!dragging) handlePageClick(e, pageNumber, dimensions);
              }}
              onPointerMove={(e) => handleDragMove(e, dimensions)}
              onPointerUp={handleDragEnd}
            >
              {fields
                .filter((f) => f.pageNumber === pageNumber - 1)
                .map((field) => {
                  const colors = fieldTypeColors[field.type];
                  return (
                    <div
                      key={field.id}
                      data-field
                      className={`absolute flex items-center justify-center border-2 border-dashed ${colors.border} ${colors.bg} rounded select-none`}
                      style={{
                        left: `${field.x * 100}%`,
                        top: `${field.y * 100}%`,
                        width: `${field.width * 100}%`,
                        height: `${field.height * 100}%`,
                        cursor: dragging?.id === field.id ? "grabbing" : "grab",
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, field.id, dimensions);
                      }}
                    >
                      <span className={`text-xs ${colors.text} font-medium whitespace-nowrap`}>
                        {fieldTypeLabels[field.type]}
                        {field.signerOrder > 0 && (
                          <span className="ml-1 text-[10px] opacity-70">#{field.signerOrder}</span>
                        )}
                      </span>
                      {/* Edit button for select/text fields to configure label/options */}
                      {(field.type === "select" || field.type === "text") && (
                        <button
                          className="absolute -top-2 -left-2 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-[10px] hover:bg-blue-600 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingFieldId(field.id);
                            setEditingLabel(field.label || "");
                          }}
                          title="Edit options"
                        >
                          ...
                        </button>
                      )}
                      <button
                        className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeField(field.id);
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
        />
      </div>
    </div>
  );
}
