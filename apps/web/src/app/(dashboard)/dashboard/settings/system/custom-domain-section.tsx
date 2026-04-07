"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, RefreshCw, Sparkles, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";

interface Subscription {
  subscription: { plan: { slug: string } } | null;
}

interface CustomDomainData {
  customDomain: string | null;
}

// The admin is always on the main domain when in settings, so we can use
// window.location.hostname as the CNAME target rather than a build-time env var.
const MAIN_DOMAIN = typeof window !== "undefined" ? window.location.hostname : "";

// DNS provider metadata
const PROVIDERS = [
  { id: "cloudflare", label: "Cloudflare" },
  { id: "route53", label: "AWS Route 53" },
  { id: "godaddy", label: "GoDaddy" },
  { id: "namecheap", label: "Namecheap" },
  { id: "porkbun", label: "Porkbun" },
  { id: "google", label: "Google / Squarespace" },
  { id: "other", label: "Other" },
] as const;

type ProviderId = (typeof PROVIDERS)[number]["id"];

interface ProviderInstructions {
  note?: string;
  warning?: string;
  steps: string[];
}

function getInstructions(provider: ProviderId, domain: string, target: string): ProviderInstructions {
  switch (provider) {
    case "cloudflare":
      return {
        warning: 'Set "Proxy status" to DNS only (grey cloud icon). Proxied mode will break SSL provisioning.',
        steps: [
          "Open the Cloudflare dashboard and select your domain.",
          "Go to DNS → Records → Add record.",
          `Add: Type: CNAME  |  Name: ${domain}  |  Value: ${target}`,
          "Set Proxy status to DNS only (grey cloud).",
          "Click Save.",
        ],
      };
    case "route53":
      return {
        steps: [
          "Open the AWS Console → Route 53 → Hosted zones.",
          "Select your hosted zone and click Create record.",
          "Set Record type to CNAME.",
          `Set Record name to the subdomain (e.g. portal) and Value to: ${target}`,
          "Leave TTL as default. Click Create records.",
        ],
      };
    case "godaddy":
      return {
        steps: [
          "Log in to GoDaddy → My Products → your domain → DNS.",
          "Click Add New Record → Type: CNAME.",
          `Set Name to the subdomain (e.g. portal) and Value to: ${target}`,
          "Click Save.",
        ],
      };
    case "namecheap":
      return {
        steps: [
          "Log in to Namecheap → Domain List → Manage → Advanced DNS.",
          "Click Add New Record → CNAME Record.",
          `Set Host to the subdomain (e.g. portal) and Value to: ${target}`,
          "Click the checkmark to save.",
        ],
      };
    case "porkbun":
      return {
        steps: [
          "Log in to Porkbun → click DNS on your domain.",
          "Set Type to CNAME, Host to the subdomain (e.g. portal).",
          `Set Answer to: ${target}`,
          "Click Add.",
        ],
      };
    case "google":
      return {
        note: "Google Domains was acquired by Squarespace. The DNS interface is the same.",
        steps: [
          "Open Squarespace Domains → your domain → DNS → Custom Records.",
          "Set Host to the subdomain (e.g. portal), Type to CNAME.",
          `Set Data to: ${target}`,
          "Click Add Record.",
        ],
      };
    default:
      return {
        steps: [
          "Log in to your DNS provider and find DNS management.",
          `Add a CNAME record: Name = ${domain}, Value = ${target}`,
          "Save the record. DNS changes can take up to 48 hours to propagate.",
        ],
      };
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
      title="Copy"
    >
      {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
    </button>
  );
}

function DnsTable({ domain, target }: { domain: string; target: string }) {
  return (
    <table className="w-full text-xs font-mono border border-[var(--border)] rounded-lg overflow-hidden">
      <thead>
        <tr className="bg-[var(--muted)] text-[var(--muted-foreground)]">
          <th className="px-3 py-2 text-left font-medium w-16">Field</th>
          <th className="px-3 py-2 text-left font-medium">Value</th>
          <th className="w-8" />
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border)]">
        <tr>
          <td className="px-3 py-2 text-[var(--muted-foreground)]">Type</td>
          <td className="px-3 py-2">CNAME</td>
          <td />
        </tr>
        <tr>
          <td className="px-3 py-2 text-[var(--muted-foreground)]">Name</td>
          <td className="px-3 py-2 truncate max-w-0">{domain}</td>
          <td className="px-2"><CopyButton value={domain} /></td>
        </tr>
        <tr>
          <td className="px-3 py-2 text-[var(--muted-foreground)]">Value</td>
          <td className="px-3 py-2 truncate max-w-0">{target}</td>
          <td className="px-2"><CopyButton value={target} /></td>
        </tr>
      </tbody>
    </table>
  );
}

