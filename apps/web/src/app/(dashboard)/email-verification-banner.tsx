"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function EmailVerificationBanner({ email }: { email?: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (dismissed) return null;

  const resendVerification = async () => {
    setSending(true);
    try {
      await fetch(`${API_URL}/api/auth/send-verification-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          callbackURL: `${window.location.origin}/verify-email?verified=true`,
        }),
        credentials: "include",
      });
      setSent(true);
    } catch {
      // Silently fail
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <svg
          className="w-4 h-4 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
        <span>
          {sent
            ? "Verification email sent! Check your inbox."
            : "Your email address is not verified."}
        </span>
        {!sent && (
          <button
            onClick={resendVerification}
            disabled={sending}
            className="font-medium underline hover:no-underline disabled:opacity-50"
          >
            {sending ? "Sending..." : "Resend verification email"}
          </button>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-amber-600 hover:text-amber-800 flex-shrink-0"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
