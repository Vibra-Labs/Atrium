"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";

interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  createdBy: string;
}

interface CreatedApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  key: string;
  createdAt: string;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "Never";
}

export function ApiKeysSection(): React.ReactElement {
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [name, setName] = useState<string>("");
  const [creating, setCreating] = useState<boolean>(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const { success, error: showError } = useToast();
  const confirm = useConfirm();

  const loadKeys = (): void => {
    apiFetch<ApiKeySummary[]>("/api-keys")
      .then((data) => setKeys(data))
      .catch((err: unknown) => {
        console.error(err);
        showError(err instanceof Error ? err.message : "Failed to load API keys");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (): Promise<void> => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const created = await apiFetch<CreatedApiKey>("/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setNewKey(created.key);
      setName("");
      success("API key created");
      loadKeys();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!newKey) return;
    const copied: boolean = await copyToClipboard(newKey);
    if (copied) success("Copied to clipboard");
    else showError("Could not copy. Select the key and copy it manually.");
  };

  const handleRevoke = async (key: ApiKeySummary): Promise<void> => {
    const ok = await confirm({
      title: "Revoke API key",
      message: `Revoke "${key.name}"? Anything using it will stop working immediately.`,
      confirmLabel: "Revoke",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/api-keys/${key.id}`, { method: "DELETE" });
      success("API key revoked");
      loadKeys();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to revoke API key");
    }
  };

  return (
    <section className="space-y-4 pb-8">
      <div className="flex items-center gap-2">
        <KeyRound size={18} />
        <h2 className="text-base font-semibold">API keys</h2>
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">
        A key acts as you in this workspace. Treat it like a password and revoke it if it leaks.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
          placeholder="Key name (e.g. Claude agent)"
          className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
        />
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={!name.trim() || creating}
          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          Create key
        </button>
      </div>

      {newKey && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 space-y-2">
          <p className="text-sm font-medium">Copy this key now. It will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code data-testid="new-api-key" className="flex-1 break-all rounded bg-[var(--muted)] px-2 py-1 text-xs">
              {newKey}
            </code>
            <button type="button" onClick={() => void handleCopy()} aria-label="Copy key" className="p-2">
              <Copy size={16} />
            </button>
          </div>
          <button type="button" onClick={() => setNewKey(null)} className="text-sm underline">
            I have saved it
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No API keys yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--muted-foreground)]">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Key</th>
              <th className="py-2 font-medium">Created by</th>
              <th className="py-2 font-medium">Created</th>
              <th className="py-2 font-medium">Last used</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} className="border-t border-[var(--border)]">
                <td className="py-2">{key.name}</td>
                <td className="py-2"><code className="text-xs">{key.keyPrefix}…</code></td>
                <td className="py-2">{key.createdBy}</td>
                <td className="py-2">{formatDate(key.createdAt)}</td>
                <td className="py-2">{formatDate(key.lastUsedAt)}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void handleRevoke(key)}
                    className="inline-flex items-center gap-1 text-red-600 hover:underline"
                  >
                    <Trash2 size={14} /> Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
