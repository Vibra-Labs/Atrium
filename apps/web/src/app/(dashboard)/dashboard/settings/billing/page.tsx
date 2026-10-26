"use client";

import { BillingSection } from "./billing-section";
import { PaymentsSection } from "../system/payments-section";
import { useAppConfig } from "@/lib/app-config";
import { CreditCard } from "lucide-react";

export default function BillingPage(): React.ReactElement {
  const config = useAppConfig();
  const billingEnabled = config?.billingEnabled ?? false;

  return (
    <div className="space-y-12 divide-y divide-[var(--border)]">
      {/* 1. Atrium Subscription & Plan Limits (if enabled on this deployment) */}
      {billingEnabled ? (
        <div>
          <BillingSection />
        </div>
      ) : (
        <div className="pb-2">
          <p className="text-sm text-[var(--muted-foreground)]">
            Atrium subscription billing is not enabled on this deployment.
          </p>
        </div>
      )}

      {/* 2. Client Invoice Payments via Stripe Connect */}
      <div className={billingEnabled ? "pt-10 space-y-4 max-w-lg" : "max-w-lg"}>
        <div className="flex items-center gap-2">
          <CreditCard size={18} className="text-[var(--primary)]" />
          <h2 className="text-base font-semibold text-[var(--foreground)]">Client Invoice Payments</h2>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          Connect your Stripe account to let clients pay their invoices directly through their portal.
        </p>
        <div className="pt-2">
          <PaymentsSection />
        </div>
      </div>
    </div>
  );
}
