"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Pencil, Plug, Send, Trash2 } from "lucide-react";
import { apiFetch, fetchAllPages } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { usePlanFeatures, useIsTrialing } from "@/lib/plan-features";
import { ProBadge, TrialTag, UpgradeLink } from "@/components/pro-badge";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { DestinationFormModal } from "./destination-form-modal";
import { DeliveriesPanel } from "./deliveries-panel";
import { TYPE_LABELS } from "./types";
import { IntegrationIcon } from "./integration-icon";
import type { CreatedIntegration, IntegrationSummary, ProjectOption, TestResult } from "./types";

type ModalState = { mode: "create" } | { mode: "edit"; integration: IntegrationSummary } | null;

/** Slack, Discord and signed-webhook destinations (Pro). */
export function DestinationsSection(): React.ReactElement {
  const planFeatures = usePlanFeatures();
  const isTrialing: boolean = useIsTrialing();
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [modal, setModal] = useState<ModalState>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const { success, error: showError } = useToast();
  const confirm = useConfirm();
  const allowed: boolean = planFeatures?.integrations ?? false;

  const load = useCallback((): void => {
    apiFetch<IntegrationSummary[]>("/integrations")
      .then(setIntegrations)
      .catch((err: unknown) => {
        console.error(err);
        showError(err instanceof Error ? err.message : "Failed to load integrations");
      })
      .finally(() => setLoading(false));
  }, [showError]);

  useEffect(() => {
    if (!allowed) return;
    load();
    fetchAllPages<ProjectOption>("/projects")
      .then((rows) => setProjects(rows.map((p) => ({ id: p.id, name: p.name }))))
      .catch((err: unknown) => console.error("Failed to load projects", err));
  }, [allowed, load]);

  const handleSaved = (saved: CreatedIntegration): void => {
    setModal(null);
    if (saved.secret) setRevealedSecret(saved.secret);
    success("Integration saved");
    load();
  };

  const setEnabled = async (integration: IntegrationSummary, enabled: boolean): Promise<void> => {
    // Flip the toggle right away; the list reload below brings back the server's view either way.
    setIntegrations((rows) => rows.map((r) => (r.id === integration.id ? { ...r, enabled } : r)));
    try {
      await apiFetch(`/integrations/${integration.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to update integration");
    } finally {
      load();
    }
  };

  const sendTest = async (integration: IntegrationSummary): Promise<void> => {
    try {
      const result = await apiFetch<TestResult>(`/integrations/${integration.id}/test`, { method: "POST" });
      if (result.ok) success(`Test delivered (HTTP ${result.statusCode})`);
      else showError(`Test failed: ${result.error ?? `HTTP ${result.statusCode}`}`);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to send test");
    }
  };

  const rotate = async (integration: IntegrationSummary): Promise<void> => {
    const ok = await confirm({
      title: "Rotate signing secret",
      message: "The current secret stops working immediately. Update your receiver with the new one.",
      confirmLabel: "Rotate",
    });
    if (!ok) return;
    try {
      const { secret } = await apiFetch<{ secret: string }>(`/integrations/${integration.id}/rotate-secret`, {
        method: "POST",
      });
      setRevealedSecret(secret);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to rotate secret");
    }
  };

  const remove = async (integration: IntegrationSummary): Promise<void> => {
    const ok = await confirm({
      title: "Delete integration",
      message: `Delete "${integration.name}"? Its delivery history is deleted too.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/integrations/${integration.id}`, { method: "DELETE" });
      success("Integration deleted");
      load();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to delete integration");
    }
  };

  const copySecret = async (): Promise<void> => {
    if (!revealedSecret) return;
    if (await copyToClipboard(revealedSecret)) success("Copied to clipboard");
    else showError("Could not copy. Select the secret and copy it manually.");
  };

  const projectScope = (i: IntegrationSummary): string => {
    if (i.projectIds.length === 0) return "All projects";
    const names: string[] = i.projectIds.map((id) => projects.find((p) => p.id === id)?.name ?? "Unknown");
    return names.length <= 2 ? names.join(", ") : `${names.length} projects`;
  };

  if (!planFeatures) {
    return <div className="h-24 max-w-2xl bg-[var(--muted)] rounded-lg animate-pulse" />;
  }

  if (!allowed) {
    return (
      <div className="max-w-2xl p-4 border border-[var(--border)] rounded-lg space-y-2" data-testid="integrations-locked">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Send portal activity to Slack, Discord and webhooks</span>
          <ProBadge />
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          Post approvals, comments, payments and more to your team&apos;s channels, or trigger Zapier, Make and n8n
          automations. Any integrations you set up earlier are paused until you upgrade.
        </p>
        <UpgradeLink reason="integrations" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Plug size={18} />
            <h2 className="text-base font-semibold">Slack, Discord &amp; webhooks</h2>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Send portal activity to Slack, Discord, or any URL. Failed deliveries are retried for about 15 hours.
          </p>
          {isTrialing && <TrialTag />}
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: "create" })}
          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium"
        >
          Add integration
        </button>
      </div>

      {revealedSecret && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 space-y-2" data-testid="signing-secret">
          <p className="text-sm font-medium">Copy this signing secret now. It will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code data-testid="signing-secret-value" className="flex-1 break-all rounded bg-[var(--muted)] px-2 py-1 text-xs">
              {revealedSecret}
            </code>
            <button type="button" onClick={() => void copySecret()} aria-label="Copy secret" className="p-2">
              <Copy size={16} />
            </button>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Each request carries <code>X-Atrium-Signature: t=&lt;unix time&gt;,v1=&lt;hex&gt;</code>, where v1 is
            the HMAC-SHA256 of <code>&lt;t&gt;.&lt;raw body&gt;</code> keyed with this secret.
          </p>
          <button type="button" onClick={() => setRevealedSecret(null)} className="text-sm underline">
            I have saved it
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
      ) : integrations.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No integrations yet.</p>
      ) : (
        <ul className="space-y-3">
          {integrations.map((i) => (
            <li key={i.id} className="rounded-lg border border-[var(--border)] p-4 space-y-3" data-testid="integration-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--muted)] px-2 py-0.5 text-xs font-medium">
                  <IntegrationIcon type={i.type} size={14} />
                  {TYPE_LABELS[i.type]}
                </span>
                <span className="font-medium">{i.name}</span>
                {!i.enabled && i.disabledReason && (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-700" data-testid="disabled-badge">
                    Disabled: repeated failures
                  </span>
                )}
                <label className="ml-auto flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={i.enabled}
                    onChange={(e) => void setEnabled(i, e.target.checked)}
                    aria-label={`Enable ${i.name}`}
                  />
                  Enabled
                </label>
              </div>
              <p className="text-xs text-[var(--muted-foreground)] break-all">
                {i.urlPreview} · {i.events.length} {i.events.length === 1 ? "event" : "events"} · {projectScope(i)}
              </p>
              {i.disabledReason && !i.enabled && (
                <p className="text-xs text-red-600">{i.disabledReason}. Check the URL, then turn it back on.</p>
              )}
              <div className="flex flex-wrap gap-3 text-sm">
                <button type="button" onClick={() => void sendTest(i)} className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline">
                  <Send size={14} /> Send test
                </button>
                <button type="button" onClick={() => setModal({ mode: "edit", integration: i })} className="inline-flex items-center gap-1 hover:underline">
                  <Pencil size={14} /> Edit
                </button>
                <button type="button" onClick={() => setOpenLog(openLog === i.id ? null : i.id)} className="hover:underline">
                  {openLog === i.id ? "Hide deliveries" : "Deliveries"}
                </button>
                {i.type === "webhook" && (
                  <button type="button" onClick={() => void rotate(i)} className="hover:underline">
                    Rotate secret
                  </button>
                )}
                <button type="button" onClick={() => void remove(i)} className="ml-auto inline-flex items-center gap-1 text-red-600 hover:underline">
                  <Trash2 size={14} /> Delete
                </button>
              </div>
              {openLog === i.id && <DeliveriesPanel integrationId={i.id} />}
            </li>
          ))}
        </ul>
      )}

      {modal && (
        <DestinationFormModal
          existing={modal.mode === "edit" ? modal.integration : undefined}
          projects={projects}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
