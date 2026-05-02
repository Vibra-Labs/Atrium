"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { BrandingSection } from "../system/branding-section";
import { LabelsSection } from "../system/labels-section";

interface Branding {
  primaryColor: string;
  accentColor: string;
  logoUrl?: string;
  logoKey?: string;
  organizationId?: string;
  hideLogo?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export function BrandingPageSection(): React.ReactElement {
  const [branding, setBranding] = useState<Branding>({
    primaryColor: "#006b68",
    accentColor: "#ff6b5c",
  });
  const [orgName, setOrgName] = useState<string>("");
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const router = useRouter();
  const { success, error: showError } = useToast();

  useEffect(() => {
    Promise.all([
      apiFetch<Branding>("/branding"),
      fetch(`${API_URL}/api/auth/organization/get-full-organization`, {
        credentials: "include",
      }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([brandingData, org]) => {
        setBranding(brandingData);
        if (org?.name) setOrgName(org.name);
        if (org?.slug) setOrgSlug(org.slug);
        setLoading(false);
      })
      .catch((err) => {
        showError(err instanceof Error ? err.message : "Failed to load branding");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      await Promise.all([
        apiFetch("/branding", {
          method: "PUT",
          body: JSON.stringify({
            primaryColor: branding.primaryColor,
            accentColor: branding.accentColor,
            hideLogo: branding.hideLogo ?? false,
          }),
        }),
        fetch(`${API_URL}/api/auth/organization/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { name: orgName.trim() } }),
          credentials: "include",
        }),
      ]);
      success("Workspace saved");
      router.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="max-w-lg divide-y divide-[var(--border)]">
      <form onSubmit={handleSave} className="space-y-0">
        <section className="space-y-4 pb-8">
          <div>
            <h2 className="text-base font-semibold">Branding</h2>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
              Customize your client portal appearance with your company name, logo, and brand colors.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Company Name</label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Your company name"
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              Displayed in the sidebar and client portal header.
            </p>
          </div>
          <BrandingSection branding={branding} onBrandingChange={setBranding} orgName={orgName} orgSlug={orgSlug} />
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </section>
      </form>

      <section className="space-y-4 py-8">
        <div>
          <h2 className="text-base font-semibold">Labels</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
            Create labels to tag and organize projects, tasks, files, and clients.
          </p>
        </div>
        <LabelsSection />
      </section>
    </div>
  );
}
