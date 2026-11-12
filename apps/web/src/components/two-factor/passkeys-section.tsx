"use client";

import { useCallback, useEffect, useState } from "react";
import { AddPasskey } from "./add-passkey";
import type { TwoFactorStatus } from "./security-section";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: string | null;
}

async function postAuthJson(path: string, body: Record<string, unknown>): Promise<string | null> {
  const res: Response = await fetch(`${API_URL}/api/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = (await res.json().catch((err: unknown) => {
    console.error(err);
    return {};
  })) as { message?: string };
  return data.message || "Something went wrong";
}

interface PasskeysSectionProps {
  status: TwoFactorStatus;
  /** Reloads the status after a change. */
  onChange: () => void;
}

/** Settings → Security: the signed-in user's passkeys. */
export function PasskeysSection({ status, onChange }: PasskeysSectionProps): React.ReactElement {
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<void> => {
    try {
      const res: Response = await fetch(`${API_URL}/api/auth/passkey/list-user-passkeys`, { credentials: "include" });
      setPasskeys(res.ok ? ((await res.json()) as PasskeyRow[]) : []);
    } catch (err) {
      console.error("Could not load passkeys", err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = (): void => {
    void load();
    onChange();
  };

  const remove = async (id: string): Promise<void> => {
    setError("");
    const message: string | null = await postAuthJson("/passkey/delete-passkey", { id });
    if (message) setError(message);
    else changed();
  };

  const rename = async (e: React.FormEvent, id: string): Promise<void> => {
    e.preventDefault();
    setError("");
    const message: string | null = await postAuthJson("/passkey/update-passkey", { id, name: newName.trim() });
    if (message) {
      setError(message);
      return;
    }
    setRenaming(null);
    changed();
  };

  return (
    <section className="space-y-4 rounded-lg border border-[var(--border)] p-6">
      <div>
        <h2 className="text-lg font-semibold">Passkeys</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Sign in with your fingerprint, face or device PIN. A passkey also counts as your second step.
        </p>
      </div>

      {status.isOwner && status.passkeyCount === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">
          Add a passkey: it&apos;s faster than codes and can&apos;t be phished.
        </p>
      )}
      {status.passkeyCount > 0 && !status.totpEnabled && (
        <p className="text-sm text-amber-600">
          You have no recovery codes. Add a second passkey or an authenticator app as a backup, so losing a device
          doesn&apos;t lock you out.
        </p>
      )}

      {passkeys.length > 0 && (
        <ul aria-label="Your passkeys" className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {passkeys.map((p: PasskeyRow) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              {renaming === p.id ? (
                <form onSubmit={(e) => void rename(e, p.id)} className="flex gap-2">
                  <input
                    aria-label="New passkey name"
                    maxLength={64}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-48 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1"
                    required
                  />
                  <button type="submit" className="text-[var(--primary)] hover:underline">Save</button>
                  <button type="button" onClick={() => setRenaming(null)} className="text-[var(--muted-foreground)] hover:underline">
                    Cancel
                  </button>
                </form>
              ) : (
                <span>
                  <span className="font-medium">{p.name || "Passkey"}</span>
                  {p.createdAt && (
                    <span className="text-[var(--muted-foreground)]"> · added {new Date(p.createdAt).toLocaleDateString()}</span>
                  )}
                </span>
              )}
              {renaming !== p.id && (
                <span className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setRenaming(p.id);
                      setNewName(p.name || "");
                    }}
                    className="text-[var(--primary)] hover:underline"
                    aria-label={`Rename ${p.name || "passkey"}`}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(p.id)}
                    disabled={!status.canRemoveLastPasskey}
                    className="text-red-600 hover:underline disabled:opacity-50"
                    aria-label={`Remove ${p.name || "passkey"}`}
                  >
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!status.canRemoveLastPasskey && (
        <p className="text-xs text-[var(--muted-foreground)]">
          A workspace you help run requires two-factor, so you can&apos;t remove your last passkey. Add another passkey or
          an authenticator app first.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {status.passkeysOffered && <AddPasskey onAdded={changed} />}
    </section>
  );
}
