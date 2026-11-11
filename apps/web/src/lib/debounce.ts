export interface Debounced<T> {
  /** Schedules `fn` with the latest value; earlier pending calls are dropped. */
  (value: T): void;
  /** Runs a pending call now, if there is one. */
  flush: () => void;
}

/** Calls `fn` once, `ms` after the last call, with the last value. */
export function debounce<T>(fn: (value: T) => void, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;

  const flush = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    fn(value);
  };

  const debounced = (value: T): void => {
    pending = { value };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, ms);
  };
  debounced.flush = flush;
  return debounced;
}
