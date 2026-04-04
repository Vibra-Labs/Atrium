"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { Upload, Copy, Check } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface Branding {
  primaryColor: string;
  accentColor: string;
  logoUrl?: string;
  logoKey?: string;
  organizationId?: string;
  hideLogo?: boolean;
}

export function BrandingSection({
  branding,
  onBrandingChange,
  orgName,
  orgSlug,
}: {
  branding: Branding;
  onBrandingChange: (branding: Branding) => void;
  orgName?: string;
  orgSlug?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { error: showError } = useToast();

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
      onBrandingChange({ ...branding, ...updated });
      setCacheBust(Date.now());
      router.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to upload logo");
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
      onBrandingChange({ ...branding, ...updated });
      setCacheBust(Date.now());
      router.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to remove logo");
    }
  };

  const [cacheBust, setCacheBust] = useState(() => Date.now());
  const logoSrc = branding.logoKey
    ? `${API_URL}/api/branding/logo/${branding.organizationId}?v=${cacheBust}`
    : branding.logoUrl || null;

  return (
    <div className="space-y-4">
      {/* Logo Upload */}
      <div className="space-y-3">
        <label className="text-sm font-medium">Company Logo</label>
        <p className="text-xs text-[var(--muted-foreground)]">
          PNG, JPEG, SVG, or WebP. Max 5MB. Displayed in the client portal header.
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
              <Upload size={20} className="text-[var(--muted-foreground)] mb-1 mx-auto" />
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

      {/* Hide Logo Toggle */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={branding.hideLogo ?? false}
            onChange={(e) =>
              onBrandingChange({ ...branding, hideLogo: e.target.checked })
            }
            className="rounded"
          />
          <span className="text-sm font-medium">Hide logo in sidebar</span>
        </label>
        <p className="text-xs text-[var(--muted-foreground)]">
          Hide the logo from the sidebar and portal header. Useful if you
          don&apos;t have a company logo yet.
        </p>
      </div>

      {/* Branded Login URL */}
      {orgSlug && (
        <div className="p-3 bg-[var(--muted)] rounded-lg space-y-1.5">
          <p className="text-xs font-medium">Branded login URL</p>
          <div className="flex items-center gap-2">
            <code className="text-xs text-[var(--muted-foreground)] flex-1 truncate">
              {typeof window !== "undefined" ? window.location.origin : ""}/login/{orgSlug}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/login/${orgSlug}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center gap-1 text-xs px-2 py-1 border border-[var(--border)] rounded hover:bg-[var(--background)] transition-colors"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Share this with your team and clients for a branded sign-in page.
            On self-hosted instances, uploading a logo automatically shows it on <code className="text-[10px]">/login</code>.
          </p>
        </div>
      )}

      {/* Colors */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Primary Color</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={branding.primaryColor}
            onChange={(e) =>
              onBrandingChange({ ...branding, primaryColor: e.target.value })
            }
            className="w-10 h-10 rounded cursor-pointer border-0"
          />
          <input
            type="text"
            value={branding.primaryColor}
            onChange={(e) =>
              onBrandingChange({ ...branding, primaryColor: e.target.value })
            }
            className="px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] font-mono text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Accent Color</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={branding.accentColor}
            onChange={(e) =>
              onBrandingChange({ ...branding, accentColor: e.target.value })
            }
            className="w-10 h-10 rounded cursor-pointer border-0"
          />
          <input
            type="text"
            value={branding.accentColor}
            onChange={(e) =>
              onBrandingChange({ ...branding, accentColor: e.target.value })
            }
            className="px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] font-mono text-sm"
          />
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
          <span className="text-sm font-semibold flex-1">{orgName || "Atrium"}</span>
          <div className="flex gap-2">
            <div
              className="w-6 h-6 rounded"
              style={{ backgroundColor: branding.primaryColor }}
            />
            <div
              className="w-6 h-6 rounded"
              style={{ backgroundColor: branding.accentColor }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
