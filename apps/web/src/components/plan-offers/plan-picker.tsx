"use client";

import { useEffect, useState } from "react";
import { Check, Crown, Loader2, Zap } from "lucide-react";
import { lifetimeSeatLabel } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { planPriceLabel, type CheckoutPlan } from "@/lib/plan-offers";

interface PickerPlan {
  id: string;
  name: string;
  slug: string;
  priceMonthly: number;
  priceLifetime: number;
  maxSeats: number;
  isRecurring: boolean;
  features: string[];
  description: string | null;
}

interface PlanPickerProps {
  onChoose: (slug: CheckoutPlan) => void;
  busySlug: CheckoutPlan | null;
}

/** Free, Pro and Lifetime side by side; Pro and Lifetime start checkout. */
export function PlanPicker({ onChoose, busySlug }: PlanPickerProps): React.ReactElement {
  const [plans, setPlans] = useState<PickerPlan[] | null>(null);
  const [seatsRemaining, setSeatsRemaining] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<{ plans: PickerPlan[]; lifetimeSeatsRemaining: number | null }>("/billing/plans")
      .then((data) => {
        setPlans(data.plans);
        setSeatsRemaining(data.lifetimeSeatsRemaining);
      })
      .catch((err: unknown) => {
        console.error("Failed to load plans", err);
        setPlans([]);
      });
  }, []);

  if (!plans) {
    return <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">Loading plans...</div>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {plans.map((plan: PickerPlan) => {
        const isLifetime: boolean = plan.slug === "lifetime";
        const soldOut: boolean = isLifetime && seatsRemaining !== null && seatsRemaining <= 0;
        const checkoutSlug: CheckoutPlan | null = plan.slug === "pro" || isLifetime ? (plan.slug as CheckoutPlan) : null;
        return (
          <div
            key={plan.id}
            className={`rounded-xl border p-4 flex flex-col gap-3 ${
              plan.slug === "pro" ? "border-2 border-[var(--primary)]" : "border-[var(--border)]"
            }`}
          >
            <div className="flex items-center gap-2">
              {plan.slug === "pro" && <Zap size={15} className="text-[var(--primary)]" />}
              {isLifetime && <Crown size={15} className="text-amber-500" />}
              <h3 className="font-semibold">{plan.name}</h3>
            </div>
            <p className="text-2xl font-bold">{planPriceLabel(plan)}</p>
            {isLifetime && seatsRemaining !== null && (
              <p className="text-xs font-medium text-amber-600">{lifetimeSeatLabel(plan.maxSeats, seatsRemaining)}</p>
            )}
            <ul className="space-y-1 flex-1">
              {plan.features.slice(0, 5).map((feature: string) => (
                <li key={feature} className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  <Check size={11} className="text-green-500 shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>
            {checkoutSlug && (
              <button
                type="button"
                disabled={soldOut || busySlug !== null}
                onClick={() => onChoose(checkoutSlug)}
                className="w-full py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {busySlug === checkoutSlug ? (
                  <Loader2 size={14} className="animate-spin mx-auto" />
                ) : soldOut ? (
                  "Sold out"
                ) : (
                  `Choose ${plan.name}`
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
