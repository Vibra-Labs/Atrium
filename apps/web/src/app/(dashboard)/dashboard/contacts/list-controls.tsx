"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronLeft, ChevronRight, ListFilter, X } from "lucide-react";

export type SortDir = "asc" | "desc";

export interface Choice {
  value: string;
  label: string;
}

export interface FilterGroup {
  key: string;
  label: string;
  options: Choice[];
}

export interface SortOption {
  value: string;
  label: string;
  /** Direction used when this column is first picked (e.g. money high to low). */
  defaultDir: SortDir;
}

/** Picking the current column flips its direction; a new column starts at its default. */
export function nextSort(
  current: { sort: string; dir: SortDir },
  option: SortOption,
): { sort: string; dir: SortDir } {
  if (current.sort === option.value) return { sort: option.value, dir: current.dir === "asc" ? "desc" : "asc" };
  return { sort: option.value, dir: option.defaultDir };
}

const triggerClass =
  "inline-flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors whitespace-nowrap";
const panelClass =
  "absolute z-20 mt-1 min-w-[12rem] max-h-80 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg py-1 text-sm";
const itemClass =
  "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--muted)] focus:bg-[var(--muted)] outline-none";

/** Closes a popover on an outside click or Escape. */
function useDismiss(open: boolean, close: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!ref.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);
  return ref;
}

interface FilterMenuProps {
  groups: FilterGroup[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

/** One "Filter" button: pick a category, then a value (Linear-style). */
export function FilterMenu({ groups, values, onChange }: FilterMenuProps) {
  const [open, setOpen] = useState<boolean>(false);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const close = (): void => {
    setOpen(false);
    setGroupKey(null);
  };
  const ref = useDismiss(open, close);
  const group = groups.find((g) => g.key === groupKey);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={triggerClass}
      >
        <ListFilter size={14} aria-hidden="true" /> Filter
      </button>
      {open && (
        <div role="menu" aria-label={group ? group.label : "Filter by"} className={`${panelClass} right-0`}>
          {group ? (
            <>
              <button type="button" role="menuitem" onClick={() => setGroupKey(null)} className={`${itemClass} text-[var(--muted-foreground)]`}>
                <ChevronLeft size={14} aria-hidden="true" /> {group.label}
              </button>
              {group.options.length === 0 && (
                <p className="px-3 py-1.5 text-[var(--muted-foreground)]">Nothing to filter by yet</p>
              )}
              {group.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={values[group.key] === o.value}
                  onClick={() => {
                    onChange(group.key, o.value);
                    close();
                  }}
                  className={itemClass}
                >
                  <span className="flex-1">{o.label}</span>
                  {values[group.key] === o.value && <Check size={14} aria-hidden="true" />}
                </button>
              ))}
            </>
          ) : (
            groups.map((g) => (
              <button key={g.key} type="button" role="menuitem" onClick={() => setGroupKey(g.key)} className={itemClass}>
                <span className="flex-1">{g.label}</span>
                <ChevronRight size={14} aria-hidden="true" className="text-[var(--muted-foreground)]" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface FilterChipsProps {
  groups: FilterGroup[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

/** Active filters as "Rating is Hot ×" chips, plus "Clear" when there are several. */
export function FilterChips({ groups, values, onChange }: FilterChipsProps) {
  const active = groups.filter((g) => values[g.key]);
  if (active.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {active.map((g) => {
        const label = g.options.find((o) => o.value === values[g.key])?.label ?? values[g.key];
        return (
          <span
            key={g.key}
            data-testid="filter-chip"
            className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-md border border-[var(--border)] bg-[var(--muted)] text-xs"
          >
            <span className="text-[var(--muted-foreground)]">{g.label} is</span>
            <span className="font-medium">{label}</span>
            <button
              type="button"
              aria-label={`Remove ${g.label} filter`}
              onClick={() => onChange(g.key, "")}
              className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--background)]"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        );
      })}
      {active.length > 1 && (
        <button
          type="button"
          onClick={() => active.forEach((g) => onChange(g.key, ""))}
          className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          Clear
        </button>
      )}
    </div>
  );
}

interface SortMenuProps {
  options: SortOption[];
  sort: string;
  dir: SortDir;
  onChange: (sort: string, dir: SortDir) => void;
}

/** "Order by" button: pick a column and a direction. */
export function SortMenu({ options, sort, dir, onChange }: SortMenuProps) {
  const [open, setOpen] = useState<boolean>(false);
  const ref = useDismiss(open, () => setOpen(false));
  const current = options.find((o) => o.value === sort) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Order by ${current.label}, ${dir === "asc" ? "ascending" : "descending"}`}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        <ArrowUpDown size={14} aria-hidden="true" /> {current.label}
      </button>
      {open && (
        <div role="menu" aria-label="Order by" className={`${panelClass} right-0`}>
          <p className="px-3 pt-1 pb-1.5 text-xs text-[var(--muted-foreground)]">Order by</p>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === current.value}
              onClick={() => onChange(o.value, o.value === current.value ? dir : o.defaultDir)}
              className={itemClass}
            >
              <span className="flex-1">{o.label}</span>
              {o.value === current.value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
          <div className="border-t border-[var(--border)] mt-1 pt-1 flex gap-1 px-1">
            {(["asc", "desc"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="menuitemradio"
                aria-checked={dir === d}
                onClick={() => onChange(current.value, d)}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md ${
                  dir === d ? "bg-[var(--muted)] font-medium" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                }`}
              >
                {d === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}
                {d === "asc" ? "Ascending" : "Descending"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface SortHeaderProps {
  option: SortOption;
  sort: string;
  dir: SortDir;
  onSort: (option: SortOption) => void;
  align?: "left" | "right";
}

/** A column header that sorts the list; clicking again flips the direction. */
export function SortHeader({ option, sort, dir, onSort, align = "left" }: SortHeaderProps) {
  const active = sort === option.value;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-2.5 font-medium ${align === "right" ? "text-right" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSort(option)}
        className={`group inline-flex items-center gap-1 hover:text-[var(--foreground)] ${active ? "text-[var(--foreground)]" : ""}`}
      >
        {option.label}
        <Icon size={12} aria-hidden="true" className={active ? "" : "opacity-0 group-hover:opacity-60"} />
      </button>
    </th>
  );
}
