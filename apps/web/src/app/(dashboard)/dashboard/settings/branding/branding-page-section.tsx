"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { LabelsSection } from "../system/labels-section";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export function BrandingPageSection(): React.ReactElement {
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const router = useRouter();
  const { success, error: showError } = useToast();

  useEffect(() => {
    fetch(`${API_URL}/api/organization/current`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((org: { name?: string } | null) => {
        if (org?.name) setOrgName(org.name);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load workspace", err);
        showError(err instanceof Error ? err.message : "Failed to load workspace");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/organization/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { name: orgName.trim() } }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to save workspace name");
      success("Workspace saved");
      router.refresh();
    } catch (err) {
      console.error("Failed to save workspace", err);
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
            <h2 className="text-base font-semibold">Workspace</h2>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
              Your logo, brand color and custom domain are on the{" "}
              <Link href="/dashboard/settings/branding" className="text-[var(--primary)] hover:underline">
                Branding
              </Link>{" "}
              tab.
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
