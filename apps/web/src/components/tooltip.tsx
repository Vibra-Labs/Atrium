"use client";

import { useState, type ReactNode } from "react";

type Side = "top" | "bottom";

const SIDE_CLASS: Record<Side, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
};

export function Tooltip({
  label,
  side = "top",
  children,
}: {
  label: string;
  side?: Side;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={`absolute z-50 whitespace-nowrap rounded-md bg-[var(--muted)] border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--foreground)] shadow-md pointer-events-none ${SIDE_CLASS[side]}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
