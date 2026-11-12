"use client";

import { useState } from "react";
import { registerPasskey } from "@/lib/passkeys";

/** Longest name the API accepts. */
const MAX_NAME: number = 64;

interface AddPasskeyProps {
  onAdded: () => void;
  /** Button text, e.g. "Use a passkey" on setup, "Add a passkey" in settings. */
  label?: string;
}

/** Names a passkey ("MacBook", "iPhone") and runs the browser's passkey prompt. */
export function AddPasskey({ onAdded, label = "Add a passkey" }: AddPasskeyProps): React.ReactElement {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const result = await registerPasskey(name);
    setBusy(false);
    if (result.ok) {
      setName("");
      onAdded();
    } else if (result.message) {
      setError(result.message);
    }
  };

  return (
    <form onSubmit={add} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="passkey-name" className="text-sm font-medium">Name this passkey</label>
          <input
            id="passkey-name"
            placeholder="e.g. MacBook, iPhone"
            maxLength={MAX_NAME}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-56 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {busy ? "Waiting for your passkey…" : label}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
