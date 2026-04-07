"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import {
  CreditCard,
  Check,
  Zap,
  Crown,
  ExternalLink,
  Loader2,
  Folder,
  Users,
  Globe,
} from "lucide-react";

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

interface Subscription {
  id: string;
  planId: string;
  status: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  plan: Plan;
}

interface Usage {
  projects: number;
  storageMb: number;
  members: number;
  clients: number;
}

function formatLimit(value: number): string {
  return value === -1 ? "Unlimited" : String(value);
}

function formatStorage(mb: number): string {
  if (mb === -1) return "Unlimited";
  if (mb >= 1024) return `${(mb / 1024).toFixed(0)} GB`;
  return `${mb} MB`;
}

function UsageMeter({
  label,
  current,
  max,
  format = "number",
}: {
  label: string;
  current: number;
  max: number;
  format?: "number" | "storage";
}) {
  const isUnlimited = max === -1;
  const pct = isUnlimited ? 0 : Math.min(100, (current / max) * 100);
  const displayMax = format === "storage" ? formatStorage(max) : formatLimit(max);
  const displayCurrent = format === "storage" ? formatStorage(current) : String(current);
  const color = pct >= 90 ? "var(--destructive, #ef4444)" : pct >= 70 ? "#f59e0b" : "var(--primary)";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-[var(--muted-foreground)]">{label}</span>
        <span className={`font-medium ${pct >= 90 ? "text-red-500" : pct >= 70 ? "text-amber-500" : "text-[var(--foreground)]"}`}>
          {isUnlimited ? "Unlimited" : `${displayCurrent} / ${displayMax}`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-1 bg-[var(--muted)] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      )}
    </div>
  );
}

const REASON_BANNER: Record<string, { icon: React.ElementType; text: string; sub: string }> = {
  projects: {
    icon: Folder,
    text: "You've reached your project limit on the Free plan.",
    sub: "Upgrade to Pro for unlimited projects.",
  },
  clients: {
    icon: Users,
    text: "Free plan is limited to 3 clients and 1 team member.",
    sub: "Pro gives you unlimited clients and up to 5 team members.",
  },
  "custom-domain": {
    icon: Globe,
    text: "Custom domains are a Pro feature.",
    sub: "Upgrade to host your client portal at your own domain.",
  },
};

function PlanCard({
  plan,
  isCurrentPlan,
  isFree,
  lifetimeSeatsRemaining,
  onSelect,
  loadingSlug,
}: {
  plan: Plan;
  isCurrentPlan: boolean;
  isFree: boolean;
  lifetimeSeatsRemaining: number | null;
  onSelect: (slug: string) => void;
  loadingSlug: string | null;
}) {
  const isPro = plan.slug === "pro";
  const isLifetime = plan.slug === "lifetime";

  const price = plan.isRecurring
    ? `$${(plan.priceMonthly / 100).toFixed(0)}`
    : plan.priceLifetime > 0
      ? `$${(plan.priceLifetime / 100).toFixed(0)}`
      : "Free";

  const seatsLeft = isLifetime && lifetimeSeatsRemaining !== null ? lifetimeSeatsRemaining : null;
  const soldOut = seatsLeft !== null && seatsLeft <= 0;

  return (
    <div
      className={`relative rounded-xl border p-6 flex flex-col gap-4 transition-all ${
        isPro && isFree
          ? "border-2 border-[var(--primary)] shadow-lg shadow-[var(--primary)]/10 bg-[var(--card,var(--background))]"
          : isCurrentPlan
            ? "border-[var(--primary)] ring-1 ring-[var(--primary)]/20"
            : "border-[var(--border)] opacity-90"
      }`}
    >
      {/* Top accent bar */}
      {isPro && isFree && (
        <div className="absolute top-0 inset-x-0 h-[3px] bg-[var(--primary)] rounded-t-xl" />
      )}

      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {plan.slug === "pro" && <Zap size={16} className="text-[var(--primary)]" />}
          {plan.slug === "lifetime" && <Crown size={16} className="text-amber-500" />}
          <h3 className="font-semibold">{plan.name}</h3>
          {isCurrentPlan && (
            <span className="text-[10px] bg-[var(--primary)] text-white px-1.5 py-0.5 rounded-full font-medium">
              Current
            </span>
          )}
          {isPro && isFree && (
            <span className="text-[10px] bg-[var(--primary)]/15 text-[var(--primary)] px-1.5 py-0.5 rounded-full font-semibold">
              Most Popular
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">{plan.description}</p>
      </div>

      {/* Price */}
      <div className="flex items-end gap-1">
        <span className="text-3xl font-bold tracking-tight">{price}</span>
        {plan.isRecurring && (
          <span className="text-sm text-[var(--muted-foreground)] mb-0.5">/mo</span>
        )}
        {!plan.isRecurring && plan.priceLifetime > 0 && (
          <span className="text-sm text-[var(--muted-foreground)] mb-0.5">one-time</span>
        )}
      </div>

      {/* Lifetime scarcity meter */}
      {isLifetime && seatsLeft !== null && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-[var(--muted-foreground)]">Founding member spots</span>
            <span className={`font-medium ${seatsLeft < 20 ? "text-amber-500" : "text-[var(--foreground)]"}`}>
              {seatsLeft} of {plan.maxSeats} left
            </span>
          </div>
          <div className="h-1 bg-[var(--muted)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${Math.min(100, (seatsLeft / plan.maxSeats) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Features */}
      <ul className="space-y-1.5 flex-1">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Check size={12} className="text-green-500 shrink-0" />
            {feature}
          </li>
        ))}
      </ul>

      {/* CTA */}
      {!isCurrentPlan && plan.slug !== "free" && (
        <button
          onClick={() => onSelect(plan.slug)}
          disabled={loadingSlug !== null || soldOut}
          className={`w-full py-2.5 px-4 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50 ${
            isPro
              ? "bg-[var(--primary)] text-white hover:opacity-90"
              : isLifetime
                ? "bg-amber-500 text-white hover:opacity-90"
                : "bg-[var(--muted)] text-[var(--foreground)] hover:opacity-80"
          }`}
        >
          {loadingSlug === plan.slug ? (
            <Loader2 size={15} className="animate-spin mx-auto" />
          ) : soldOut ? (
            "Sold Out"
          ) : isLifetime ? (
            "Become a Founding Member"
          ) : (
            `Upgrade to ${plan.name} — $${(plan.priceMonthly / 100).toFixed(0)}/mo`
          )}
        </button>
      )}

      {isCurrentPlan && plan.slug !== "free" && (
        <p className="text-center text-xs text-[var(--muted-foreground)]">Your current plan</p>
      )}
    </div>
  );
}

