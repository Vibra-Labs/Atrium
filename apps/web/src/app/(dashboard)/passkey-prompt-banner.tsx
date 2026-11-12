"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { registerPasskey } from "@/lib/passkeys";
import { deviceLabel, PASSKEY_PROMPT_DISMISSED_KEY, shouldOfferPasskey } from "@/lib/passkey-prompt";
import { useSession } from "@/lib/session-context";

interface PromptStatus {
  passkeysOffered: boolean;
  passkeyCount: number;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(PASSKEY_PROMPT_DISMISSED_KEY) === "1";
  } catch (err) {
    console.error("Could not read the passkey prompt setting", err);
    return false;
  }
}

/**
 * "Sign in faster next time": invites owners and admins without a passkey to
 * create one on this device. "Not now" is remembered on this device only.
 */
export function PasskeyPromptBanner(): React.ReactElement | null {
  const { onCustomDomain } = useSession();
  const [show, setShow] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "added">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<PromptStatus>("/two-factor/status")
      .then((status: PromptStatus) =>
        setShow(
          shouldOfferPasskey({
            passkeysOffered: status.passkeysOffered,
            passkeyCount: status.passkeyCount,
            onCustomDomain: onCustomDomain === true,
            dismissed: readDismissed(),
          }),
        ),
      )
      .catch((err: unknown) => console.error("Could not load two-factor status", err));
  }, [onCustomDomain]);

  const notNow = (): void => {
    try {
      localStorage.setItem(PASSKEY_PROMPT_DISMISSED_KEY, "1");
    } catch (err) {
      console.error("Could not remember the passkey prompt setting", err);
    }
    setShow(false);
  };

  const create = async (): Promise<void> => {
    setState("busy");
    setError("");
    const result = await registerPasskey(deviceLabel(navigator.userAgent));
    if (result.ok) {
      setState("added");
      return;
    }
    setState("idle");
    if (result.message) setError(result.message);
  };

  if (!show) return null;

  return (
    <div
      data-testid="passkey-prompt"
      className="mb-6 p-3 rounded-lg border border-[var(--border)] bg-[var(--muted)] flex flex-col sm:flex-row sm:items-center gap-2 text-sm"
    >
      <div className="flex items-center gap-2 flex-1">
        <KeyRound size={14} className="shrink-0 text-[var(--primary)]" aria-hidden />
        {state === "added" ? (
          <span>
            <strong>Passkey created.</strong> Next time, pick it from the email field on the sign-in page.
          </span>
        ) : (
          <span>
            <strong>Sign in faster next time.</strong> Create a passkey for this device: your fingerprint, face or
            PIN instead of a password.
            {error && <span role="alert" className="block text-red-600">{error}</span>}
          </span>
        )}
      </div>
      {state === "added" ? (
        <button type="button" onClick={() => setShow(false)} className="shrink-0 font-medium text-[var(--primary)] hover:underline">
          Done
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => void create()}
            disabled={state === "busy"}
            className="rounded-md bg-[var(--primary)] px-3 py-1.5 font-medium text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {state === "busy" ? "Waiting for your device…" : "Create a passkey"}
          </button>
          <button type="button" onClick={notNow} className="text-[var(--muted-foreground)] hover:underline">
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
