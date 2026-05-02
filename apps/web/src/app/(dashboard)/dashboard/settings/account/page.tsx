"use client";

import { ProfileSection } from "../profile/profile-section";
import { BillingSection } from "../billing/billing-section";
import { useAppConfig } from "@/lib/app-config";

export default function AccountSettingsPage(): React.ReactElement {
  const config = useAppConfig();
  const billingEnabled = config?.billingEnabled ?? false;

  return (
    <div className="divide-y divide-[var(--border)] space-y-0">
      <section className="pb-10">
        <ProfileSection />
      </section>
      {billingEnabled && (
        <section id="billing" className="pt-10">
          <BillingSection />
        </section>
      )}
    </div>
  );
}
