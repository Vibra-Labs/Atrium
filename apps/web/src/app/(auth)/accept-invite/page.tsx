"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { setActiveOrgAndRedirect } from "@/lib/api";
import { track } from "@/lib/track";

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
      // Step 1: Sign up or login
      if (mode === "signup") {
        const res = await fetch(`${apiUrl}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
          credentials: "include",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          // If user already exists, auto-switch to login and retry
          if (res.status === 422 || data.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
            const loginRes = await fetch(`${apiUrl}/api/auth/sign-in/email`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password }),
              credentials: "include",
            });
            if (!loginRes.ok) {
              const loginData = await loginRes.json().catch(() => ({}));
              throw new Error(loginData.message || "Account exists but login failed. Try signing in instead.");
            }
            setMode("login");
          } else {
            throw new Error(data.message || "Signup failed");
          }
        }
      } else {
        const res = await fetch(`${apiUrl}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          credentials: "include",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Login failed");
        }
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

      // Step 3: Set active organization and redirect by role
      track("invite_accepted");
      window.location.href = await setActiveOrgAndRedirect("/portal");
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
