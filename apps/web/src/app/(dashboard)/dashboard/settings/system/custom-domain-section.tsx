"use client";

import { useEffect, useState } from "react";
import { Globe, Check, X, ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";

interface Subscription {
  plan: { slug: string };
}

interface CustomDomainData {
  customDomain: string | null;
}

const MAIN_DOMAIN =
  typeof window !== "undefined"
    ? window.location.host
    : process.env.NEXT_PUBLIC_DOMAIN ?? "";

export function CustomDomainSection() {
  const [isPaid, setIsPaid] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [domain, setDomain] = useState("");
  const [savedDomain, setSavedDomain] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { success, error: showError } = useToast();

  useEffect(() => {
    Promise.all([
      apiFetch<Subscription>("/billing/subscription").catch(() => null),
      apiFetch<CustomDomainData>("/settings/custom-domain").catch(() => null),
    ]).then(([sub, domainData]) => {
      if (sub) {
        setIsPaid(sub.plan.slug !== "free");
      } else {
        // Billing not enabled — treat as paid (self-hosters)
        setIsPaid(true);
      }
      if (domainData?.customDomain) {
        setSavedDomain(domainData.customDomain);
        setDomain(domainData.customDomain);
      }
      setLoadingPlan(false);
    });
  }, []);

  const handleSave = async () => {
    if (!domain.trim()) return;
    setSaving(true);
    try {
      const result = await apiFetch<CustomDomainData>("/settings/custom-domain", {
        method: "PUT",
        body: JSON.stringify({ domain: domain.trim() }),
      });
      setSavedDomain(result.customDomain);
      success("Custom domain saved");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save domain");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await apiFetch("/settings/custom-domain", { method: "DELETE" });
      setSavedDomain(null);
      setDomain("");
      success("Custom domain removed");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to remove domain");
    } finally {
      setRemoving(false);
    }
  };

  if (loadingPlan) return null;

  if (!isPaid) {
    return (
      <div className="p-4 border border-[var(--border)] rounded-lg space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Custom Domain</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Let your clients access the portal at your own domain.
          </p>
        </div>
        <input
          type="text"
          placeholder="portal.yourcompany.com"
          disabled
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--muted)] text-[var(--muted-foreground)] cursor-not-allowed text-sm"
        />
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-[var(--muted-foreground)]">
            Available on Pro and above
          </p>
          <a
            href="/dashboard/settings/billing"
            className="text-xs font-medium text-[var(--primary)] hover:underline flex items-center gap-1"
          >
            Upgrade to Pro
            <ExternalLink size={11} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="portal.yourcompany.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !domain.trim() || domain.trim() === savedDomain}
          className="px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {savedDomain && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={removing}
            className="px-3 py-2 border border-[var(--border)] rounded-lg text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {removing ? <span>...</span> : <X size={16} />}
          </button>
        )}
      </div>

      {savedDomain && (
        <div className="p-3 bg-[var(--muted)] rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-green-700">
            <Check size={13} />
            Active: {savedDomain}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-[var(--muted-foreground)]">DNS setup required:</p>
            <code className="block text-xs bg-[var(--background)] border border-[var(--border)] rounded px-2 py-1">
              CNAME {savedDomain} → {MAIN_DOMAIN}
            </code>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            SSL is provisioned automatically on first visit.
          </p>
        </div>
      )}

      {!savedDomain && (
        <p className="text-xs text-[var(--muted-foreground)]">
          Point a CNAME record at <code className="font-mono">{MAIN_DOMAIN}</code> after saving.
        </p>
      )}
    </div>
  );
}
