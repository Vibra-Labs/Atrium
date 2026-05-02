"use client";

import { BrandingPageSection } from "../branding/branding-page-section";
import { GeneralSection } from "../general/general-section";

export default function WorkspaceSettingsPage(): React.ReactElement {
  return (
    <div className="divide-y divide-[var(--border)] space-y-0">
      <section className="pb-10">
        <BrandingPageSection />
      </section>
      <section className="pt-10">
        <GeneralSection />
      </section>
    </div>
  );
}
