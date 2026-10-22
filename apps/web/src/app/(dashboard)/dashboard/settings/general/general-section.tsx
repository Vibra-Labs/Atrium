"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { Mail, HardDrive, Send, Globe, BarChart2, Clock } from "lucide-react";
import { enableSentry } from "@/lib/sentry";
import { CustomDomainSection } from "../system/custom-domain-section";
import { SMTP_DEFAULT_PORTS } from "@atrium/shared";
import type { SmtpSecurity } from "@atrium/shared";

interface SystemSettings {
  emailProvider: string | null;
  emailFrom: string | null;
  resendApiKey: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpSecurity: SmtpSecurity;
  maxFileSizeMb: number;
  setupCompleted: boolean;
  telemetryEnabled: boolean | null;
  timezone: string | null;
}

const defaultSettings: SystemSettings = {
  emailProvider: null,
  emailFrom: null,
  resendApiKey: null,
  smtpHost: null,
  smtpPort: null,
  smtpUser: null,
  smtpPass: null,
  smtpSecurity: "starttls",
  maxFileSizeMb: 50,
  setupCompleted: false,
  telemetryEnabled: null,
  timezone: null,
};

const SMTP_SECURITY_OPTIONS: { value: SmtpSecurity; label: string }[] = [
  { value: "starttls", label: "STARTTLS (587)" },
  { value: "tls", label: "SSL/TLS (465)" },
  { value: "none", label: "None (25)" },
];

/** The port in use: the one typed, or the usual port of the chosen security mode. */
function smtpPort(settings: SystemSettings): number {
  return settings.smtpPort ?? SMTP_DEFAULT_PORTS[settings.smtpSecurity];
}

/** Picking a security mode moves the port to that mode's usual one, unless the port was changed by hand. */
function withSmtpSecurity(settings: SystemSettings, smtpSecurity: SmtpSecurity): SystemSettings {
  const wasUsual: boolean = settings.smtpPort === null || settings.smtpPort === SMTP_DEFAULT_PORTS[settings.smtpSecurity];
  return { ...settings, smtpSecurity, smtpPort: wasUsual ? SMTP_DEFAULT_PORTS[smtpSecurity] : settings.smtpPort };
}

function timezoneOptions(browserZone: string): string[] {
  const zones: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const withUtc: string[] = zones.includes("UTC") ? zones : ["UTC", ...zones];
  return !browserZone || withUtc.includes(browserZone) ? withUtc : [browserZone, ...withUtc];
}

