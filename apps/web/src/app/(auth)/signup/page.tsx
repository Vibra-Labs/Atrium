"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { track } from "@/lib/track";
import { useAppConfig } from "@/lib/app-config";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

// Pricing-page links that go straight to checkout once the account exists.
const CHECKOUT_PLANS: Record<string, string> = { pro: "Pro", lifetime: "Lifetime" };

export default function SignupPage() {
  const config = useAppConfig();
  const billingEnabled = config?.billingEnabled ?? false;
  const signupsDisabled = config?.signupEnabled === false;
  const termsUrl: string | null = config?.termsUrl ?? null;
  const privacyUrl: string | null = config?.privacyUrl ?? null;

  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const planFromUrl = searchParams.get("plan");

  const selectedPlan: string = planFromUrl ?? "free";
  const wantsLifetime: boolean = billingEnabled && selectedPlan === "lifetime";
  // A Lifetime link checks seats first, so it never promises a checkout that can't happen.
  const [lifetimeSoldOut, setLifetimeSoldOut] = useState<boolean>(false);
  useEffect(() => {
    if (!wantsLifetime) return;
    fetch(`${API_URL}/api/billing/plans`)
      .then((res: Response) => res.json())
      .then((data: { plans?: { slug: string; isActive?: boolean }[]; lifetimeSeatsRemaining?: number | null }) => {
        const offered: boolean = (data.plans ?? []).some((p) => p.slug === "lifetime" && p.isActive !== false);
        setLifetimeSoldOut(!offered || data.lifetimeSeatsRemaining === 0);
      })
      .catch((err: unknown) => console.error("Could not check Lifetime seats", err));
  }, [wantsLifetime]);
  // Only when billing is on: self-hosted installs have no plans to check out.
  const checkoutPlanName: string | null =
    billingEnabled && !(wantsLifetime && lifetimeSoldOut) ? CHECKOUT_PLANS[selectedPlan] ?? null : null;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const signupStartedRef = useRef<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Fires before validation so signup_started - signup_completed measures
    // everyone who tried, including those turned away by the password rules.
    // Once per page session: a user who trips the rules repeatedly is one
    // attempt, not four, or the funnel denominator inflates.
    if (!signupStartedRef.current) {
      signupStartedRef.current = true;
      track("signup_started", { plan: selectedPlan });
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      setLoading(false);
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError("Password must contain at least one uppercase letter");
      setLoading(false);
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError("Password must contain at least one lowercase letter");
      setLoading(false);
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError("Password must contain at least one number");
      setLoading(false);
      return;
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      setError("Password must contain at least one special character");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/onboarding/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          orgName,
          ...(checkoutPlanName ? { planSlug: selectedPlan } : {}),
        }),
        credentials: "include",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Signup failed");
      }

      if (res.status === 207) {
        // Account created but org creation failed: a User with no Organization.
        // Tracked neither as completed nor failed before, which is exactly the
        // population that makes user and org counts disagree.
        track("signup_failed", { reason: "org_setup_failed", plan: selectedPlan });
        setError(
          data.message ||
            "Account created but organization setup failed. Redirecting to login...",
        );
        setTimeout(() => {
          window.location.href = "/login";
        }, 3000);
        return;
      }

      // Redirect to Stripe Checkout if a checkout URL was returned
      if (data.checkoutUrl) {
        track("signup_completed", { plan: selectedPlan });
        window.location.href = data.checkoutUrl;
        return;
      }

      track("signup_completed", { plan: selectedPlan });
      window.location.href = "/setup";
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Signup failed";
      track("signup_failed", { reason, plan: selectedPlan });
      setError(reason);
    } finally {
      setLoading(false);
    }
  };

  if (signupsDisabled) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-2xl font-bold">Signups are disabled</h1>
          <p className="text-[var(--muted-foreground)]">
            This Atrium instance isn&apos;t accepting new signups. If you already
            have an account, you can sign in.
          </p>
          <Link
            href="/login"
            className="inline-block py-2 px-4 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Create your account</h1>
          <p className="text-[var(--muted-foreground)] mt-2">
            Set up your agency portal
          </p>
          {checkoutPlanName && (
            <p className="mt-3 text-sm text-[var(--primary)]">
              You&apos;ll go to checkout for {checkoutPlanName} after creating your account
            </p>
          )}
          {wantsLifetime && lifetimeSoldOut && (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              Lifetime is sold out. You&apos;ll start on the free Pro trial.
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
              {error}
            </div>
          )}

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

          <div className="space-y-2">
            <label htmlFor="orgName" className="text-sm font-medium">
              Agency / Company Name
            </label>
            <input
              id="orgName"
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>

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
            {password.length > 0 &&
              (() => {
                const checks = [
                  password.length >= 8,
                  /[A-Z]/.test(password),
                  /[a-z]/.test(password),
                  /[0-9]/.test(password),
                  /[^A-Za-z0-9]/.test(password),
                ];
                const passed = checks.filter(Boolean).length;
                const strength =
                  passed <= 2 ? "Weak" : passed <= 4 ? "Fair" : "Strong";
                const color =
                  passed <= 2
                    ? "#ef4444"
                    : passed <= 4
                      ? "#f59e0b"
                      : "#22c55e";
                return (
                  <div className="space-y-1.5">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className="h-1 flex-1 rounded-full"
                          style={{
                            backgroundColor:
                              i <= passed ? color : "var(--muted)",
                          }}
                        />
                      ))}
                    </div>
                    <p className="text-xs" style={{ color }}>
                      {strength}
                    </p>
                  </div>
                );
              })()}
            <ul className="text-xs text-[var(--muted-foreground)] space-y-0.5">
              <li
                style={{
                  color: password.length >= 8 ? "#22c55e" : undefined,
                }}
              >
                {password.length >= 8 ? "\u2713" : "\u2022"} At least 8
                characters
              </li>
              <li
                style={{
                  color: /[A-Z]/.test(password) ? "#22c55e" : undefined,
                }}
              >
                {/[A-Z]/.test(password) ? "\u2713" : "\u2022"} One uppercase
                letter
              </li>
              <li
                style={{
                  color: /[a-z]/.test(password) ? "#22c55e" : undefined,
                }}
              >
                {/[a-z]/.test(password) ? "\u2713" : "\u2022"} One lowercase
                letter
              </li>
              <li
                style={{
                  color: /[0-9]/.test(password) ? "#22c55e" : undefined,
                }}
              >
                {/[0-9]/.test(password) ? "\u2713" : "\u2022"} One number
              </li>
              <li
                style={{
                  color: /[^A-Za-z0-9]/.test(password)
                    ? "#22c55e"
                    : undefined,
                }}
              >
                {/[^A-Za-z0-9]/.test(password) ? "\u2713" : "\u2022"} One
                special character
              </li>
            </ul>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>

          {(termsUrl || privacyUrl) && (
            <p className="text-xs text-center text-[var(--muted-foreground)]">
              By creating an account, you agree to the{" "}
              {termsUrl && (
                <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline">
                  Terms of Service
                </a>
              )}
              {termsUrl && privacyUrl && " and "}
              {privacyUrl && (
                <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline">
                  Privacy Policy
                </a>
              )}
              .
            </p>
          )}
        </form>

        <div className="flex justify-center gap-4 text-sm text-[var(--muted-foreground)]">
          <p>
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-[var(--primary)] hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
