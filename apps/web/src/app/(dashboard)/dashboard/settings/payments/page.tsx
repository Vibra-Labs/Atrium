"use client";

import { CreditCard } from "lucide-react";
import { PaymentsSection } from "../system/payments-section";

export default function PaymentsSettingsPage(): React.ReactElement {
  return (
    <div className="max-w-lg">
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard size={18} />
          <h2 className="text-base font-semibold">Client Payments</h2>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          Accept invoice payments from clients via Stripe.
        </p>
        <PaymentsSection />
      </section>
    </div>
  );
}
