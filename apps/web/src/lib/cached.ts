import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api";

interface Entry {
  data: unknown;
  /** Set by invalidate(): the data stays visible while it is re-read. */
  stale: boolean;
  loadedAt: number;
}

const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Load once per key; concurrent callers share the request. Resolves to null on failure.
 * Pass maxAgeMs for data that drifts (e.g. usage counts) so an old copy is re-read.
 */
export function loadCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  maxAgeMs: number = Infinity,
): Promise<T | null> {
  const entry: Entry | undefined = entries.get(key);
  if (entry && !entry.stale && Date.now() - entry.loadedAt < maxAgeMs) return Promise.resolve(entry.data as T);
  const inFlight: Promise<unknown> | undefined = pending.get(key);
  if (inFlight) return inFlight as Promise<T | null>;

  const request: Promise<T | null> = fetcher()
    .then((data: T): T => {
      // Only the request still registered for this key may write: an invalidate or clear
      // since it started means its data may already be out of date.
      if (pending.get(key) === request) entries.set(key, { data, stale: false, loadedAt: Date.now() });
      return data;
    })
    .catch((err: unknown): null => {
      console.error(`Failed to load ${key}`, err);
      return null;
    })
    .finally(() => {
      if (pending.get(key) !== request) return;
      pending.delete(key);
      notify();
    });
  pending.set(key, request);
  return request;
}

/** Mark a key stale so mounted consumers re-read it. */
export function invalidate(key: string): void {
  // Dropping the in-flight request means its (possibly pre-change) response is ignored.
  const entry: Entry | undefined = entries.get(key);
  entries.set(key, { data: entry?.data, stale: true, loadedAt: 0 });
  pending.delete(key);
  notify();
}

/** Forget everything (workspace switch) so consumers re-read the newly active workspace. */
export function clearCached(): void {
  entries.clear();
  pending.clear();
  notify();
}

/** Shared, per-workspace reference data. Null while loading (or if the load failed). */
export function useCached<T>(key: string, fetcher: () => Promise<T>): T | null {
  const entry: Entry | undefined = useSyncExternalStore(
    subscribe,
    () => entries.get(key),
    () => undefined,
  );

  useEffect(() => {
    if (!entry || entry.stale) void loadCached(key, fetcher);
    // fetcher is constant per key; depending on its identity would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, entry]);

  return (entry?.data as T | undefined) ?? null;
}

/** useCached for a GET endpoint; the path is the cache key (and what invalidate() takes). */
export function useCachedApi<T>(path: string): T | null {
  return useCached<T>(path, () => apiFetch<T>(path));
}

/** What the pages read from /billing/subscription. */
export interface SubscriptionInfo {
  subscription: {
    plan: { slug: string; maxProjects: number; maxClients: number; maxMembers: number } | null;
  } | null;
  usage: { clients: number; members: number };
}

// Usage counts change as people add contacts and teammates, so don't trust an old copy.
const SUBSCRIPTION_MAX_AGE_MS = 60_000;

export function loadSubscription(): Promise<SubscriptionInfo | null> {
  return loadCached(
    "/billing/subscription",
    () => apiFetch<SubscriptionInfo>("/billing/subscription"),
    SUBSCRIPTION_MAX_AGE_MS,
  );
}
