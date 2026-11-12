"use client";

import { setActiveOrgAndRedirect } from "@/lib/api";
import { TwoFactorSetup } from "@/components/two-factor/two-factor-setup";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/** Where staff of a workspace that requires 2FA land until they set it up. No way to skip. */
export default function TwoFactorSetupPage(): React.ReactElement {
  const signOut = async (): Promise<void> => {
    try {
      await fetch(`${API_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "include",
      });
    } catch (err) {
      console.error("Sign out failed", err);
    }
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Set up two-factor authentication</h1>
          <p className="text-[var(--muted-foreground)] mt-2">
            Your workspace requires two-factor for owners and admins. It takes about a minute.
          </p>
        </div>
        <TwoFactorSetup
          onDone={() => {
            void setActiveOrgAndRedirect("/portal/projects").then((path: string) => {
              window.location.href = path;
            });
          }}
        />
        <button type="button" onClick={signOut} className="text-sm text-[var(--muted-foreground)] hover:underline">
          Sign out
        </button>
      </div>
    </div>
  );
}
