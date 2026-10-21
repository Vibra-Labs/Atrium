"use client";

import { useState } from "react";
import { Check, Copy, Eye, KeyRound, UserX } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { formatLastSeen } from "@/lib/last-seen";
import { startPreview } from "@/lib/preview-mode";
import { track } from "@/lib/track";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { ResetLinkModal, usePasswordReset } from "@/components/password-reset-link";
import type { ContactDetail } from "./types";

export interface PendingInvite {
  email: string;
  role: string | null;
  expiresAt: string;
  inviteLink: string;
  expired: boolean;
}

interface Props {
  contact: ContactDetail;
  pendingInvite: PendingInvite | null;
  onChanged: () => void;
}

const actionClass =
  "flex items-center gap-1 text-sm text-[var(--primary)] hover:underline whitespace-nowrap disabled:opacity-50";

/**
 * The contact's client portal access: a login (joined, last seen, view as client, password
 * reset, remove access) or an open invitation (copy link). Nothing when neither; the header
 * offers "Invite to portal" then.
 */
export function PortalAccess({ contact, pendingInvite, onChanged }: Props) {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const { resetLink, resettingMemberId, sendReset, closeReset } = usePasswordReset();
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function copyInviteLink(link: string): Promise<void> {
    if (!(await copyToClipboard(link))) {
      showError("Could not copy link");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function removeAccess(memberId: string): Promise<void> {
    const ok = await confirm({
      title: "Remove portal access",
      message: `${contact.name} will no longer be able to sign in to the client portal or see their projects. The contact, notes and history stay, marked as a past client.`,
      confirmLabel: "Remove portal access",
      variant: "danger",
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await apiFetch(`/clients/${memberId}`, { method: "DELETE" });
      success("Portal access removed");
      onChanged();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to remove portal access");
    } finally {
      setRemoving(false);
    }
  }

  const { portal } = contact;
  if (portal && contact.userId) {
    const userId: string = contact.userId;
    const email: string = contact.email ?? "";
    return (
      <div
        data-testid="portal-access"
        className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
      >
        <span className="text-[var(--muted-foreground)]">
          <span className="font-medium text-[var(--foreground)]">Portal access</span>
          {" · joined "}
          {new Date(portal.joinedAt).toLocaleDateString()}
          {" · "}
          <span data-testid="client-last-seen">{formatLastSeen(portal.lastSeenAt)}</span>
        </span>
        <span className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => {
              track("client_viewed_as");
              startPreview(userId, contact.name, email, `/dashboard/contacts/${contact.id}`);
            }}
            className={actionClass}
          >
            <Eye size={14} aria-hidden /> View as client
          </button>
          <button
            onClick={() => sendReset(portal.memberId, email)}
            disabled={resettingMemberId === portal.memberId}
            className={actionClass}
          >
            <KeyRound size={14} aria-hidden /> Send password reset link
          </button>
          <button
            onClick={() => removeAccess(portal.memberId)}
            disabled={removing}
            className="flex items-center gap-1 text-sm text-red-600 hover:underline whitespace-nowrap disabled:opacity-50"
          >
            <UserX size={14} aria-hidden /> Remove portal access
          </button>
        </span>
        {resetLink && <ResetLinkModal resetLink={resetLink} onClose={closeReset} />}
      </div>
    );
  }

  if (!pendingInvite) return null;
  return (
    <div
      data-testid="pending-invite"
      className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
    >
      <span className="text-[var(--muted-foreground)]">
        Portal invitation pending · expires {new Date(pendingInvite.expiresAt).toLocaleDateString()}
      </span>
      <button onClick={() => copyInviteLink(pendingInvite.inviteLink)} className={actionClass}>
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {copied ? "Copied!" : "Copy invite link"}
      </button>
    </div>
  );
}
