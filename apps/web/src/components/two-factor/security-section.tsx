"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { postAuth } from "@/lib/auth-fetch";
import { TwoFactorSetup } from "./two-factor-setup";
import { RecoveryCodes } from "./recovery-codes";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/** GET /api/two-factor/status. */
export interface TwoFactorStatus {
  enabled: boolean;
  pending: boolean;
  enrollmentRequired: boolean;
  workspaceRequires: boolean;
  isStaff: boolean;
  isOwner: boolean;
  recoveryCodesLeft: number | null;
  soloOwner: boolean;
  canTurnOff: boolean;
}

/** At or below this many codes left, the page warns. */
const LOW_CODES: number = 3;

type Action = "off" | "regenerate";

/** Posts to a Better Auth 2FA endpoint that wants the password only from accounts that have one. */
async function postWithPassword(
  path: string,
  password: string,
): Promise<{ ok: boolean; needsPassword: boolean; message?: string; data: Record<string, unknown> }> {
  const res: Response = await fetch(`${API_URL}/api/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(password ? { password } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: res.ok,
    needsPassword: !res.ok && data.code === "INVALID_PASSWORD" && !password,
    message: typeof data.message === "string" ? data.message : undefined,
    data,
  };
}

interface SecuritySectionProps {
  /** Called after 2FA turns on or off, e.g. to refresh an owner-only control. */
  onChange?: (status: TwoFactorStatus) => void;
}

/** Settings → Security: the signed-in user's own two-factor. */
export function SecuritySection({ onChange }: SecuritySectionProps): React.ReactElement {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next: TwoFactorStatus = await apiFetch<TwoFactorStatus>("/two-factor/status");
      setStatus(next);
      onChange?.(next);
    } catch (err) {
      console.error("Failed to load two-factor status", err);
    }
  }, [onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = (): void => {
    setAction(null);
    setCode("");
    setPassword("");
    setNeedsPassword(false);
    setError("");
  };

  const confirm = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!action) return;
    setBusy(true);
    setError("");
    try {
      // Prove the authenticator first; Better Auth then asks for the password where there is one.
      if (!needsPassword) {
        const check = await postAuth("/two-factor/verify-totp", { code: code.trim() });
        if (!check.ok) throw new Error(check.message || "That code didn't work.");
      }
      const path: string = action === "off" ? "/two-factor/disable" : "/two-factor/generate-backup-codes";
      const result = await postWithPassword(path, password);
      if (result.needsPassword) {
        setNeedsPassword(true);
        return;
      }
      if (!result.ok) throw new Error(result.message || "Something went wrong");
      if (action === "regenerate") setNewCodes((result.data.backupCodes as string[]) ?? []);
      reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <div className="h-24 animate-pulse rounded-lg bg-[var(--muted)]" />;

  return (
    <section className="space-y-4 rounded-lg border border-[var(--border)] p-6">
      <div>
        <h2 className="text-lg font-semibold">Two-factor authentication</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {status.enabled
            ? "On. Signing in asks for a code from your authenticator app."
            : "Add a code from an authenticator app to every sign-in."}
        </p>
      </div>

      {newCodes && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Your new recovery codes. The old ones no longer work.</p>
          <RecoveryCodes codes={newCodes} />
          <button type="button" onClick={() => setNewCodes(null)} className="text-sm text-[var(--primary)] hover:underline">
            Done
          </button>
        </div>
      )}

      {!status.enabled && !settingUp && (
        <button
          type="button"
          onClick={() => setSettingUp(true)}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
        >
          Turn on two-factor
        </button>
      )}
      {!status.enabled && settingUp && (
        <TwoFactorSetup
          onDone={() => {
            setSettingUp(false);
            void load();
          }}
        />
      )}

      {status.enabled && (
        <>
          {status.recoveryCodesLeft !== null && (
            <p className={`text-sm ${status.recoveryCodesLeft <= LOW_CODES ? "text-amber-600" : "text-[var(--muted-foreground)]"}`}>
              {status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? "" : "s"} left.
              {status.recoveryCodesLeft <= LOW_CODES && " Make new ones so you don't run out."}
            </p>
          )}
          {status.isOwner && (
            <p className="text-sm text-[var(--muted-foreground)]">
              {status.soloOwner
                ? "You're the only owner. Add a second owner, or keep your recovery codes somewhere safe: if you lose both your phone and your codes, only support can let you back in."
                : "Keep your recovery codes somewhere safe, away from your phone."}
            </p>
          )}

          {action === null ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAction("regenerate")}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
              >
                New recovery codes
              </button>
              <button
                type="button"
                disabled={!status.canTurnOff}
                onClick={() => setAction("off")}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-red-600 hover:bg-[var(--muted)] disabled:opacity-50"
              >
                Turn off
              </button>
            </div>
          ) : (
            <form onSubmit={confirm} className="space-y-3">
              {!needsPassword ? (
                <div className="space-y-1">
                  <label htmlFor="sec-code" className="text-sm font-medium">Code from your authenticator app</label>
                  <input
                    id="sec-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-40 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 font-mono text-sm"
                    required
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <label htmlFor="sec-password" className="text-sm font-medium">Confirm your password</label>
                  <input
                    id="sec-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full max-w-xs rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                    required
                  />
                </div>
              )}
              {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
                >
                  {action === "off" ? "Turn off two-factor" : "Make new codes"}
                </button>
                <button type="button" onClick={reset} className="text-sm text-[var(--muted-foreground)] hover:underline">
                  Cancel
                </button>
              </div>
            </form>
          )}
          {!status.canTurnOff && (
            <p className="text-xs text-[var(--muted-foreground)]">
              A workspace you help run requires two-factor, so it can&apos;t be turned off.
            </p>
          )}
        </>
      )}
    </section>
  );
}
