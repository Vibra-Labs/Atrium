"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

interface PdfViewerModalProps {
  url: string;
  title: string;
  onClose: () => void;
}

export function PdfViewerModal({
  url,
  title,
  onClose,
}: PdfViewerModalProps): React.ReactElement {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold truncate">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <iframe
          src={url}
          title={title}
          className="flex-1 w-full border-0 bg-[var(--muted)]"
        />
      </div>
    </div>
  );
}
