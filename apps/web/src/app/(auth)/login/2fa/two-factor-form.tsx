"use client";

import { useEffect, useState } from "react";
import { setActiveOrgAndRedirect } from "@/lib/api";
import { destinationAfterSignIn } from "@/lib/two-factor-redirect";
import { postAuth } from "@/lib/auth-fetch";
import { oauthResumeUrl } from "@/lib/oauth-resume";
import { safeNextPath } from "@/lib/magic-link";
import { signInWithPasskey } from "@/lib/passkeys";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * The second-factor step. Two ways in: right after a password (no session
 * yet; Better Auth holds the challenge in a cookie), or from a session that
 * has not passed its second factor (email link, or any refused API call).
 * "Trust this device" exists only on the first, where Better Auth supports it.
 * A passkey works in both (it is a sign-in of its own), except on an agency's
 * custom domain: passkeys belong to the main address.
 */
interface TwoFactorFormProps {
  onCustomDomain: boolean;
  /** The main web address, for "sign in there to use your passkey". */
  webUrl: string;
}

interface Methods {
  code: boolean;
  passkey: boolean;
}

export function TwoFactorForm({ onCustomDomain, webUrl }: TwoFactorFormProps): React.ReactElement {
  const [mode, setMode] = useState<"loading" | "challenge" | "step-up">("loading");
  const [methods, setMethods] = useState<Methods>({ code: true, passkey: false });
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const res: Response = await fetch(`${API_URL}/api/auth/get-session`, { credentials: "include" });
        const data: unknown = res.ok ? await res.json() : null;
        if (data && typeof data === "object" && "user" in data) {
          // Step-up: offer exactly the factors this user has.
          const statusRes: Response = await fetch(`${API_URL}/api/two-factor/status`, { credentials: "include" });
          if (statusRes.ok) {
            const status = (await statusRes.json()) as { totpEnabled?: boolean; passkeyCount?: number };
            setMethods({ code: status.totpEnabled === true, passkey: (status.passkeyCount ?? 0) > 0 });
          } else {
            // Can't tell which factors this user has: offer both rather than nothing.
            console.error(`Two-factor status failed: ${statusRes.status}`);
            setMethods({ code: true, passkey: true });
          }
          setMode("step-up");
          return;
        }
        // After a password: the challenge is for the authenticator app; a passkey sign-in also works.
        const optionsRes: Response = await fetch(`${API_URL}/api/sign-in-options`);
        const options = (optionsRes.ok ? await optionsRes.json() : {}) as { passkey?: boolean };
        setMethods({ code: true, passkey: options.passkey === true });
        setMode("challenge");
      } catch (err) {
        console.error("Failed to read session", err);
        setMode("challenge");
      }
    };
    void load();
  }, []);

  const finish = async (): Promise<void> => {
    const resumeUrl: string | null = oauthResumeUrl(window.location.search, API_URL);
    const next: string | null = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    window.location.href = resumeUrl ?? next ?? (await destinationAfterSignIn(() => setActiveOrgAndRedirect("/portal/projects")));
  };

  const usePasskey = async (): Promise<void> => {
    setBusy(true);
    setError("");
    const result = await signInWithPasskey();
    if (!result.ok) {
      setBusy(false);
      if (!("cancelled" in result)) setError(result.message || "That passkey didn't work.");
      return;
    }
    await finish();
  };

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
    await finish();
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

  const passkeyHere: boolean = methods.passkey && !onCustomDomain;
  // A passkey-only user on a custom domain: the passkey works at the main address.
  const passkeyElsewhere: boolean = methods.passkey && onCustomDomain && !methods.code;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Two-factor authentication</h1>
          <p className="text-[var(--muted-foreground)] mt-2">
            {!methods.code
              ? "Confirm it's you with your passkey."
              : useRecovery
                ? "Enter one of your recovery codes."
                : "Enter the 6-digit code from your authenticator app."}
          </p>
        </div>
        {passkeyElsewhere && (
          <p className="p-3 text-sm rounded-lg border border-[var(--border)]">
            Passkeys work on the main Atrium address.{" "}
            <a href={`${webUrl}/login`} className="text-[var(--primary)] hover:underline">
              Sign in at {webUrl.replace(/^https?:\/\//, "")}
            </a>{" "}
            to use yours.
          </p>
        )}
        {passkeyHere && (
          <button
            type="button"
            onClick={usePasskey}
            disabled={busy}
            className="w-full py-2 border border-[var(--border)] rounded-lg font-medium hover:bg-[var(--muted)] disabled:opacity-50"
          >
            {methods.code ? "Use a passkey instead" : "Use a passkey"}
          </button>
        )}
        {!methods.code && error && (
          <div role="alert" className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
        )}
        {methods.code && (
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
        )}
        <div className="flex justify-between text-sm">
          {methods.code ? (
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
          ) : (
            <span />
          )}
          <button type="button" onClick={signOut} className="text-[var(--muted-foreground)] hover:underline">
            Sign in as someone else
          </button>
        </div>
      </div>
    </div>
  );
}
