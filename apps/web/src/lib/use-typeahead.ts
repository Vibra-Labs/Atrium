import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { apiFetch } from "@/lib/api";

export const TYPEAHEAD_DEBOUNCE_MS = 250;
export const TYPEAHEAD_LIMIT = 10;

/** `/path?search=term&limit=10`; the endpoint does the matching, so every record is findable. */
export function typeaheadUrl(path: string, term: string, limit: number = TYPEAHEAD_LIMIT): string {
  return `${path}?search=${encodeURIComponent(term)}&limit=${Math.min(limit, 100)}`;
}

/**
 * Server-side search for a picker: debounced, and a slow response for an older term can't
 * overwrite a newer one. `loading` is true from a term change until its results arrive.
 */
export function useTypeahead<T>(
  path: string,
  term: string,
  enabled: boolean,
  limit: number = TYPEAHEAD_LIMIT,
): { items: T[]; loading: boolean } {
  const [result, setResult] = useState<{ term: string; items: T[] }>({ term: "", items: [] });
  const requestId = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      const id: number = ++requestId.current;
      apiFetch<{ data: T[] }>(typeaheadUrl(path, term, limit))
        .then((res) => {
          if (id === requestId.current) setResult({ term, items: res.data });
        })
        .catch((err: unknown) => {
          console.error(err);
          if (id === requestId.current) setResult({ term, items: [] });
        });
    }, TYPEAHEAD_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      // Responses still in flight belong to a term that is no longer current.
      requestId.current++;
    };
  }, [path, term, enabled, limit]);

  return { items: result.items, loading: enabled && result.term !== term };
}

/**
 * Keyboard support for a combobox whose listbox shows `count` options: ArrowUp/Down move the
 * active option, Enter picks it, Escape closes. Focus stays in the input throughout.
 */
export function useListboxKeys(
  count: number,
  open: boolean,
  setOpen: (open: boolean) => void,
  onPick: (index: number) => void,
  /** Changes whenever the typed text or the listed options change; the highlight is cleared then. */
  resetKey: string,
): { active: number; onKeyDown: (e: KeyboardEvent) => void; reset: () => void } {
  const [active, setActive] = useState<number>(-1);

  useEffect(() => setActive(-1), [resetKey]);

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (count === 0) return;
      const step: number = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a < 0 ? (step > 0 ? 0 : count - 1) : (a + step + count) % count));
    } else if (e.key === "Enter" && open && active >= 0 && active < count) {
      e.preventDefault();
      onPick(active);
      setActive(-1);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  return { active: active < count ? active : -1, onKeyDown, reset: () => setActive(-1) };
}
