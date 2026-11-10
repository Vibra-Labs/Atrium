"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { DASHBOARD_WIDGETS, type DashboardWidget } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { toggleHidden } from "./dashboard-layout";

export interface DashboardLayoutState {
  /** null until loaded, so cards don't flash in and then disappear. */
  hidden: DashboardWidget[] | null;
  shows: (key: DashboardWidget) => boolean;
  toggle: (key: DashboardWidget) => void;
}

/** Loads and saves which dashboard cards this person has hidden. */
export function useDashboardLayout(): DashboardLayoutState {
  const [hidden, setHidden] = useState<DashboardWidget[] | null>(null);
  const { error: showError } = useToast();
  // Saves run one after another so the server ends on the latest choice, and only
  // the latest failed save rolls the switches back.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef<number>(0);

  useEffect(() => {
    apiFetch<{ hidden: DashboardWidget[] }>("/dashboard-layout")
      .then((res) => setHidden(res.hidden))
      .catch((err: unknown) => {
        console.error("Failed to load dashboard layout", err);
        setHidden([]);
      });
  }, []);

  const toggle = (key: DashboardWidget): void => {
    if (!hidden) return;
    const previous: DashboardWidget[] = hidden;
    const next: DashboardWidget[] = toggleHidden(hidden, key);
    const seq: number = ++latest.current;
    setHidden(next); // show the change at once; undo it if the save fails
    saving.current = saving.current
      .then(() => apiFetch("/dashboard-layout", { method: "PUT", body: JSON.stringify({ hidden: next }) }))
      .then(
        () => undefined,
        (err: unknown) => {
          console.error("Failed to save dashboard layout", err);
          if (seq === latest.current) setHidden(previous);
          showError(err instanceof Error ? err.message : "Couldn't save your dashboard");
        },
      );
  };

  return { hidden, shows: (key) => hidden !== null && !hidden.includes(key), toggle };
}

/** Header button with a show/hide switch for each dashboard card. */
export function CustomizeDashboard({ layout }: { layout: DashboardLayoutState }): React.ReactElement {
  const [open, setOpen] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={layout.hidden === null}
        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-sm font-medium hover:bg-[var(--muted)] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      >
        <SlidersHorizontal size={15} />
        <span>Customize</span>
      </button>
      {open && layout.hidden && (
        <div
          role="group"
          aria-label="Dashboard cards"
          className="absolute right-0 top-full mt-2 z-30 w-64 p-3 rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-lg space-y-1"
        >
          <p className="px-1 pb-1 text-xs text-[var(--muted-foreground)]">Choose which cards to show</p>
          {DASHBOARD_WIDGETS.map((w) => (
            <label
              key={w.key}
              className="flex items-center gap-2.5 px-1 py-1.5 rounded-lg text-sm cursor-pointer hover:bg-[var(--muted)]"
            >
              <input
                type="checkbox"
                checked={layout.shows(w.key)}
                onChange={() => layout.toggle(w.key)}
                className="accent-[var(--primary)]"
              />
              {w.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
