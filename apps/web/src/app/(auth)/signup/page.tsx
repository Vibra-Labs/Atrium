"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Check, Zap, Crown } from "lucide-react";
import { track } from "@/lib/track";

const BILLING_ENABLED =
  process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";
const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "";

interface Plan {
  id: string;
  name: string;
  slug: string;
  priceMonthly: number;
  priceLifetime: number;
  maxProjects: number;
  maxStorageMb: number;
  maxMembers: number;
  maxClients: number;
  maxSeats: number;
  isRecurring: boolean;
  features: string[];
  description: string;
}

function PlanSelectionStep({
  plans,
  lifetimeSeatsRemaining,
  selectedSlug,
  onSelect,
  onContinue,
  loading,
}: {
  plans: Plan[];
  lifetimeSeatsRemaining: number | null;
  selectedSlug: string;
  onSelect: (slug: string) => void;
  onContinue: () => void;
  loading: boolean;
}) {
  return (
    <div className="w-full max-w-3xl space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Choose your plan</h1>
        <p className="text-[var(--muted-foreground)] mt-2">
          Select a plan to get started. You can change it later.
        </p>
      </div>

      {loading ? (
        <div className="text-center text-[var(--muted-foreground)] py-12">
          Loading plans...
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => {
            const isSelected = selectedSlug === plan.slug;
            const price = plan.isRecurring
              ? `$${(plan.priceMonthly / 100).toFixed(0)}/mo`
              : plan.priceLifetime > 0
                ? `$${(plan.priceLifetime / 100).toFixed(0)}`
                : "Free";

            const icon =
              plan.slug === "free" ? null : plan.slug === "pro" ? (
                <Zap size={20} />
              ) : (
                <Crown size={20} />
              );

            const soldOut =
              plan.slug === "lifetime" &&
              lifetimeSeatsRemaining !== null &&
              lifetimeSeatsRemaining <= 0;

            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => !soldOut && onSelect(plan.slug)}
                disabled={soldOut}
                className={`text-left rounded-xl border p-6 space-y-4 transition-all cursor-pointer ${
                  isSelected
                    ? "border-[var(--primary)] ring-2 ring-[var(--primary)] ring-opacity-20"
                    : "border-[var(--border)] hover:border-[var(--primary)]/50"
                } ${soldOut ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {icon}
                    <h3 className="text-lg font-semibold">{plan.name}</h3>
                    {isSelected && (
                      <span className="text-xs bg-[var(--primary)] text-white px-2 py-0.5 rounded-full">
                        Selected
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {plan.description}
                  </p>
                </div>

                <div className="text-3xl font-bold">
                  {price}
                  {plan.isRecurring && (
                    <span className="text-sm font-normal text-[var(--muted-foreground)]">
                      {" "}
                      /month
                    </span>
                  )}
                  {!plan.isRecurring && plan.priceLifetime > 0 && (
                    <span className="text-sm font-normal text-[var(--muted-foreground)]">
                      {" "}
                      one-time
                    </span>
                  )}
                </div>

                {plan.slug === "lifetime" &&
                  lifetimeSeatsRemaining !== null && (
                    <div className="text-sm bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 px-3 py-1.5 rounded-lg">
                      {soldOut
                        ? "Sold out"
                        : `${lifetimeSeatsRemaining} of ${plan.maxSeats} seats remaining`}
                    </div>
                  )}

                <ul className="space-y-2">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Check size={16} className="text-green-500 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onContinue}
        disabled={loading}
        className="w-full max-w-sm mx-auto block py-2 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        Continue
      </button>

      <p className="text-center text-sm text-[var(--muted-foreground)]">
        Already have an account?{" "}
        <Link href="/login" className="text-[var(--primary)] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const planFromUrl = searchParams.get("plan");

  const [step, setStep] = useState<"plan" | "account">(
    BILLING_ENABLED ? "plan" : "account",
  );
  const [selectedPlan, setSelectedPlan] = useState(planFromUrl || "free");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [lifetimeSeatsRemaining, setLifetimeSeatsRemaining] = useState<
    number | null
  >(null);
  const [plansLoading, setPlansLoading] = useState(BILLING_ENABLED);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!BILLING_ENABLED) return;
    fetch(`${API_URL}/api/billing/plans`)
      .then((res) => res.json())
      .then((data) => {
        setPlans(data.plans ?? []);
        setLifetimeSeatsRemaining(data.lifetimeSeatsRemaining ?? null);
      })
      .catch(() => {
        // If plans fail to load, skip plan selection
        setStep("account");
      })
      .finally(() => setPlansLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

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
          ...(BILLING_ENABLED && selectedPlan !== "free"
            ? { planSlug: selectedPlan }
            : {}),
        }),
        credentials: "include",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Signup failed");
      }

      if (res.status === 207) {
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
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  if (step === "plan") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <PlanSelectionStep
          plans={plans}
          lifetimeSeatsRemaining={lifetimeSeatsRemaining}
          selectedSlug={selectedPlan}
          onSelect={setSelectedPlan}
          onContinue={() => setStep("account")}
          loading={plansLoading}
        />
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
        </form>

        <div className="flex justify-center gap-4 text-sm text-[var(--muted-foreground)]">
          {BILLING_ENABLED && (
            <button
              type="button"
              onClick={() => setStep("plan")}
              className="text-[var(--primary)] hover:underline"
            >
              Back to plans
            </button>
          )}
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
