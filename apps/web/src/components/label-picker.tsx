"use client";

import { useState, useRef, useEffect } from "react";
import { Tag } from "lucide-react";

interface Label {
  id: string;
  name: string;
  color: string;
}

export function LabelPicker({
  labels,
  assigned,
  onToggle,
  disabled,
}: {
  labels: Label[];
  assigned: string[];
  onToggle: (labelId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const assignedSet = new Set(assigned);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
      >
        <Tag size={12} />
        Labels
        {assigned.length > 0 && (
          <span className="bg-[var(--muted)] px-1.5 py-0.5 rounded-full text-[10px]">
            {assigned.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-56 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg z-50 py-1 max-h-60 overflow-y-auto">
          {labels.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
              No labels yet. Create them in Settings.
            </p>
          ) : (
            labels.map((label) => (
              <button
                key={label.id}
                onClick={() => onToggle(label.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--muted)] transition-colors"
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: label.color }}
                />
                <span className="flex-1 text-left truncate">{label.name}</span>
                <input
                  type="checkbox"
                  checked={assignedSet.has(label.id)}
                  readOnly
                  className="rounded pointer-events-none"
                />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
