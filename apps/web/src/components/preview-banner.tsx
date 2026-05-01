"use client";

import { Eye, X } from "lucide-react";
import { usePreviewMode } from "@/lib/preview-mode";

export function PreviewBanner() {
  const { preview, exitPreview } = usePreviewMode();
  if (!preview) return null;

  return (
    <div
      className="sticky top-0 z-40 w-full border-b border-amber-300 bg-amber-100 text-amber-900"
      role="status"
      aria-label="Preview mode banner"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-sm sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 min-w-0">
          <Eye size={16} className="shrink-0" />
          <span className="truncate">
            Previewing as <strong>{preview.clientName}</strong> — read-only
          </span>
        </div>
        <button
          type="button"
          onClick={exitPreview}
          className="flex shrink-0 items-center gap-1 rounded-md bg-amber-200 px-2.5 py-1 text-xs font-semibold hover:bg-amber-300"
        >
          <X size={12} />
          Exit preview
        </button>
      </div>
    </div>
  );
}
