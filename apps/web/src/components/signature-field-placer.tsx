"use client";

import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { PdfViewer } from "./pdf-viewer";
import { apiFetch } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

type PlacedField = {
  id: string;
  pageNumber: number; // 0-indexed
  x: number; // 0-1
  y: number; // 0-1
  width: number; // 0-1
  height: number; // 0-1
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

  // Load existing fields using the admin document endpoint
  useEffect(() => {
    (async () => {
      try {
        const doc = await apiFetch<{
          signatureFields?: { id: string; pageNumber: number; x: number; y: number; width: number; height: number }[];
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
            })),
          );
        }
      } catch {
        // No existing fields — this is fine for new documents
      }
    })();
  }, [documentId]);

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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

      const defaultWidth = 0.25;
      const defaultHeight = 0.06;

      const normX = Math.max(0, Math.min(1 - defaultWidth, clickX / dimensions.width));
      const normY = Math.max(0, Math.min(1 - defaultHeight, clickY / dimensions.height));

      const newField: PlacedField = {
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pageNumber: pageNumber - 1, // convert to 0-indexed
        x: normX,
        y: normY,
        width: defaultWidth,
        height: defaultHeight,
      };

      setFields((prev) => [...prev, newField]);
    },
    [],
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--background)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)]">
        <div>
          <h2 className="text-lg font-semibold">Place Signature Fields</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Click on the document to place &quot;Sign Here&quot; markers.
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
                .map((field) => (
                  <div
                    key={field.id}
                    data-field
                    className="absolute flex items-center justify-center border-2 border-dashed border-amber-500 bg-amber-50/60 rounded select-none"
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
                    <span className="text-xs text-amber-700 font-medium whitespace-nowrap">
                      Sign Here
                    </span>
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
                ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}
