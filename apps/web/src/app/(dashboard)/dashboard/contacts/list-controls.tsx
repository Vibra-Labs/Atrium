"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ChevronLeft, ListFilter, X } from "lucide-react";

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
const categoryPanelClass =
  "absolute z-20 mt-1 min-w-[11rem] rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg py-1 text-sm";
/** Beside the category on wider screens; below it on a phone, where there's no room to the side. */
const valuePanelClass =
  "absolute z-30 right-0 top-full mt-1 sm:top-0 sm:right-full sm:mr-1 sm:mt-0 sm:-translate-y-1 min-w-[12rem] max-h-80 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg py-1 text-sm";
const itemClass =
  "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--muted)] focus:bg-[var(--muted)] outline-none";

/** Closes a popover on an outside click, or on Escape with focus back on its button. */
function useDismiss(
  open: boolean,
  close: () => void,
): { ref: React.RefObject<HTMLDivElement | null>; triggerRef: React.RefObject<HTMLButtonElement | null> } {
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!ref.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);
  return { ref, triggerRef };
}

/** Arrow keys, Home and End move focus among the items matching `selector`; true when handled. */
function moveFocus(e: React.KeyboardEvent<HTMLElement>, selector: string): boolean {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(selector));
  if (items.length === 0) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next: Record<string, number> = {
    ArrowDown: (i + 1) % items.length,
    ArrowUp: (i - 1 + items.length) % items.length,
    Home: 0,
    End: items.length - 1,
  };
  if (!(e.key in next)) return false;
  e.preventDefault();
  items[next[e.key]].focus();
  return true;
}

/** Focuses the first item matching `selector` inside `root` once it has rendered. */
function focusFirst(root: HTMLElement | null, selector: string): void {
  requestAnimationFrame(() => root?.querySelector<HTMLElement>(selector)?.focus());
}

const CATEGORY = '[data-menu-item="category"]';
const VALUE = '[data-menu-item="value"]';

interface FilterMenuProps {
  groups: FilterGroup[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

/**
 * One "Filter" button: pick a category, then a value (Linear-style). Values open beside the
 * categories on wider screens and below the category on a phone. Keyboard: arrows move, Enter or
 * ArrowRight opens a category, ArrowLeft goes back, Escape closes, Tab leaves.
 */
export function FilterMenu({ groups, values, onChange }: FilterMenuProps) {
  const [open, setOpen] = useState<boolean>(false);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const close = useCallback((): void => {
    setOpen(false);
    setGroupKey(null);
  }, []);
  const { ref, triggerRef } = useDismiss(open, close);

  function openGroup(key: string, withKeyboard: boolean): void {
    setGroupKey(key);
    if (withKeyboard) focusFirst(ref.current?.querySelector(`[data-group="${key}"]`) ?? null, VALUE);
  }

  function onCategoryKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "Tab") return close();
    if (moveFocus(e, CATEGORY)) return;
    const key = (document.activeElement as HTMLElement | null)?.dataset.groupKey;
    if (e.key === "ArrowRight" && key) {
      e.preventDefault();
      openGroup(key, true);
    }
  }

  function onValueKeyDown(e: React.KeyboardEvent<HTMLDivElement>, key: string): void {
    if (e.key === "Tab") return close();
    if (moveFocus(e, VALUE)) return e.stopPropagation();
    if (e.key === "ArrowLeft" || e.key === "Escape") {
      // Back to the category list, not out of the menu.
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setGroupKey(null);
      ref.current?.querySelector<HTMLElement>(`${CATEGORY}[data-group-key="${key}"]`)?.focus();
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) return close();
          setOpen(true);
          focusFirst(ref.current, CATEGORY);
        }}
        className={triggerClass}
      >
        <ListFilter size={14} aria-hidden="true" /> Filter
      </button>
      {open && (
        // No overflow here: it would clip the side panel. The category list is short.
        <div role="menu" aria-label="Filter by" onKeyDown={onCategoryKeyDown} className={`${categoryPanelClass} right-0`}>
          {groups.map((g) => (
            <div key={g.key} data-group={g.key} className="relative" onMouseEnter={() => setGroupKey(g.key)}>
              <button
                type="button"
                role="menuitem"
                data-menu-item="category"
                data-group-key={g.key}
                aria-haspopup="menu"
                aria-expanded={groupKey === g.key}
                // detail is 0 when Enter or Space "clicked" it: then focus moves into the values.
                onClick={(e) => openGroup(g.key, e.detail === 0)}
                className={`${itemClass} ${groupKey === g.key ? "bg-[var(--muted)]" : ""}`}
              >
                <span className="flex-1">{g.label}</span>
                {values[g.key] && <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" aria-hidden="true" />}
                <ChevronLeft size={14} aria-hidden="true" className="text-[var(--muted-foreground)] hidden sm:block" />
                <ChevronDown size={14} aria-hidden="true" className="text-[var(--muted-foreground)] sm:hidden" />
              </button>
              {groupKey === g.key && (
                <div
                  role="menu"
                  aria-label={g.label}
                  onKeyDown={(e) => onValueKeyDown(e, g.key)}
                  className={valuePanelClass}
                >
                  {g.options.length === 0 && (
                    <p className="px-3 py-1.5 text-[var(--muted-foreground)]">Nothing to filter by yet</p>
                  )}
                  {g.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="menuitemradio"
                      data-menu-item="value"
                      aria-checked={values[g.key] === o.value}
                      onClick={() => {
                        onChange(g.key, o.value);
                        close();
                        triggerRef.current?.focus();
                      }}
                      className={itemClass}
                    >
                      <span className="flex-1">{o.label}</span>
                      {values[g.key] === o.value && <Check size={14} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
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

const SORT_ITEM = '[data-menu-item="sort"]';

/** "Order by" button: pick a column and a direction. Arrow keys move, Escape closes. */
export function SortMenu({ options, sort, dir, onChange }: SortMenuProps) {
  const [open, setOpen] = useState<boolean>(false);
  const close = useCallback((): void => setOpen(false), []);
  const { ref, triggerRef } = useDismiss(open, close);
  const current = options.find((o) => o.value === sort) ?? options[0];
  const DirIcon = dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Order by ${current.label}, ${dir === "asc" ? "ascending" : "descending"}`}
        onClick={() => {
          if (open) return close();
          setOpen(true);
          focusFirst(ref.current, `${SORT_ITEM}[aria-checked="true"]`);
        }}
        className={triggerClass}
      >
        <DirIcon size={14} aria-hidden="true" /> {current.label}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Order by"
          onKeyDown={(e) => {
            if (e.key === "Tab") close();
            else moveFocus(e, SORT_ITEM);
          }}
          className={`${panelClass} right-0`}
        >
          <div role="group" aria-label="Column">
            <p className="px-3 pt-1 pb-1.5 text-xs text-[var(--muted-foreground)]" aria-hidden="true">
              Order by
            </p>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                data-menu-item="sort"
                aria-checked={o.value === current.value}
                onClick={() => onChange(o.value, o.value === current.value ? dir : o.defaultDir)}
                className={itemClass}
              >
                <span className="flex-1">{o.label}</span>
                {o.value === current.value && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Direction" className="border-t border-[var(--border)] mt-1 pt-1 flex gap-1 px-1">
            {(["asc", "desc"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="menuitemradio"
                data-menu-item="sort"
                aria-checked={dir === d}
                onClick={() => onChange(current.value, d)}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md outline-none focus:ring-1 focus:ring-[var(--primary)] ${
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