export function CustomDomainSection() {
  const [isPaid, setIsPaid] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [domain, setDomain] = useState("");
  const [savedDomain, setSavedDomain] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId>("cloudflare");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<null | "checking" | { verified: boolean; reason?: string }>(null);
  const { success, error: showError } = useToast();

  useEffect(() => {
    Promise.all([
      apiFetch<Subscription>("/billing/subscription").catch(() => null),
      apiFetch<CustomDomainData>("/settings/custom-domain").catch(() => null),
    ]).then(([sub, domainData]) => {
      setIsPaid(!sub || sub.subscription?.plan?.slug !== "free");
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
    setDomainError(null);
    setVerifyStatus(null);
    try {
      const result = await apiFetch<CustomDomainData>("/settings/custom-domain", {
        method: "PUT",
        body: JSON.stringify({ domain: domain.trim() }),
      });
      setSavedDomain(result.customDomain);
      success("Custom domain saved");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save domain";
      // Show conflict inline rather than as a toast so it's easier to act on
      if (message.toLowerCase().includes("already in use")) {
        setDomainError(message);
      } else {
        showError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setDomainError(null);
    setVerifyStatus(null);
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

  const handleVerify = async () => {
    setVerifyStatus("checking");
    try {
      const result = await apiFetch<{ verified: boolean; reason?: string }>("/settings/custom-domain/verify");
      setVerifyStatus(result);
    } catch {
      setVerifyStatus({ verified: false, reason: "Verification request failed" });
    }
  };

  if (loadingPlan) return null;

  // Free plan — premium feature gate
  if (!isPaid) {
    return (
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="portal.yourcompany.com"
            disabled
            className="w-full px-3 py-2 pr-16 border border-[var(--border)] rounded-lg bg-[var(--muted)] text-sm text-[var(--muted-foreground)] cursor-not-allowed select-none"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 text-[10px] font-semibold tracking-wide">
            <Sparkles size={9} />
            PRO
          </span>
        </div>
        <a
          href="/dashboard/settings/account?tab=billing&reason=custom-domain"
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          Upgrade to Pro
        </a>
      </div>
    );
  }

  const instructions = savedDomain
    ? getInstructions(provider, savedDomain, MAIN_DOMAIN)
    : null;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="portal.yourcompany.com"
            value={domain}
            onChange={(e) => { setDomain(e.target.value); setDomainError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className={`flex-1 px-3 py-2 border rounded-lg bg-[var(--background)] text-sm ${domainError ? "border-red-400" : "border-[var(--border)]"}`}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !domain.trim() || domain.trim() === savedDomain}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium disabled:opacity-50 shrink-0"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {savedDomain && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              title="Remove custom domain"
              className="px-2.5 py-2 border border-[var(--border)] rounded-lg text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 shrink-0"
            >
              {removing ? "…" : <X size={15} />}
            </button>
          )}
        </div>
        {domainError && (
          <p className="text-xs text-red-600">{domainError}</p>
        )}
      </div>

      {savedDomain && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifyStatus === "checking"}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-[var(--border)] rounded-md hover:bg-[var(--muted)] disabled:opacity-50"
          >
            <RefreshCw size={11} className={verifyStatus === "checking" ? "animate-spin" : ""} />
            {verifyStatus === "checking" ? "Checking DNS…" : "Verify DNS"}
          </button>
          {verifyStatus && verifyStatus !== "checking" && (
            <span className={`flex items-center gap-1 text-xs ${verifyStatus.verified ? "text-green-600" : "text-[var(--muted-foreground)]"}`}>
              {verifyStatus.verified
                ? <><Check size={11} /> DNS verified</>
                : <>{verifyStatus.reason}</>}
            </span>
          )}
        </div>
      )}

      {savedDomain && (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[var(--muted)] border-b border-[var(--border)]">
            <p className="text-xs font-medium">DNS Setup</p>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderId)}
              className="text-xs border border-[var(--border)] rounded-md px-2 py-1 bg-[var(--background)] cursor-pointer"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="p-4 space-y-4">
            <DnsTable domain={savedDomain} target={MAIN_DOMAIN} />

            {instructions?.warning && (
              <div className="flex gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                <span className="text-amber-600 shrink-0 mt-0.5">⚠</span>
                <p className="text-xs text-amber-800">{instructions.warning}</p>
              </div>
            )}

            {instructions?.note && (
              <p className="text-xs text-[var(--muted-foreground)]">{instructions.note}</p>
            )}

            <ol className="space-y-1.5">
              {instructions?.steps.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-xs text-[var(--muted-foreground)]">
                  <span className="shrink-0 font-mono text-[10px] mt-0.5 text-[var(--muted-foreground)] w-3">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <p className="text-xs text-[var(--muted-foreground)] pt-1 border-t border-[var(--border)]">
              SSL is provisioned automatically on first visit. DNS changes can take up to 48 hours.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
