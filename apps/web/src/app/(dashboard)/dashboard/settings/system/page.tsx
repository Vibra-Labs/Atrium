"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { Mail, HardDrive, Send, Palette } from "lucide-react";
import { BrandingSection } from "./branding-section";

interface SystemSettings {
  emailProvider: string | null;
  emailFrom: string | null;
  resendApiKey: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpSecure: boolean;
  maxFileSizeMb: number;
  setupCompleted: boolean;
}

interface Branding {
  primaryColor: string;
  accentColor: string;
  logoUrl?: string;
  logoKey?: string;
  organizationId?: string;
  hideLogo?: boolean;
}

const defaultSettings: SystemSettings = {
  emailProvider: null,
  emailFrom: null,
  resendApiKey: null,
  smtpHost: null,
  smtpPort: null,
  smtpUser: null,
  smtpPass: null,
  smtpSecure: true,
  maxFileSizeMb: 50,
  setupCompleted: false,
};

export default function SystemSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings>(defaultSettings);
  const [branding, setBranding] = useState<Branding>({
    primaryColor: "#006b68",
    accentColor: "#ff6b5c",
  });
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const router = useRouter();
  const { success, error: showError } = useToast();

  // Track which sensitive fields have been edited by the user
  const [editedApiKey, setEditedApiKey] = useState(false);
  const [editedSmtpPass, setEditedSmtpPass] = useState(false);

  // Boolean flags tracking whether a secret is already stored server-side.
  // Set once on load from the API response (truthy masked value = key exists).
  const [hasResendApiKey, setHasResendApiKey] = useState(false);
  const [hasSmtpPass, setHasSmtpPass] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

  useEffect(() => {
    Promise.all([
      apiFetch<SystemSettings>("/settings"),
      apiFetch<Branding>("/branding"),
      fetch(`${API_URL}/api/auth/organization/get-full-organization`, {
        credentials: "include",
      }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([settingsData, brandingData, org]) => {
        setHasResendApiKey(!!settingsData.resendApiKey);
        setHasSmtpPass(!!settingsData.smtpPass);
        setSettings(settingsData);
        setBranding(brandingData);
        if (org?.name) setOrgName(org.name);
        setLoading(false);
      })
      .catch((err) => {
        showError(err instanceof Error ? err.message : "Failed to load settings");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        emailProvider: settings.emailProvider,
        emailFrom: settings.emailFrom || null,
        smtpHost: settings.smtpHost || null,
        smtpPort: settings.smtpPort,
        smtpUser: settings.smtpUser || null,
        smtpSecure: settings.smtpSecure,
        maxFileSizeMb: settings.maxFileSizeMb,
      };

      // Only send sensitive fields if the user actually edited them
      if (editedApiKey) {
        payload.resendApiKey = settings.resendApiKey || null;
      }
      if (editedSmtpPass) {
        payload.smtpPass = settings.smtpPass || null;
      }

      const [updatedSettings] = await Promise.all([
        apiFetch<SystemSettings>("/settings", {
          method: "PUT",
          body: JSON.stringify(payload),
        }),
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

      setSettings(updatedSettings);
      setHasResendApiKey(!!updatedSettings.resendApiKey);
      setHasSmtpPass(!!updatedSettings.smtpPass);
      setEditedApiKey(false);
      setEditedSmtpPass(false);
      success("Settings saved");
      router.refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      const result = await apiFetch<{ success: boolean; message: string }>(
        "/settings/test-email",
        { method: "POST" },
      );
      if (result.success) {
        success(result.message);
      } else {
        showError(result.message);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to send test email");
    } finally {
      setTestingEmail(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">System Settings</h1>

      <form onSubmit={handleSave} className="max-w-lg space-y-8">
        {/* Branding */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Palette size={20} />
            <h2 className="text-lg font-semibold">Branding</h2>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Customize your client portal appearance with your company name, logo, and brand colors.
          </p>
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
          <BrandingSection branding={branding} onBrandingChange={setBranding} orgName={orgName} />
        </section>

        {/* Email Configuration */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Mail size={20} />
            <h2 className="text-lg font-semibold">Email Configuration</h2>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Configure how Atrium sends emails (invitations, password resets, etc.)
          </p>

          {/* Provider Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Email Provider</label>
            <select
              value={settings.emailProvider ?? ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  emailProvider: e.target.value || null,
                })
              }
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            >
              <option value="">None (disabled)</option>
              <option value="resend">Resend</option>
              <option value="smtp">SMTP</option>
            </select>
          </div>

          {/* From Email */}
          <div className="space-y-2">
            <label className="text-sm font-medium">From Email</label>
            <input
              type="email"
              placeholder="noreply@example.com"
              value={settings.emailFrom ?? ""}
              onChange={(e) =>
                setSettings({ ...settings, emailFrom: e.target.value })
              }
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              The sender address for outgoing emails.
            </p>
          </div>

          {/* Resend fields */}
          {settings.emailProvider === "resend" && (
            <div className="space-y-2 p-4 border border-[var(--border)] rounded-lg">
              <label className="text-sm font-medium">Resend API Key</label>
              <input
                type="password"
                placeholder={hasResendApiKey ? "Enter new key to replace" : "re_xxxxxxxx"}
                value={editedApiKey ? (settings.resendApiKey ?? "") : ""}
                onChange={(e) => {
                  setEditedApiKey(true);
                  setSettings({ ...settings, resendApiKey: e.target.value });
                }}
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
              />
              {!editedApiKey && hasResendApiKey && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  An API key is already configured. Enter a new value to replace it.
                </p>
              )}
            </div>
          )}

          {/* SMTP fields */}
          {settings.emailProvider === "smtp" && (
            <div className="space-y-3 p-4 border border-[var(--border)] rounded-lg">
              <div className="space-y-2">
                <label className="text-sm font-medium">SMTP Host</label>
                <input
                  type="text"
                  placeholder="smtp.example.com"
                  value={settings.smtpHost ?? ""}
                  onChange={(e) =>
                    setSettings({ ...settings, smtpHost: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Port</label>
                  <input
                    type="number"
                    placeholder="587"
                    value={settings.smtpPort ?? ""}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        smtpPort: e.target.value ? parseInt(e.target.value, 10) : null,
                      })
                    }
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                  />
                </div>
                <div className="space-y-2 flex items-end">
                  <label className="flex items-center gap-2 px-3 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.smtpSecure}
                      onChange={(e) =>
                        setSettings({ ...settings, smtpSecure: e.target.checked })
                      }
                      className="rounded"
                    />
                    <span className="text-sm font-medium">Use TLS/SSL</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Username</label>
                <input
                  type="text"
                  placeholder="SMTP username"
                  value={settings.smtpUser ?? ""}
                  onChange={(e) =>
                    setSettings({ ...settings, smtpUser: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Password</label>
                <input
                  type="password"
                  placeholder={hasSmtpPass ? "Enter new password to replace" : "SMTP password"}
                  value={editedSmtpPass ? (settings.smtpPass ?? "") : ""}
                  onChange={(e) => {
                    setEditedSmtpPass(true);
                    setSettings({ ...settings, smtpPass: e.target.value });
                  }}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                />
                {!editedSmtpPass && hasSmtpPass && (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    A password is already configured. Enter a new value to replace it.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Test Email Button */}
          {settings.emailProvider && (
            <button
              type="button"
              onClick={handleTestEmail}
              disabled={testingEmail}
              className="flex items-center gap-2 px-4 py-2 border border-[var(--border)] rounded-lg text-sm font-medium hover:bg-[var(--muted)] transition-colors"
            >
              <Send size={16} />
              {testingEmail ? "Sending..." : "Send Test Email"}
            </button>
          )}
        </section>

        {/* File Settings */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <HardDrive size={20} />
            <h2 className="text-lg font-semibold">File Settings</h2>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Maximum File Size: {settings.maxFileSizeMb} MB
            </label>
            <input
              type="range"
              min={1}
              max={500}
              value={settings.maxFileSizeMb}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  maxFileSizeMb: parseInt(e.target.value, 10),
                })
              }
              className="w-full"
            />
            <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
              <span>1 MB</span>
              <span>500 MB</span>
            </div>
          </div>
        </section>

        {/* Save */}
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </form>
    </div>
  );
}
