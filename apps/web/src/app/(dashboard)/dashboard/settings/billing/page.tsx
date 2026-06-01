"use client";

import { CreditCard } from "lucide-react";
import { BillingSection } from "./billing-section";
import { useAppConfig } from "@/lib/app-config";

export default function BillingPage(): React.ReactElement {
  const config = useAppConfig();
  const billingEnabled = config?.billingEnabled ?? false;

  if (!billingEnabled) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--muted)] mb-4">
          <CreditCard size={20} className="text-[var(--muted-foreground)]" />
        </div>
        <h2 className="text-base font-semibold">Billing is coming soon</h2>
        <p className="mt-1.5 max-w-sm text-sm text-[var(--muted-foreground)]">
          Plans, payment methods, and usage will live here. There&apos;s nothing
          you need to do right now &mdash; we&apos;ll let you know when it&apos;s ready.
        </p>
      </div>
    );
  }

  return <BillingSection />;
}
