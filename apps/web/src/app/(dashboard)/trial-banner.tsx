"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { trialDaysLeft, useTrialEndsAt } from "@/lib/plan-features";

export function TrialBanner(): React.ReactElement | null {
  const endsAt: Date | null = useTrialEndsAt();
  if (!endsAt) return null;

  const days: number = trialDaysLeft(endsAt);
  const urgent: boolean = days <= 3;

  return (
    <div
      data-testid="trial-banner"
      className={`mb-6 p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center gap-2 text-sm ${
        urgent
          ? "bg-amber-50 border-amber-200 text-amber-800"
          : "bg-[var(--muted)] border-[var(--border)]"
      }`}
    >
      <div className="flex items-center gap-2 flex-1">
        <Sparkles size={14} className="shrink-0 text-[var(--primary)]" />
        <span>
          <strong>
            {days} {days === 1 ? "day" : "days"} left
          </strong>{" "}
          in your Pro trial. After that, custom domains, e-signatures, online payments and
          white-label switch off.
        </span>
      </div>
      <Link
        href="/dashboard/settings/billing"
        className="shrink-0 font-medium text-[var(--primary)] hover:underline"
      >
        Keep Pro
      </Link>
    </div>
  );
}
