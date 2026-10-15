"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { PaginatedResponse } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { useToast } from "@/components/toast";
import type { Delivery } from "./types";

const STATUS_STYLES: Record<Delivery["status"], string> = {
  success: "bg-green-500/15 text-green-700",
  pending: "bg-amber-500/15 text-amber-700",
  failed: "bg-red-500/15 text-red-700",
};

function statusLabel(d: Delivery): string {
  if (d.status === "pending" && d.attempts > 0) return "retrying";
  return d.status;
}

export function DeliveriesPanel({ integrationId }: { integrationId: string }): React.ReactElement {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { success, error: showError } = useToast();

  const load = useCallback((): void => {
    apiFetch<PaginatedResponse<Delivery>>(`/integrations/${integrationId}/deliveries?limit=50`)
      .then((res) => setDeliveries(res.data))
      .catch((err: unknown) => {
        console.error(err);
        showError(err instanceof Error ? err.message : "Failed to load deliveries");
      })
      .finally(() => setLoading(false));
  }, [integrationId, showError]);

  useEffect(() => {
    load();
  }, [load]);

  const resend = async (id: string): Promise<void> => {
    try {
      const result = await apiFetch<Delivery | null>(`/integrations/deliveries/${id}/resend`, { method: "POST" });
      if (result?.status === "success") success("Delivered");
      else showError(result?.lastError ?? "Delivery failed; it will be retried");
      load();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to resend");
    }
  };

  if (loading) return <p className="text-sm text-[var(--muted-foreground)] py-2">Loading deliveries…</p>;
  if (deliveries.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)] py-2">No deliveries yet.</p>;
  }

  return (
    <div className="space-y-1" data-testid="deliveries">
      <div className="flex justify-end">
        <button type="button" onClick={load} className="text-xs text-[var(--primary)] hover:underline">
          Refresh
        </button>
      </div>
      {deliveries.map((d) => (
        <div key={d.id} className="rounded border border-[var(--border)] text-sm" data-testid="delivery-row">
          <button
            type="button"
            onClick={() => setExpanded(expanded === d.id ? null : d.id)}
            className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
          >
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[d.status]}`}>
              {statusLabel(d)}
            </span>
            <code className="text-xs">{d.event}</code>
            {d.lastStatusCode !== null && (
              <span className="text-xs text-[var(--muted-foreground)]">HTTP {d.lastStatusCode}</span>
            )}
            <span className="ml-auto text-xs text-[var(--muted-foreground)]">
              {d.attempts} {d.attempts === 1 ? "attempt" : "attempts"} · {formatRelativeTime(d.createdAt)}
            </span>
          </button>
          {expanded === d.id && (
            <div className="space-y-2 border-t border-[var(--border)] px-3 py-2">
              {d.lastError && <p className="text-xs text-red-600 break-all">{d.lastError}</p>}
              {d.status === "pending" && d.nextAttemptAt && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Next attempt {new Date(d.nextAttemptAt).toLocaleString()}
                </p>
              )}
              <pre className="max-h-60 overflow-auto rounded bg-[var(--muted)] p-2 text-xs">
                {JSON.stringify(d.payload, null, 2)}
              </pre>
              <button
                type="button"
                onClick={() => void resend(d.id)}
                className="inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
              >
                <RotateCw size={12} /> Resend
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
