"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { TwoFactorSetup } from "@/components/two-factor-setup";

interface Status {
  enabled: boolean;
  requiredByOrg: boolean;
}

interface Props {
  isOwner: boolean;
}

export function SecuritySection({ isOwner }: Props) {
  const { success, error: showError } = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<Status | null>(null);
  const [orgRequire, setOrgRequire] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Status>("/two-factor/status")
      .then((s) => {
        setStatus(s);
        setOrgRequire(s.requiredByOrg);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function disable() {
    const code = window.prompt(
      "Enter your current 6-digit code to confirm disabling 2FA:",
    );
    if (!code) return;
    setBusy(true);
    try {
      await apiFetch("/auth/two-factor/disable", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setStatus({ enabled: false, requiredByOrg: orgRequire });
      success("2FA disabled");
    } catch {
      showError("Failed to disable 2FA — check the code and try again");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateCodes() {
    const code = window.prompt(
      "Enter your current 6-digit code to regenerate recovery codes:",
    );
    if (!code) return;
    const ok = await confirm({
      title: "Regenerate recovery codes?",
      message: "Existing recovery codes will stop working immediately.",
      confirmText: "Regenerate",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ backupCodes: string[] }>(
        "/auth/two-factor/generate-backup-codes",
        {
          method: "POST",
          body: JSON.stringify({ code }),
        },
      );
      window.alert(
        "New recovery codes (save them now — they are shown only once):\n\n" +
          res.backupCodes.join("\n"),
      );
    } catch {
      showError("Failed to regenerate codes");
    } finally {
      setBusy(false);
    }
  }

  async function toggleOrgRequire(next: boolean) {
    setBusy(true);
    try {
      await apiFetch("/settings", {
        method: "PUT",
        body: JSON.stringify({ requireTwoFactor: next }),
      });
      setOrgRequire(next);
      success(next ? "2FA now required for staff" : "2FA requirement removed");
    } catch {
      showError("Failed to update org policy");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!status) return <p className="text-sm text-red-600">Failed to load status</p>;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">Two-factor authentication</h2>
        {status.enabled ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-green-700">2FA is enabled on your account.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={regenerateCodes}
                disabled={busy}
                className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Regenerate recovery codes
              </button>
              {!status.requiredByOrg && (
                <button
                  type="button"
                  onClick={disable}
                  disabled={busy}
                  className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Disable 2FA
                </button>
              )}
              {status.requiredByOrg && (
                <span
                  className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-500"
                  title="Your organization requires 2FA — disabling is not allowed."
                >
                  Required by org policy
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <TwoFactorSetup
              onComplete={() => setStatus({ enabled: true, requiredByOrg: orgRequire })}
            />
          </div>
        )}
      </section>

      {isOwner && (
        <section className="border-t pt-4">
          <h2 className="text-lg font-semibold">Org policy</h2>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={orgRequire}
              onChange={(e) => toggleOrgRequire(e.target.checked)}
              disabled={busy}
            />
            <span className="text-sm">
              Require 2FA for staff (owners and admins). Clients are not affected.
            </span>
          </label>
        </section>
      )}
    </div>
  );
}
