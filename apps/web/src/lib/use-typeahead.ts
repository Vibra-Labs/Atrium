import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

export const TYPEAHEAD_DEBOUNCE_MS = 250;
export const TYPEAHEAD_LIMIT = 10;

/** `/path?search=term&limit=10`; the endpoint does the matching, so every record is findable. */
export function typeaheadUrl(path: string, term: string): string {
  return `${path}?search=${encodeURIComponent(term)}&limit=${TYPEAHEAD_LIMIT}`;
}

/**
 * Server-side search for a picker: debounced, and a slow response for an older term can't
 * overwrite a newer one. `loading` is true from a term change until its results arrive.
 */
export function useTypeahead<T>(
  path: string,
  term: string,
  enabled: boolean,
): { items: T[]; loading: boolean } {
  const [result, setResult] = useState<{ term: string; items: T[] }>({ term: "", items: [] });
  const requestId = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      const id: number = ++requestId.current;
      apiFetch<{ data: T[] }>(typeaheadUrl(path, term))
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
  }, [path, term, enabled]);

  return { items: result.items, loading: enabled && result.term !== term };
}
