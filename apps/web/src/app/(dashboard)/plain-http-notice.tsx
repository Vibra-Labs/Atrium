"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";

const DOCS_URL: string =
  "https://github.com/Vibra-Labs/Atrium/blob/main/docs/docker.md#running-over-plain-http";

/**
 * Owner-only notice for installs served over plain HTTP, where sign-in
 * cookies can't carry the Secure flag. Dismissal is saved on the workspace,
 * so it stays hidden in every browser.
 */
export function PlainHttpNotice(): React.ReactElement | null {
  const [dismissed, setDismissed] = useState<boolean>(false);

  async function dismiss(): Promise<void> {
    setDismissed(true);
    try {
      await apiFetch("/settings", {
        method: "PATCH",
        body: JSON.stringify({ plainHttpNoticeDismissed: true }),
      });
    } catch (err) {
      console.error("Could not save notice dismissal", err);
    }
  }

  if (dismissed) return null;

  return (
    <div
      role="status"
      data-testid="plain-http-notice"
      className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg relative"
    >
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-amber-600 hover:text-amber-800"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <div className="text-sm text-amber-800 pr-6 space-y-1">
        <p className="font-medium">Atrium is running over plain HTTP</p>
        <p>
          Passwords, sign-in sessions and client data are sent unencrypted, so anyone on the same
          network could read them. That&apos;s fine on a trusted home network or VPN. For anything
          else, use HTTPS.
        </p>
        <p>
          Using a Cloudflare tunnel or an HTTPS proxy? Set <code>WEB_URL</code> to your{" "}
          <code>https://</code> address and redeploy the container.{" "}
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline hover:no-underline"
          >
            Risks and how to switch
          </a>
        </p>
      </div>
    </div>
  );
}
