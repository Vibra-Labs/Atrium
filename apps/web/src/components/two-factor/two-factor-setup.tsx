"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { postAuth } from "@/lib/auth-fetch";
import { RecoveryCodes } from "./recovery-codes";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

type Step = "start" | "codes" | "scan";

interface EnableResponse {
  totpURI: string;
  backupCodes: string[];
}

interface TwoFactorSetupProps {
  onDone: () => void;
}

/**
 * Turns on authenticator-app 2FA. Recovery codes are shown and confirmed as
 * saved before the code step, so 2FA never turns on without them.
 */
export function TwoFactorSetup({ onDone }: TwoFactorSetupProps): React.ReactElement {
  const [step, setStep] = useState<Step>("start");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState<EnableResponse | null>(null);
  const [saved, setSaved] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const secret: string = enabled ? (new URL(enabled.totpURI).searchParams.get("secret") ?? "") : "";

  useEffect(() => {
    if (!enabled) return;
    QRCode.toDataURL(enabled.totpURI, { margin: 1, width: 200 })
      .then(setQr)
      .catch((err: unknown) => console.error("QR code failed", err));
  }, [enabled]);

  const start = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res: Response = await fetch(`${API_URL}/api/auth/two-factor/enable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(password ? { password } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<EnableResponse> & { code?: string; message?: string };
      if (!res.ok) {
        // Accounts with a password confirm it; email-link-only accounts have none to give.
        if (data.code === "INVALID_PASSWORD" && !needsPassword) {
          setNeedsPassword(true);
          return;
        }
        throw new Error(data.message || "Could not start setup");
      }
      setEnabled({ totpURI: data.totpURI ?? "", backupCodes: data.backupCodes ?? [] });
      setStep("codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start setup");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const result = await postAuth("/two-factor/verify-totp", { code: code.trim() });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || "That code didn't work. Check the time on your phone and try again.");
      return;
    }
    onDone();
  };

  if (step === "start") {
    return (
      <form onSubmit={start} className="space-y-3">
        {needsPassword && (
          <div className="space-y-1">
            <label htmlFor="tf-password" className="text-sm font-medium">Confirm your password</label>
            <input
              id="tf-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
              required
            />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50">
          {busy ? "Starting…" : "Set up authenticator app"}
        </button>
      </form>
    );
  }

  if (step === "codes" && enabled) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="font-medium">Save your recovery codes</h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            If you lose your phone, a recovery code is how you get back in.
          </p>
        </div>
        <RecoveryCodes codes={enabled.backupCodes} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I saved these recovery codes
        </label>
        <button
          type="button"
          disabled={!saved}
          onClick={() => setStep("scan")}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <div>
        <h3 className="font-medium">Scan this with your authenticator app</h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          Google Authenticator, 1Password, Authy or any other app that shows 6-digit codes.
        </p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr && <img src={qr} alt="QR code for your authenticator app" width={200} height={200} />}
      <p className="text-xs text-[var(--muted-foreground)]">
        Can&apos;t scan? Enter this key: <code data-testid="totp-secret" className="break-all font-mono">{secret}</code>
      </p>
      <div className="space-y-1">
        <label htmlFor="tf-code" className="text-sm font-medium">6-digit code</label>
        <input
          id="tf-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-40 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 font-mono text-sm"
          required
        />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50">
        {busy ? "Checking…" : "Turn on two-factor"}
      </button>
    </form>
  );
}
