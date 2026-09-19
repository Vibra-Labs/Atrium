"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { setActiveOrgAndRedirect } from "@/lib/api";
import { track } from "@/lib/track";
import { postAuth } from "@/lib/auth-fetch";

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const invitationId = searchParams.get("id");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signup" | "login">("signup");

  if (!invitationId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Invalid Invitation</h1>
          <p className="text-[var(--muted-foreground)]">
            This invitation link is missing or invalid.
          </p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL || "";

    try {
      // Step 1: Sign up or login. Both go through postAuth, which never
      // follows the 302 Better Auth answers with while a signed
      // `oidc_login_prompt` cookie from an abandoned MCP connection is around.
      if (mode === "signup") {
        const signUp = await postAuth("/sign-up/email", { name, email, password });
        if (!signUp.ok) {
          // If user already exists, auto-switch to login and retry
          if (signUp.status === 422 || signUp.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
            const signIn = await postAuth("/sign-in/email", { email, password });
            if (!signIn.ok) {
              throw new Error(signIn.message || "Account exists but login failed. Try signing in instead.");
            }
            setMode("login");
          } else {
            throw new Error(signUp.message || "Signup failed");
          }
        }
      } else {
        const signIn = await postAuth("/sign-in/email", { email, password });
        if (!signIn.ok) throw new Error(signIn.message || "Login failed");
      }

      // Step 2: Accept the invitation
      const acceptRes = await fetch(
        `${apiUrl}/api/auth/organization/accept-invitation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invitationId }),
          credentials: "include",
        },
      );

      if (!acceptRes.ok) {
        const data = await acceptRes.json().catch(() => ({}));
        throw new Error(data.message || "Failed to accept invitation");
      }

      // Pin the active org to the one we just joined. Without this, users who
      // already belong to another org (e.g. their own agency) can be routed
      // to that org's dashboard/setup instead of the invited org's portal.
      const acceptData: {
        member?: { organizationId?: string };
        invitation?: { organizationId?: string };
      } = await acceptRes.json().catch(() => ({}));
      const joinedOrgId =
        acceptData.member?.organizationId ??
        acceptData.invitation?.organizationId;

      // Step 3: Set active organization and redirect by role
      track("invite_accepted");
      window.location.href = await setActiveOrgAndRedirect(
        "/portal",
        joinedOrgId,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Join Project Portal</h1>
          <p className="text-[var(--muted-foreground)] mt-2">
            {mode === "signup"
              ? "Create an account to access your project"
              : "Sign in to accept your invitation"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 rounded-lg">
              {error}
            </div>
          )}

          {mode === "signup" && (
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Your Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading
              ? "Processing..."
              : mode === "signup"
                ? "Create Account & Join"
                : "Sign In & Join"}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--muted-foreground)]">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("login")}
                className="text-[var(--primary)] hover:underline"
              >
                Sign in instead
              </button>
            </>
          ) : (
            <>
              Need an account?{" "}
              <button
                onClick={() => setMode("signup")}
                className="text-[var(--primary)] hover:underline"
              >
                Sign up
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteContent />
    </Suspense>
  );
}
