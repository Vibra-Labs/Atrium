"use client";

import { Copy, Check, Send } from "lucide-react";

export interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  inviteLink: string;
  expired: boolean;
}

interface PendingInvitationRowProps {
  invitation: Invitation;
  roleBadge?: React.ReactNode;
  copied: boolean;
  resending: boolean;
  onCopy: () => void;
  onResend: () => void;
}

/** One pending invite on the People page: its expiry, and Resend / Copy Link actions. */
export function PendingInvitationRow({
  invitation,
  roleBadge,
  copied,
  resending,
  onCopy,
  onResend,
}: PendingInvitationRowProps) {
  return (
    <div
      data-testid="pending-invitation"
      className="flex items-center justify-between gap-3 p-3 border border-[var(--border)] rounded-lg"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{invitation.email}</p>
          {roleBadge}
          {invitation.expired && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Expired</span>
          )}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          {invitation.expired
            ? "This link no longer works. Resend to send a new one."
            : `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onResend}
          disabled={resending}
          className="flex items-center gap-1 text-sm text-[var(--primary)] hover:underline disabled:opacity-50"
        >
          <Send size={14} />
          {resending ? "Sending..." : "Resend"}
        </button>
        {!invitation.expired && (
          <button
            onClick={onCopy}
            className="flex items-center gap-1 text-sm text-[var(--primary)] hover:underline"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied!" : "Copy Link"}
          </button>
        )}
      </div>
    </div>
  );
}
