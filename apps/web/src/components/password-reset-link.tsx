"use client";

import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";

export interface ResetLink {
  url: string;
  email: string;
  emailSent: boolean;
  emailViaOrgConfig: boolean;
}

/**
 * "Send password reset link" for a member (staff or portal client): confirms, asks the API for a
 * link, and keeps it so <ResetLinkModal> can show it for sharing when email isn't delivered.
 */
export function usePasswordReset(): {
  resetLink: ResetLink | null;
  resettingMemberId: string | null;
  sendReset: (memberId: string, email: string) => Promise<void>;
  closeReset: () => void;
} {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [resetLink, setResetLink] = useState<ResetLink | null>(null);
  const [resettingMemberId, setResettingMemberId] = useState<string | null>(null);

  async function sendReset(memberId: string, email: string): Promise<void> {
    const ok = await confirm({
      title: "Send Password Reset Link",
      message: `Generate a password reset link for ${email}? An email will also be sent if email delivery is configured. You'll see the link here so you can share it directly if needed.`,
      confirmLabel: "Generate Link",
    });
    if (!ok) return;
    setResettingMemberId(memberId);
    try {
      const res = await apiFetch<ResetLink>(`/clients/${memberId}/reset-password`, { method: "POST" });
      setResetLink(res);
      success(res.emailViaOrgConfig ? `Reset link emailed to ${res.email}` : `Reset link generated for ${res.email}`);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to generate reset link");
    } finally {
      setResettingMemberId(null);
    }
  }

  return { resetLink, resettingMemberId, sendReset, closeReset: () => setResetLink(null) };
}

export function ResetLinkModal({
  resetLink,
  onClose,
}: {
  resetLink: ResetLink;
  onClose: () => void;
}): React.ReactElement {
  const { error: showError } = useToast();
  const [copied, setCopied] = useState<boolean>(false);

  async function copy(): Promise<void> {
    if (!(await copyToClipboard(resetLink.url))) {
      showError("Could not copy link");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">Password reset link</h3>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">For {resetLink.email}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div
          className={
            resetLink.emailViaOrgConfig
              ? "p-3 rounded-lg text-sm bg-green-50 text-green-800 border border-green-200"
              : "p-3 rounded-lg text-sm bg-amber-50 text-amber-900 border border-amber-200"
          }
        >
          {resetLink.emailViaOrgConfig
            ? `An email with this link was sent to ${resetLink.email} via your organization's email config.`
            : resetLink.emailSent
              ? `Sent via the platform default to ${resetLink.email}. If it doesn't arrive, share the link below directly.`
              : "No email provider is configured, so no email was sent. Copy the link below and share it with the user directly."}
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-[var(--muted-foreground)]">
            Reset link (expires in 1 hour)
          </label>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={resetLink.url}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus
              className="flex-1 px-2 py-1.5 text-sm bg-[var(--muted)] text-[var(--foreground)] border border-[var(--border)] rounded font-mono"
            />
            <button
              onClick={copy}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--primary)] text-white rounded hover:opacity-90"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">Refreshing the page will not retrieve this link again.</p>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
