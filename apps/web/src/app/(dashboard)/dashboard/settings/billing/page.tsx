"use client";

import { BillingSection } from "./billing-section";
import { useAppConfig } from "@/lib/app-config";

export default function BillingPage(): React.ReactElement {
  const config = useAppConfig();
  const billingEnabled = config?.billingEnabled ?? false;

  if (!billingEnabled) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Billing is not configured on this Atrium instance.
      </p>
    );
  }

  return <BillingSection />;
}
