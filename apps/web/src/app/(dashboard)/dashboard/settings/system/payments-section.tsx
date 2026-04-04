"use client";

import { useEffect, useState, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { ExternalLink, Unlink, Key, ChevronDown } from "lucide-react";

interface PaymentStatus {
  mode: "direct" | "connect";
  enabled: boolean;
  livemode: boolean;
  paymentMethods: string[];
}

const DISCONNECTED: PaymentStatus = { mode: "direct", enabled: false, livemode: false, paymentMethods: ["card"] };

const METHOD_META: Record<string, { label: string; description: string; fee: string; bnpl?: boolean }> = {
  card:              { label: "Card",               description: "Visa, Mastercard, Amex, Apple Pay, Google Pay", fee: "2.9% + 30¢" },
  us_bank_account:   { label: "ACH bank transfer",  description: "US bank accounts (USD only)",             fee: "0.8%, max $5" },
  link:              { label: "Link",               description: "Stripe's one-click checkout (req. Card)",  fee: "2.9% + 30¢" },
  sepa_debit:        { label: "SEPA Direct Debit",  description: "European bank accounts (EUR only)",       fee: "0.8%, max €5" },
  ideal:             { label: "iDEAL",              description: "Dutch bank transfers (Netherlands only)",  fee: "80¢ flat" },
  bacs_debit:        { label: "Bacs Direct Debit",  description: "UK bank accounts (GBP only)",            fee: "1%, max £2" },
  klarna:            { label: "Klarna",             description: "Pay in installments",                     fee: "~3.29% + 30¢", bnpl: true },
  afterpay_clearpay: { label: "Afterpay / Clearpay",description: "Pay in 4 installments",                  fee: "~6% + 30¢",    bnpl: true },
  affirm:            { label: "Affirm",             description: "Pay over time",                           fee: "~6% + 30¢",    bnpl: true },
  cashapp:           { label: "Cash App Pay",       description: "Cash App mobile payments",               fee: "2.9% + 30¢" },
};

export function PaymentsSection() {
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [secretKey, setSecretKey] = useState("");
  const [selectedMethods, setSelectedMethods] = useState<string[]>(["card"]);
  const [savingMethods, setSavingMethods] = useState(false);
  const [availableMethods, setAvailableMethods] = useState<{ id: string; active: boolean }[]>([]);
  const [showMethods, setShowMethods] = useState(false);
  const { success, error: showError, info } = useToast();
  const connectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiFetch<PaymentStatus>("/payments/status")
      .then((data) => {
        setStatus(data);
        setSelectedMethods(data.paymentMethods?.length > 0 ? data.paymentMethods : ["card"]);
      })
      .catch(() => setStatus(DISCONNECTED))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return () => {
      if (connectTimeout.current) clearTimeout(connectTimeout.current);
    };
  }, []);

  useEffect(() => {
    if (status?.enabled !== true) return;
    apiFetch<{ methods: { id: string; active: boolean }[] }>("/payments/available-methods")
      .then((data) => setAvailableMethods(data.methods))
      .catch(() => {});
  }, [status?.enabled]);

  // Handle OAuth redirect results (Connect mode)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeParam = params.get("stripe");
    const errorParam = params.get("error");

    if (stripeParam === "connected") {
      success("Stripe account connected successfully");
      apiFetch<PaymentStatus>("/payments/status").then(setStatus);
    } else if (stripeParam === "cancelled" || errorParam === "access_denied") {
      info("Stripe connection was cancelled. You can try again whenever you're ready.");
    } else if (stripeParam === "error") {
      showError("Something went wrong connecting your Stripe account. Please try again.");
    }

    if (stripeParam || errorParam) {
      const url = new URL(window.location.href);
      url.searchParams.delete("stripe");
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Direct Keys handlers ──

  const handleSaveKey = async () => {
    if (!secretKey.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ livemode: boolean }>(
        "/payments/direct/save-key",
        {
          method: "POST",
          body: JSON.stringify({ stripeSecretKey: secretKey.trim() }),
        },
      );
      setSecretKey("");
      setStatus({ mode: "direct", enabled: true, livemode: res.livemode, paymentMethods: ["card"] });
      success("Stripe key saved. Webhook registered automatically.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save Stripe key");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveKey = async () => {
    if (!confirm("Remove your Stripe key? Clients will no longer be able to pay invoices online.")) {
      return;
    }
    setDisconnecting(true);
    try {
      await apiFetch("/payments/direct/remove-key", { method: "POST" });
      setStatus(DISCONNECTED);
      success("Stripe key removed");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to remove key");
    } finally {
      setDisconnecting(false);
    }
  };

  // ── Connect OAuth handlers ──

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const returnUrl = window.location.href.split("?")[0];
      const res = await apiFetch<{ url: string }>("/payments/connect/authorize", {
        method: "POST",
        body: JSON.stringify({ returnUrl }),
      });
      connectTimeout.current = setTimeout(() => {
        setConnecting(false);
        showError("Redirect took too long. Please try again.");
      }, 15000);
      window.location.href = res.url;
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to start Stripe Connect");
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect your Stripe account? Clients will no longer be able to pay invoices online.")) {
      return;
    }
    setDisconnecting(true);
    try {
      await apiFetch("/payments/connect/disconnect", { method: "POST" });
      setStatus({ ...DISCONNECTED, mode: "connect" });
      success("Stripe account disconnected");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSavePaymentMethods = async () => {
    setSavingMethods(true);
    try {
      await apiFetch("/payments/payment-methods", {
        method: "POST",
        body: JSON.stringify({ paymentMethods: selectedMethods }),
      });
      success("Payment methods saved");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save payment methods");
    } finally {
      setSavingMethods(false);
    }
  };

  if (loading) {
    return <div className="h-24 bg-[var(--muted)] rounded-lg animate-pulse" />;
  }

  // ── Connected state (either mode) ──
  if (status?.enabled) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 p-3 border border-[var(--border)] rounded-lg bg-[var(--muted)]">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm font-medium">Connected</span>
          <span className="text-xs text-[var(--muted-foreground)]">
            {status.mode === "connect" ? "via Stripe Connect" : "via API key"}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ml-auto ${
              status.livemode
                ? "bg-green-100 text-green-700"
                : "bg-yellow-100 text-yellow-700"
            }`}
          >
            {status.livemode ? "Live" : "Test mode"}
          </span>
        </div>
        {!status.livemode && (
          <p className="text-xs text-yellow-600">
            Clients cannot submit real payments in test mode. Use a live Stripe key to accept real payments.
          </p>
        )}
        <p className="text-xs text-[var(--muted-foreground)]">
          Clients can pay invoices directly from the portal. Payments go to your Stripe account.
        </p>
        <div className="pt-4 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={() => setShowMethods((v) => !v)}
            className="flex items-center justify-between w-full text-sm font-medium"
          >
            <span>Accepted payment methods</span>
            <ChevronDown
              size={16}
              className={`text-[var(--muted-foreground)] transition-transform ${showMethods ? "rotate-180" : ""}`}
            />
          </button>
          {showMethods && (
            <div className="mt-3 space-y-3">
              {availableMethods.length === 0 ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-10 bg-[var(--muted)] rounded animate-pulse" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-1 pb-1 border-b border-[var(--border)]">
                    <span className="text-xs text-[var(--muted-foreground)]">Method</span>
                    <span className="text-xs text-[var(--muted-foreground)]">Stripe fee</span>
                  </div>
                  {availableMethods.map((m) => {
                    const meta = METHOD_META[m.id];
                    if (!meta) return null;
                    // Can't uncheck the last selected method
                    const isLastSelected = selectedMethods.includes(m.id) && selectedMethods.length === 1;
                    const disabled = !m.active || isLastSelected;
                    return (
                      <label key={m.id} className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          checked={selectedMethods.includes(m.id)}
                          disabled={disabled}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedMethods((prev) => [...prev, m.id]);
                            else setSelectedMethods((prev) => prev.filter((x) => x !== m.id));
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                        />
                        <span className="flex-1">
                          <span className="flex items-center justify-between">
                            <span className="text-sm font-medium">{meta.label}</span>
                            <span className="text-xs text-[var(--muted-foreground)] font-mono">{meta.fee}</span>
                          </span>
                          <span className="block text-xs text-[var(--muted-foreground)]">{meta.description}</span>
                          {!m.active && (
                            <span className="block text-xs text-[var(--muted-foreground)] mt-0.5">
                              {meta.bnpl ? (
                                <>Enable in your{" "}
                                  <a
                                    href="https://dashboard.stripe.com/settings/payment_methods"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Stripe dashboard
                                  </a>
                                  {" "}to use this</>
                              ) : (
                                <span className="relative group/tip inline-block">
                                  Not available for your Stripe account
                                  <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 w-56 rounded-md bg-[var(--foreground)] text-[var(--background)] text-xs px-2.5 py-1.5 opacity-0 group-hover/tip:opacity-100 transition-opacity z-10 shadow-md">
                                    You may be able to enable this in your{" "}
                                    <a
                                      href="https://dashboard.stripe.com/settings/payment_methods"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="underline pointer-events-auto"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      Stripe dashboard
                                    </a>
                                    {" "}based on your account's country and capabilities.
                                  </span>
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                  <button
                    type="button"
                    onClick={handleSavePaymentMethods}
                    disabled={savingMethods}
                    className="px-3 py-1.5 text-sm bg-[var(--primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {savingMethods ? "Saving..." : "Save methods"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={status.mode === "connect" ? handleDisconnect : handleRemoveKey}
          disabled={disconnecting}
          className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
        >
          <Unlink size={14} />
          {disconnecting
            ? "Disconnecting..."
            : status.mode === "connect"
              ? "Disconnect Stripe"
              : "Remove Stripe Key"}
        </button>
      </div>
    );
  }

  // ── Not connected: Connect mode ──
  if (status?.mode === "connect") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-foreground)]">
          Connect your Stripe account to let clients pay invoices directly from the portal.
        </p>
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className="flex items-center gap-2 px-4 py-2 bg-[#635bff] text-white rounded-lg text-sm font-medium hover:bg-[#5851db] transition-colors"
        >
          <ExternalLink size={16} />
          {connecting ? "Redirecting..." : "Connect with Stripe"}
        </button>
      </div>
    );
  }

  // ── Not connected: Direct keys mode ──
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted-foreground)]">
        Enter your Stripe secret key to let clients pay invoices directly from the portal.
        Your key is stored encrypted and never displayed again.
      </p>
      <div className="space-y-2">
        <input
          type="password"
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          placeholder="sk_test_... or sk_live_..."
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm font-mono"
        />
        <p className="text-xs text-[var(--muted-foreground)]">
          Find your key at{" "}
          <a
            href="https://dashboard.stripe.com/apikeys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary)] hover:underline"
          >
            dashboard.stripe.com/apikeys
          </a>
        </p>
      </div>
      <button
        type="button"
        onClick={handleSaveKey}
        disabled={saving || !secretKey.trim()}
        className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        <Key size={16} />
        {saving ? "Connecting..." : "Save & Connect"}
      </button>
    </div>
  );
}
