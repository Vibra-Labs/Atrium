"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Upload, Trash2, ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { startPreview } from "@/lib/preview-mode";
import { useToast } from "@/components/toast";
import { useSession } from "@/lib/session-context";
import { initials } from "@/lib/initials";
import { copyToClipboard } from "@/lib/clipboard";
import { CustomDomainSection } from "../system/custom-domain-section";

interface Branding {
  primaryColor: string;
  logoUrl?: string;
  logoKey?: string;
  organizationId?: string;
  hideLogo?: boolean;
}

const COLOR_PRESETS = [
  { name: "Atrium teal", hex: "#006B68" },
  { name: "Cobalt", hex: "#2449C9" },
  { name: "Plum", hex: "#7A2E8E" },
  { name: "Burnt orange", hex: "#C2410C" },
  { name: "Charcoal", hex: "#1F2937" },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function getContrastColor(hexcolor: string): "black" | "white" {
  const cleanHex = hexcolor.replace("#", "");
  if (cleanHex.length !== 6) return "white";
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "black" : "white";
}

export default function BrandingSettingsPage(): React.ReactElement {
  const { userId, userName } = useSession();
  const { success, error: showError } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // Saved state
  const [initialColor, setInitialColor] = useState("#006B68");
  const [initialHideLogo, setInitialHideLogo] = useState(false);
  const [branding, setBranding] = useState<Branding>({ primaryColor: "#006B68" });
  const [orgName, setOrgName] = useState("Your Studio");
  const [orgSlug, setOrgSlug] = useState("");
  // Read after mount so the server render and the first browser render match.
  const [origin, setOrigin] = useState("");
  const [loginLinkCopied, setLoginLinkCopied] = useState(false);

  // Working state
  const [currentColor, setCurrentColor] = useState("#006B68");
  const [hideLogo, setHideLogo] = useState(false);
  // Shown in the preview's address bar; kept in sync by the Custom domain section below.
  const [portalDomain, setPortalDomain] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cacheBust, setCacheBust] = useState(() => Date.now());

  useEffect(() => {
    Promise.all([
      apiFetch<Branding>("/branding").catch((): Branding => ({ primaryColor: "#006B68" })),
      apiFetch<{ name?: string; slug?: string | null }>("/organization/current").catch(() => null),
    ])
      .then(([bData, orgData]) => {
        const color = bData.primaryColor || "#006B68";
        setBranding(bData);
        setInitialColor(color);
        setCurrentColor(color);
        setInitialHideLogo(bData.hideLogo ?? false);
        setHideLogo(bData.hideLogo ?? false);
        if (orgData?.name) setOrgName(orgData.name);
        if (orgData?.slug) setOrgSlug(orgData.slug);
        setOrigin(window.location.origin);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load branding settings", err);
        showError(err instanceof Error ? err.message : "Failed to load branding");
        setLoading(false);
      });
  }, [showError]);

  const hasColorChange = currentColor.toLowerCase() !== initialColor.toLowerCase();
  const hasHideLogoChange = hideLogo !== initialHideLogo;
  const hasUnsavedChanges = hasColorChange || hasHideLogoChange;

  const unsavedSummary = [
    hasColorChange ? "brand color" : null,
    hasHideLogoChange ? "logo visibility" : null,
  ]
    .filter(Boolean)
    .join(", ");

  const contrastMode = getContrastColor(currentColor);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);

      const updated = await apiFetch<Branding>("/branding/logo", {
        method: "POST",
        body: formData,
      });
      setBranding((prev) => ({ ...prev, ...updated }));
      setCacheBust(Date.now());
      success("Logo updated");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to upload logo");
    } finally {
      setUploadingLogo(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleLogoRemove = async () => {
    try {
      const updated = await apiFetch<Branding>("/branding/logo", {
        method: "DELETE",
      });
      setBranding((prev) => ({ ...prev, ...updated, logoUrl: undefined, logoKey: undefined }));
      setCacheBust(Date.now());
      success("Logo removed");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to remove logo");
    }
  };

  const handleDiscard = () => {
    setCurrentColor(initialColor);
    setHideLogo(initialHideLogo);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch("/branding", {
        method: "PUT",
        body: JSON.stringify({ primaryColor: currentColor, hideLogo }),
      });
      setInitialColor(currentColor);
      setInitialHideLogo(hideLogo);
      success("Branding settings saved");
    } catch (err) {
      console.error("Failed to save branding settings", err);
      showError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const logoSrc = branding.logoKey
    ? `${API_URL}/api/branding/logo/${branding.organizationId}?v=${cacheBust}`
    : branding.logoUrl || null;

  const orgInitials = initials(orgName, "AT");

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
        Loading branding settings...
      </div>
    );
  }

  return (
    <div className="relative pb-24">
      {/* Page Title */}
      <div className="mb-8">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--foreground)]">
          Your client portal
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Clients see your logo, color and domain. Atrium stays out of sight.
        </p>
      </div>

      {/* Main 2-Column Split: Controls Left, Live Preview Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        {/* Left Column (7 cols): Controls */}
        <div className="lg:col-span-7 space-y-8">
          {/* Logo Section */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Logo</h2>
            <div className="flex items-center gap-4 flex-wrap">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-xl overflow-hidden shrink-0 border border-[var(--border)] transition-colors shadow-sm"
                style={{
                  backgroundColor: logoSrc ? "transparent" : currentColor,
                  color: contrastMode,
                }}
              >
                {logoSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoSrc} alt="Agency logo" className="w-full h-full object-contain" />
                ) : (
                  orgInitials
                )}
              </div>
              <div className="flex items-center gap-2.5">
                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)] text-xs font-semibold text-[var(--foreground)] cursor-pointer transition-colors shadow-sm">
                  <Upload size={14} />
                  <span>{uploadingLogo ? "Uploading..." : "Upload new"}</span>
                  <input
                    type="file"
                    ref={fileRef}
                    onChange={handleLogoUpload}
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    className="hidden"
                    disabled={uploadingLogo}
                  />
                </label>
                {logoSrc && (
                  <button
                    type="button"
                    onClick={handleLogoRemove}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 size={13} />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              SVG or PNG, square, at least 256 px. Also used as the portal favicon.
            </p>
            <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--foreground)]">
              <input
                type="checkbox"
                checked={hideLogo}
                onChange={(e) => setHideLogo(e.target.checked)}
                className="rounded"
              />
              Hide logo in the sidebar and portal header
            </label>
          </section>

          {/* Brand Color Section */}
          <section className="space-y-3 pt-6 border-t border-[var(--border)]">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Brand color</h2>
            <div className="flex items-center gap-2.5 flex-wrap">
              {COLOR_PRESETS.map((preset) => {
                const isSelected = currentColor.toLowerCase() === preset.hex.toLowerCase();
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => setCurrentColor(preset.hex)}
                    aria-label={preset.name}
                    className={`w-9 h-9 rounded-full transition-transform hover:scale-105 relative flex items-center justify-center ${
                      isSelected ? "ring-2 ring-offset-2 ring-[var(--foreground)] shadow-sm scale-105" : ""
                    }`}
                    style={{ backgroundColor: preset.hex }}
                  >
                    {isSelected && (
                      <Check
                        size={15}
                        className={getContrastColor(preset.hex) === "white" ? "text-white" : "text-black"}
                      />
                    )}
                  </button>
                );
              })}

              <span className="w-px h-6 bg-[var(--border)] mx-1" />

              {/* Custom Hex input */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-sm">
                <span
                  className="w-5 h-5 rounded-md border border-black/10 shrink-0"
                  style={{ backgroundColor: currentColor }}
                />
                <input
                  type="text"
                  value={currentColor}
                  onChange={(e) => setCurrentColor(e.target.value)}
                  placeholder="#006B68"
                  maxLength={7}
                  className="w-20 text-xs font-mono bg-transparent outline-none uppercase font-medium text-[var(--foreground)]"
                />
              </div>
            </div>

            <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 pt-1">
              <Check size={14} className="shrink-0" />
              <span>
                {contrastMode === "white"
                  ? "White text reads clearly on this color. We pick white for you."
                  : "Black text reads clearly on this color. We pick black for you."}
              </span>
            </p>
          </section>

          {/* Custom domain: the shared section, with real DNS verification and plan gating */}
          <section className="space-y-3.5 pt-6 border-t border-[var(--border)]">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Custom domain</h2>
            <CustomDomainSection onSavedDomainChange={setPortalDomain} />
          </section>

          {orgSlug && (
            <section className="space-y-2 pt-6 border-t border-[var(--border)]">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Branded login link</h2>
              <div className="flex items-center gap-2">
                <code className="text-xs text-[var(--muted-foreground)] flex-1 truncate">
                  {origin}/login/{orgSlug}
                </code>
                <button
                  type="button"
                  onClick={async () => {
                    if (!(await copyToClipboard(`${origin}/login/${orgSlug}`))) {
                      showError("Could not copy link");
                      return;
                    }
                    setLoginLinkCopied(true);
                    setTimeout(() => setLoginLinkCopied(false), 2000);
                  }}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
                >
                  {loginLinkCopied ? <Check size={12} /> : <Copy size={12} />}
                  {loginLinkCopied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Share this with your team and clients for a sign-in page with your logo and color.
              </p>
            </section>
          )}
        </div>

        {/* Right Column (5 cols): Live Client Portal Preview */}
        <div className="lg:col-span-5 space-y-3 lg:sticky lg:top-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Preview · what clients see
          </p>

          {/* Browser Window Mock */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] overflow-hidden shadow-lg">
            {/* Browser top chrome */}
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-[var(--muted)]/70 border-b border-[var(--border)]">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
              </div>
              <div className="flex-1 ml-2 px-2.5 py-1 rounded-md bg-[var(--background)] border border-[var(--border)] text-[11px] text-[var(--muted-foreground)] truncate text-center">
                {portalDomain || "portal.yourstudio.com"}
              </div>
            </div>

            {/* Portal Header inside Preview */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--background)]">
              <div className="flex items-center gap-2">
                <span
                  className="w-6 h-6 rounded-lg flex items-center justify-center font-bold text-[10px] overflow-hidden"
                  style={{
                    backgroundColor: logoSrc ? "transparent" : currentColor,
                    color: contrastMode,
                  }}
                >
                  {logoSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoSrc} alt="" className="w-full h-full object-contain" />
                  ) : (
                    orgInitials
                  )}
                </span>
                <span className="text-xs font-bold text-[var(--foreground)] truncate max-w-[120px]">
                  {orgName}
                </span>
              </div>
              <span className="w-6 h-6 rounded-full bg-[var(--muted)] border border-[var(--border)]" />
            </div>

            {/* Portal Body Mock */}
            <div className="p-4 bg-[var(--muted)]/20 space-y-3 text-xs">
              {/* Project card */}
              <div className="p-3.5 rounded-xl bg-[var(--background)] border border-[var(--border)] space-y-2 shadow-sm">
                <p className="font-bold text-xs text-[var(--foreground)]">Website redesign</p>
                <div className="grid grid-cols-4 gap-1 pt-1">
                  <span className="h-1 rounded-full" style={{ backgroundColor: currentColor }} />
                  <span className="h-1 rounded-full" style={{ backgroundColor: currentColor }} />
                  <span className="h-1 rounded-full" style={{ backgroundColor: currentColor }} />
                  <span className="h-1 rounded-full bg-[var(--muted)]" />
                </div>
              </div>

              {/* Actionable review deliverable card */}
              <div
                className="p-3.5 rounded-xl bg-[var(--background)] space-y-2.5 shadow-sm"
                style={{ border: `2px solid ${currentColor}` }}
              >
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: currentColor }}>
                  Needs your review
                </p>
                <p className="font-semibold text-xs text-[var(--foreground)]">
                  Homepage designs, version 2
                </p>
                <div className="pt-0.5">
                  <span
                    className="inline-block px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm"
                    style={{
                      backgroundColor: currentColor,
                      color: contrastMode,
                    }}
                  >
                    Approve
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Full preview link */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() =>
                startPreview(
                  userId || "",
                  userName || "Client Preview",
                  "client@preview.local",
                  "/dashboard/settings/branding",
                  "/portal",
                )
              }
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--primary)] hover:underline"
            >
              <span>Open the full portal preview</span>
              <ExternalLink size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Floating Bottom Save Bar */}
      {hasUnsavedChanges && (
        <aside
          aria-label="Save changes banner"
          className="fixed bottom-0 left-0 right-0 z-50 p-4 border-t border-[var(--border)] bg-[var(--background)]/95 backdrop-blur-md shadow-2xl flex items-center justify-between gap-4 flex-wrap"
        >
          <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-[var(--foreground)] max-w-xl">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <span>Unsaved changes: {unsavedSummary}</span>
          </div>
          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={handleDiscard}
              disabled={saving}
              className="px-4 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)] text-xs font-semibold text-[var(--foreground)] transition-colors disabled:opacity-50"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-[var(--primary)] text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
