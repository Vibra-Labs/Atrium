"use client";

import { useEffect, useState } from "react";
import { setActiveOrgAndRedirect } from "@/lib/api";
import { postAuth } from "@/lib/auth-fetch";
import { oauthResumeUrl } from "@/lib/oauth-resume";
import { safeNextPath } from "@/lib/magic-link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * The second-factor step. Two ways in: right after a password (no session
 * yet; Better Auth holds the challenge in a cookie), or from a session that
 * has not passed its second factor (email link, or any refused API call).
 * "Trust this device" exists only on the first, where Better Auth supports it.
 */
export function TwoFactorForm(): React.ReactElement {
  const [mode, setMode] = useState<"loading" | "challenge" | "step-up">("loading");
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/auth/get-session`, { credentials: "include" })
      .then(async (res: Response) => {
        const data: unknown = res.ok ? await res.json() : null;
        setMode(data && typeof data === "object" && "user" in data ? "step-up" : "challenge");
      })
      .catch((err: unknown) => {
        console.error("Failed to read session", err);
        setMode("challenge");
      });
  }, []);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const path: string = useRecovery ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp";
    const body: Record<string, unknown> = { code: code.trim() };
    if (mode === "challenge" && trustDevice) body.trustDevice = true;
    const result = await postAuth(path, body);
    if (!result.ok) {
      setBusy(false);
      setError(
        result.status === 401 && mode === "challenge" && result.code === "INVALID_TWO_FACTOR_COOKIE"
          ? "This sign-in expired. Go back and sign in again."
          : result.message || "That code didn't work.",
      );
      return;
    }
    const resumeUrl: string | null = oauthResumeUrl(window.location.search, API_URL);
    const next: string | null = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    window.location.href = resumeUrl ?? next ?? (await setActiveOrgAndRedirect("/portal/projects"));
  };

  const signOut = async (): Promise<void> => {
    try {
      await fetch(`${API_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "include",
      });
    } catch (err) {
      console.error("Sign out failed", err);
    }
    window.location.href = "/login";
  };

  if (mode === "loading") return <div className="min-h-screen" />;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Two-factor authentication</h1>
          <p className="text-[var(--muted-foreground)] mt-2">
            {useRecovery
              ? "Enter one of your recovery codes."
              : "Enter the 6-digit code from your authenticator app."}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {error && <div role="alert" className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>}
          <div className="space-y-2">
            <label htmlFor="code" className="text-sm font-medium">
              {useRecovery ? "Recovery code" : "Code"}
            </label>
            <input
              id="code"
              autoFocus
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] font-mono"
              required
            />
          </div>
          {mode === "challenge" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
              Trust this device for 30 days
            </label>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2 px-4 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg font-medium disabled:opacity-50"
          >
            {busy ? "Checking…" : "Verify"}
          </button>
        </form>
        <div className="flex justify-between text-sm">
          <button
            type="button"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setCode("");
              setError("");
            }}
            className="text-[var(--primary)] hover:underline"
          >
            {useRecovery ? "Use your authenticator app" : "Use a recovery code"}
          </button>
          <button type="button" onClick={signOut} className="text-[var(--muted-foreground)] hover:underline">
            Sign in as someone else
          </button>
        </div>
      </div>
    </div>
  );
}