export function GeneralSection(): React.ReactElement {
  const [settings, setSettings] = useState<SystemSettings>(defaultSettings);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [testingEmail, setTestingEmail] = useState<boolean>(false);
  const { success, error: showError } = useToast();

  const [editedApiKey, setEditedApiKey] = useState<boolean>(false);
  const [editedSmtpPass, setEditedSmtpPass] = useState<boolean>(false);
  const [hasResendApiKey, setHasResendApiKey] = useState<boolean>(false);
  const [hasSmtpPass, setHasSmtpPass] = useState<boolean>(false);
  // Read on the client only: during server rendering this would be the server's zone.
  const [browserZone, setBrowserZone] = useState<string>("");
  useEffect(() => setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  useEffect(() => {
    apiFetch<SystemSettings>("/settings")
      .then((data) => {
        setHasResendApiKey(!!data.resendApiKey);
        setHasSmtpPass(!!data.smtpPass);
        setSettings(data);
        setLoading(false);
      })
      .catch((err) => {
        showError(err instanceof Error ? err.message : "Failed to load settings");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        emailProvider: settings.emailProvider,
        emailFrom: settings.emailFrom || null,
        smtpHost: settings.smtpHost || null,
        smtpPort: settings.emailProvider === "smtp" ? smtpPort(settings) : settings.smtpPort,
        smtpUser: settings.smtpUser || null,
        smtpSecurity: settings.smtpSecurity,
        maxFileSizeMb: settings.maxFileSizeMb,
        timezone: settings.timezone,
      };
      if (editedApiKey) payload.resendApiKey = settings.resendApiKey || null;
      if (editedSmtpPass) payload.smtpPass = settings.smtpPass || null;

      const updated = await apiFetch<SystemSettings>("/settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setSettings(updated);
      setHasResendApiKey(!!updated.resendApiKey);
      setHasSmtpPass(!!updated.smtpPass);
      setEditedApiKey(false);
      setEditedSmtpPass(false);
      success("Configuration saved");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleTelemetryToggle = async (enabled: boolean): Promise<void> => {
    try {
      const updated = await apiFetch<SystemSettings>("/settings", {
        method: "PATCH",
        body: JSON.stringify({ telemetryEnabled: enabled }),
      });
      setSettings((prev) => ({ ...prev, telemetryEnabled: updated.telemetryEnabled }));
      if (enabled) enableSentry();
      success(enabled ? "Error reporting enabled" : "Error reporting disabled");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update telemetry setting");
    }
  };

  const handleTestEmail = async (): Promise<void> => {
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
    <div className="max-w-lg divide-y divide-[var(--border)]">
      <form onSubmit={handleSave} className="space-y-0">
        <section className="space-y-4 pb-8">
          <div className="flex items-center gap-2">
            <Mail size={18} />
            <h2 className="text-base font-semibold">Email</h2>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Configure how Atrium sends emails (invitations, password resets, etc.)
          </p>

          <div className="space-y-2">
            <label className="text-sm font-medium">Email Provider</label>
            <select
              value={settings.emailProvider ?? ""}
              onChange={(e) =>
                setSettings({ ...settings, emailProvider: e.target.value || null })
              }
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            >
              <option value="">None (disabled)</option>
              <option value="resend">Resend</option>
              <option value="smtp">SMTP</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">From Email</label>
            <input
              type="email"
              placeholder="noreply@example.com"
              value={settings.emailFrom ?? ""}
              onChange={(e) => setSettings({ ...settings, emailFrom: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              The sender address for outgoing emails.
            </p>
          </div>

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

          {settings.emailProvider === "smtp" && (
            <div className="space-y-3 p-4 border border-[var(--border)] rounded-lg">
              <div className="space-y-2">
                <label className="text-sm font-medium">SMTP Host</label>
                <input
                  type="text"
                  placeholder="smtp.example.com"
                  value={settings.smtpHost ?? ""}
                  onChange={(e) => setSettings({ ...settings, smtpHost: e.target.value })}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label htmlFor="smtp-security" className="text-sm font-medium">Security</label>
                  <select
                    id="smtp-security"
                    value={settings.smtpSecurity}
                    onChange={(e) => setSettings(withSmtpSecurity(settings, e.target.value as SmtpSecurity))}
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                  >
                    {SMTP_SECURITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label htmlFor="smtp-port" className="text-sm font-medium">Port</label>
                  <input
                    id="smtp-port"
                    type="number"
                    value={smtpPort(settings)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        smtpPort: e.target.value ? parseInt(e.target.value, 10) : null,
                      })
                    }
                    className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Most providers use STARTTLS on port 587 or SSL/TLS on port 465. Change the port if yours differs.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Username</label>
                <input
                  type="text"
                  placeholder="SMTP username"
                  value={settings.smtpUser ?? ""}
                  onChange={(e) => setSettings({ ...settings, smtpUser: e.target.value })}
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

        <section className="space-y-4 py-8">
          <div className="flex items-center gap-2">
            <Clock size={18} />
            <h2 className="text-base font-semibold">Timezone</h2>
          </div>
          <div className="space-y-2">
            <label htmlFor="workspace-timezone" className="text-sm font-medium">
              Workspace timezone
            </label>
            <select
              id="workspace-timezone"
              value={settings.timezone ?? ""}
              onChange={(e) => setSettings({ ...settings, timezone: e.target.value || null })}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
            >
              <option value="">Not set</option>
              {timezoneOptions(browserZone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--muted-foreground)]">
              The Monday digest and Friday update reminder go out in this timezone. Not set means UTC.
              {browserZone && settings.timezone !== browserZone && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, timezone: browserZone })}
                    className="text-[var(--primary)] hover:underline"
                  >
                    Use {browserZone.replace(/_/g, " ")}
                  </button>
                </>
              )}
            </p>
          </div>
        </section>

        <section className="space-y-4 py-8">
          <div className="flex items-center gap-2">
            <HardDrive size={18} />
            <h2 className="text-base font-semibold">Files</h2>
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
                setSettings({ ...settings, maxFileSizeMb: parseInt(e.target.value, 10) })
              }
              className="w-full"
            />
            <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
              <span>1 MB</span>
              <span>500 MB</span>
            </div>
          </div>
        </section>

        <section className="space-y-4 py-8">
          <div className="flex items-center gap-2">
            <BarChart2 size={18} />
            <h2 className="text-base font-semibold">Error Reporting</h2>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Share anonymous crash reports and error data with the Atrium team to help fix bugs and improve the product. No personal data or client information is ever included.
          </p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.telemetryEnabled === true}
              onChange={(e) => handleTelemetryToggle(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-medium">
              {settings.telemetryEnabled === true
                ? "Anonymous error reporting is enabled"
                : settings.telemetryEnabled === false
                  ? "Anonymous error reporting is disabled"
                  : "Enable anonymous error reporting"}
            </span>
          </label>
        </section>

        <div className="py-8">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>

      <section className="space-y-4 py-8">
        <div className="flex items-center gap-2">
          <Globe size={18} />
          <h2 className="text-base font-semibold">Custom Domain</h2>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          Let your clients access the portal at your own domain (e.g. portal.yourcompany.com).
        </p>
        <CustomDomainSection />
      </section>
    </div>
  );
}