export function BillingSection() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [lifetimeSeatsRemaining, setLifetimeSeatsRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoadingSlug, setCheckoutLoadingSlug] = useState<string | null>(null);
  const { success, error: showError } = useToast();

  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const checkoutSuccess = searchParams?.get("success") === "true";
  const reason = searchParams?.get("reason") ?? null;
  const reasonBanner = reason ? REASON_BANNER[reason] ?? null : null;

  useEffect(() => {
    if (checkoutSuccess) {
      success("Subscription activated! Thank you for upgrading.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Promise.all([
      apiFetch<{ plans: Plan[]; lifetimeSeatsRemaining: number | null }>("/billing/plans"),
      apiFetch<{ subscription: Subscription; usage: Usage }>("/billing/subscription"),
    ])
      .then(([plansData, subData]) => {
        setPlans(plansData.plans);
        setLifetimeSeatsRemaining(plansData.lifetimeSeatsRemaining);
        setSubscription(subData.subscription);
        setUsage(subData.usage);
        setLoading(false);
      })
      .catch((err) => {
        showError(err instanceof Error ? err.message : "Failed to load billing data");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpgrade = async (planSlug: string) => {
    setCheckoutLoadingSlug(planSlug);
    try {
      const result = await apiFetch<{ url: string }>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify({
          planSlug,
          successUrl: `${window.location.origin}/dashboard/settings/account?tab=billing&success=true`,
          cancelUrl: `${window.location.origin}/dashboard/settings/account?tab=billing`,
        }),
      });
      if (result.url) window.location.href = result.url;
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to create checkout session");
      setCheckoutLoadingSlug(null);
    }
  };

  const handleManagePayment = async () => {
    try {
      const result = await apiFetch<{ url: string }>("/billing/portal", {
        method: "POST",
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/dashboard/settings/account?tab=billing`,
        }),
      });
      if (result.url) window.location.href = result.url;
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to open payment portal");
    }
  };

  if (loading) return <div>Loading...</div>;

  const currentPlan = subscription?.plan;
  const isFree = !currentPlan || currentPlan.slug === "free";

  return (
    <div className="space-y-6">
      {/* Contextual reason banner */}
      {reasonBanner && isFree && (
        <div className="flex items-center gap-3 p-3.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]">
          <reasonBanner.icon size={15} className="text-[var(--primary)] shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium">{reasonBanner.text}</span>
            {" "}
            <span className="text-sm text-[var(--muted-foreground)]">{reasonBanner.sub}</span>
          </div>
        </div>
      )}

      {/* Plans — primary focus */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">Plans</h2>
        <div className="grid gap-4 md:grid-cols-3 pt-4">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrentPlan={currentPlan?.slug === plan.slug}
              isFree={isFree}
              lifetimeSeatsRemaining={lifetimeSeatsRemaining}
              onSelect={handleUpgrade}
              loadingSlug={checkoutLoadingSlug}
            />
          ))}
        </div>
      </section>

      {/* Current plan + usage — compact, secondary */}
      {subscription && currentPlan && usage && (
        <section className="rounded-lg border border-[var(--border)] p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard size={14} className="text-[var(--muted-foreground)]" />
              <span className="text-sm font-medium">{currentPlan.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                subscription.status === "active"
                  ? "bg-green-500/15 text-green-600"
                  : subscription.status === "past_due"
                    ? "bg-amber-500/15 text-amber-600"
                    : "bg-red-500/15 text-red-600"
              }`}>
                {subscription.status}
              </span>
              {subscription.currentPeriodEnd && (
                <span className="text-xs text-[var(--muted-foreground)]">
                  · {subscription.cancelAtPeriodEnd ? "Cancels" : "Renews"}{" "}
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </span>
              )}
              {!currentPlan.isRecurring && currentPlan.slug === "lifetime" && (
                <span className="text-xs text-[var(--muted-foreground)]">· Lifetime access</span>
              )}
            </div>
            {subscription.stripeSubscriptionId && (
              <button
                onClick={handleManagePayment}
                className="flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
              >
                Manage <ExternalLink size={11} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <UsageMeter label="Projects" current={usage.projects} max={currentPlan.maxProjects} />
            <UsageMeter label="Storage" current={usage.storageMb} max={currentPlan.maxStorageMb} format="storage" />
            <UsageMeter label="Team Members" current={usage.members} max={currentPlan.maxMembers} />
            <UsageMeter label="Clients" current={usage.clients} max={currentPlan.maxClients} />
          </div>
        </section>
      )}
    </div>
  );
}
