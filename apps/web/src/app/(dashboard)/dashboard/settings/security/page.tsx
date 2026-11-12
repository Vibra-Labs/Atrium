"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SecuritySection } from "@/components/two-factor/security-section";
import type { TwoFactorStatus } from "@/components/two-factor/security-section";

/** Owner-only: "Require 2FA for staff" for the active workspace. */
function RequirementToggle({ status }: { status: TwoFactorStatus }): React.ReactElement {
  const [required, setRequired] = useState<boolean>(status.workspaceRequires);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ required: boolean }>("/two-factor/requirement", {
        method: "PUT",
        body: JSON.stringify({ required: next }),
      });
      setRequired(result.required);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the setting");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-[var(--border)] p-6">
      <div>
        <h2 className="text-lg font-semibold">Require two-factor for staff</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Owners and admins of this workspace must use two-factor. Anyone without it is asked to set it up the next
          time they sign in. Clients are never required to.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={required}
          disabled={busy || (!required && !status.enabled)}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Require two-factor for owners and admins
      </label>
      {!required && !status.enabled && (
        <p className="text-xs text-[var(--muted-foreground)]">Turn on two-factor for your own account first.</p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

export default function SecuritySettingsPage(): React.ReactElement {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const onChange = useCallback((next: TwoFactorStatus): void => setStatus(next), []);

  return (
    <div className="space-y-6">
      <SecuritySection onChange={onChange} />
      {status?.isOwner && <RequirementToggle key={String(status.enabled)} status={status} />}
    </div>
  );
}
