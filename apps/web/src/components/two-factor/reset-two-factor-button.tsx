"use client";

import { useState } from "react";
import { ShieldOff } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface ResetTwoFactorButtonProps {
  userId: string;
  name: string;
  onDone: () => void;
}

/**
 * Owner/admin action for a locked-out member: removes their two-factor and
 * signs them out everywhere. The API decides who may do it and asks for the
 * actor's own code when they have 2FA; its refusals are shown as written.
 */
export function ResetTwoFactorButton({ userId, name, onDone }: ResetTwoFactorButtonProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const close = (): void => {
    setOpen(false);
    setCode("");
    setError("");
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/two-factor/admin/${userId}`, {
        method: "DELETE",
        body: JSON.stringify(code.trim() ? { code: code.trim() } : {}),
      });
      close();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not turn off two-factor");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
        title="Turn off 2FA"
        aria-label={`Turn off 2FA for ${name}`}
      >
        <ShieldOff size={14} aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="reset-2fa-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-[var(--background)] p-6 shadow-lg">
            <h2 id="reset-2fa-title" className="text-lg font-semibold">Turn off 2FA for {name}?</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              This removes their authenticator and recovery codes and signs them out everywhere. They&apos;ll get an
              email. If your workspace requires two-factor, they set it up again at their next sign-in.
            </p>
            <div className="space-y-1">
              <label htmlFor="reset-2fa-code" className="text-sm font-medium">
                Your authenticator code (if you use two-factor)
              </label>
              <input
                id="reset-2fa-code"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-40 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 font-mono text-sm"
              />
            </div>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="px-3 py-2 text-sm text-[var(--muted-foreground)] hover:underline">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy ? "Turning off…" : "Turn off 2FA"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
