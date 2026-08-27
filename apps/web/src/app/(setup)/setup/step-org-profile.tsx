"use client";

import { useState, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { Upload } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface Branding {
  primaryColor: string;
  logoUrl?: string;
  logoKey?: string;
  organizationId?: string;
}

interface StepOrgProfileProps {
  orgName: string;
  onNext: () => void;
}

export function StepOrgProfile({ orgName, onNext }: StepOrgProfileProps) {
  const [name, setName] = useState(orgName);

  // Sync local state when the parent finishes loading the org name
  useEffect(() => {
    if (orgName) setName(orgName);
  }, [orgName]);

  const [branding, setBranding] = useState<Branding>({
    primaryColor: "#006b68",
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch<Branding>("/branding").then(setBranding).catch(() => {});
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const updated = await apiFetch<Branding>("/branding/logo", {
        method: "POST",
        body: formData,
      });
      setBranding((prev) => ({ ...prev, ...updated }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleLogoDelete = async () => {
    try {
      const updated = await apiFetch<Branding>("/branding/logo", {
        method: "DELETE",
      });
      setBranding((prev) => ({ ...prev, ...updated }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove logo");
    }
  };

  const handleNext = async () => {
    if (!name.trim()) {
      setError("Organization name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Update org name via Better Auth
      await fetch(`${API_URL}/api/auth/organization/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { name: name.trim() } }),
        credentials: "include",
      });

      // Update branding colors
      await apiFetch("/branding", {
        method: "PUT",
        body: JSON.stringify({
          primaryColor: branding.primaryColor,
        }),
      });

      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const logoSrc = branding.logoKey
    ? `${API_URL}/api/branding/logo/${branding.organizationId}`
    : branding.logoUrl || null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Organization Profile</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Set up your organization name and branding. This is what your clients
          will see.
        </p>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
          {error}
        </div>
      )}

      {/* Organization Name */}
      <div className="space-y-2">
        <label htmlFor="setup-org-name" className="text-sm font-medium">
          Organization Name
        </label>
        <input
          id="setup-org-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your agency or company name"
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        />
      </div>

      {/* Logo Upload */}
      <div className="space-y-3">
        <label className="text-sm font-medium">Company Logo</label>
        <p className="text-xs text-[var(--muted-foreground)]">
          PNG, JPEG, SVG, or WebP. Max 2MB.
        </p>

        {logoSrc ? (
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 border border-[var(--border)] rounded-lg flex items-center justify-center overflow-hidden bg-[var(--background)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoSrc}
                alt="Current logo"
                className="max-w-full max-h-full object-contain"
              />
            </div>
            <div className="flex gap-2">
              <label className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm cursor-pointer hover:bg-[var(--muted)]">
                {uploading ? "Uploading..." : "Replace"}
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
                  onChange={handleLogoUpload}
                  disabled={uploading}
                />
              </label>
              <button
                type="button"
                onClick={handleLogoDelete}
                className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--muted)] transition-colors">
            <div className="text-center">
              <Upload
                size={20}
                className="text-[var(--muted-foreground)] mb-1 mx-auto"
              />
              <p className="text-sm text-[var(--muted-foreground)]">
                {uploading ? "Uploading..." : "Click to upload your logo"}
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
              onChange={handleLogoUpload}
              disabled={uploading}
            />
          </label>
        )}
      </div>

      {/* Colors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Primary Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={branding.primaryColor}
              onChange={(e) =>
                setBranding({ ...branding, primaryColor: e.target.value })
              }
              className="w-10 h-10 rounded cursor-pointer border-0"
            />
            <input
              type="text"
              value={branding.primaryColor}
              onChange={(e) =>
                setBranding({ ...branding, primaryColor: e.target.value })
              }
              className="px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] font-mono text-sm w-28"
            />
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="p-4 rounded-lg border border-[var(--border)]">
        <p className="text-sm font-medium mb-3">Preview</p>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)]">
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} alt="Logo preview" className="h-8" />
          ) : (
            <div className="w-8 h-8 rounded bg-[var(--muted)] flex items-center justify-center text-xs text-[var(--muted-foreground)]">
              Logo
            </div>
          )}
          <span className="text-sm font-semibold flex-1">
            {name || "Your Organization"}
          </span>
          <div className="flex gap-2">
            <div
              className="w-6 h-6 rounded"
              style={{ backgroundColor: branding.primaryColor }}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleNext}
          disabled={saving}
          className="px-6 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
