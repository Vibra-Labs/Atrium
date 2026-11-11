"use client";

import { BrandingPageSection } from "../branding/branding-page-section";
import { GeneralSection } from "../general/general-section";
import { LeadSourcesSection } from "../lead-sources/lead-sources-section";
import { PipelineStagesSection } from "../pipeline-stages/pipeline-stages-section";
import { ProjectStatusesSection } from "../project-statuses/project-statuses-section";

export default function WorkspaceSettingsPage(): React.ReactElement {
  return (
    <div className="divide-y divide-[var(--border)] space-y-0">
      <section className="pb-10">
        <BrandingPageSection />
      </section>
      <section className="py-10">
        <LeadSourcesSection />
      </section>
      <section className="py-10">
        <PipelineStagesSection />
      </section>
      <section className="py-10">
        <ProjectStatusesSection />
      </section>
      <section className="pt-10">
        <GeneralSection />
      </section>
    </div>
  );
}
