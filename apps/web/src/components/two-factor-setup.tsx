"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { apiFetch } from "@/lib/api";
import { BackupCodesDisplay } from "./backup-codes-display";

interface EnableResponse {
  totpURI: string;
  backupCodes: string[];
}

interface Props {
  onComplete: () => void;
}

type Stage = "intro" | "enter-code" | "show-codes" | "done";

export function TwoFactorSetup({ onComplete }: Props) {
  const [stage, setStage] = useState<Stage>("intro");
  const [secret, setSecret] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const password = window.prompt(
        "Please confirm your password to enable 2FA:",
      );
      if (!password) {
        setBusy(false);
        return;
      }
      const res = await apiFetch<EnableResponse>("/auth/two-factor/enable", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setBackupCodes(res.backupCodes);
      const params = new URL(res.totpURI).searchParams;
      setSecret(params.get("secret") ?? "");
      const qr = await QRCode.toDataURL(res.totpURI);
      setQrDataUrl(qr);
      setStage("enter-code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start setup");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/two-factor/verify-totp", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setStage("show-codes");
    } catch {
      setError("Invalid code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    setStage("done");
    onComplete();
  }

  if (stage === "intro") {
    return (
      <div>
        <p className="text-sm text-gray-700">
          Two-factor authentication adds a second step to sign-in using a code from
          an authenticator app like Google Authenticator, 1Password, or Authy.
        </p>
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Starting..." : "Set up 2FA"}
        </button>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (stage === "enter-code") {
    return (
      <div>
        <h3 className="font-semibold">Scan the QR code</h3>
        <p className="mt-1 text-sm text-gray-700">
          Open your authenticator app and scan this code, then enter the 6-digit
          code it shows.
        </p>
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt="TOTP QR code"
            className="my-3 h-48 w-48 border"
          />
        )}
        <details className="text-xs text-gray-600">
          <summary>Can't scan? Enter the secret manually</summary>
          <code className="mt-1 block break-all rounded bg-gray-100 p-2">{secret}</code>
        </details>
        <form onSubmit={verify} className="mt-4 flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded border px-3 py-2 font-mono"
            autoComplete="one-time-code"
            required
          />
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Verifying..." : "Verify"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (stage === "show-codes") {
    return <BackupCodesDisplay codes={backupCodes} onAcknowledge={finish} />;
  }

  return <p className="text-sm text-green-700">2FA is now enabled.</p>;
}
