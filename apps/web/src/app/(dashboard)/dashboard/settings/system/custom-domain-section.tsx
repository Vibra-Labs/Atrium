"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Lock, Sparkles, X } from "lucide-react";
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
    : (process.env.NEXT_PUBLIC_DOMAIN ?? "");

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
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

function DnsRecord({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-[var(--background)] border border-[var(--border)] rounded font-mono text-xs">
      <span className="text-[var(--muted-foreground)] shrink-0">{label}</span>
      <span className="truncate">{value}</span>
      <CopyButton value={value} />
    </div>
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
  const { success, error: showError } = useToast();

  useEffect(() => {
    Promise.all([
      apiFetch<Subscription>("/billing/subscription").catch(() => null),
      apiFetch<CustomDomainData>("/settings/custom-domain").catch(() => null),
    ]).then(([sub, domainData]) => {
      setIsPaid(!sub || sub.plan.slug !== "free");
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

  // Free plan — premium feature gate
  if (!isPaid) {
    return (
      <div className="relative overflow-hidden rounded-lg border border-[var(--border)] p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--muted)]">
            <Lock size={15} className="text-[var(--muted-foreground)]" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">Custom Domain</p>
            <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
              Point your own domain (e.g. <span className="font-mono">portal.yourcompany.com</span>) to
              your client portal so clients never see our URL.
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 border border-amber-200">
            <Sparkles size={11} />
            Pro
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-[var(--border)] flex items-center justify-between">
          <p className="text-xs text-[var(--muted-foreground)]">Includes automatic SSL — no extra setup.</p>
          <a
            href="/dashboard/settings/billing"
            className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
          >
            Upgrade to Pro
            <ExternalLink size={11} />
          </a>
        </div>
      </div>
    );
  }

  const instructions = savedDomain
    ? getInstructions(provider, savedDomain, MAIN_DOMAIN)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="portal.yourcompany.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
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
            <div className="space-y-1.5">
              <DnsRecord label="Type" value="CNAME" />
              <DnsRecord label="Name" value={savedDomain} />
              <DnsRecord label="Value" value={MAIN_DOMAIN} />
            </div>

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
