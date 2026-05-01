"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export function TwoFactorForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirectTo") ?? "/dashboard";
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path =
        mode === "totp"
          ? "/api/auth/two-factor/verify-totp"
          : "/api/auth/two-factor/verify-backup-code";
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, trustDevice: trust }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? "Invalid code");
        return;
      }
      router.push(redirectTo);
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        type="text"
        inputMode={mode === "totp" ? "numeric" : "text"}
        pattern={mode === "totp" ? "\\d{6}" : undefined}
        maxLength={mode === "totp" ? 6 : 32}
        placeholder={mode === "totp" ? "000000" : "Recovery code"}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="w-full rounded border px-3 py-2 font-mono"
        autoComplete="one-time-code"
        autoFocus
        required
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={trust}
          onChange={(e) => setTrust(e.target.checked)}
        />
        Trust this device for 30 days
      </label>
      <button
        type="submit"
        disabled={busy || !code}
        className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "Verifying…" : "Verify"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === "totp" ? "backup" : "totp"));
          setCode("");
          setError(null);
        }}
        className="block w-full text-center text-sm text-blue-700 hover:underline"
      >
        {mode === "totp" ? "Use a recovery code instead" : "Use authenticator app instead"}
      </button>
    </form>
  );
}
