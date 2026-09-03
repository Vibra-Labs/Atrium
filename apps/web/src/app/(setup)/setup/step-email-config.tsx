"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { track } from "@/lib/track";
import { Mail, Send, CheckCircle, XCircle } from "lucide-react";

interface StepEmailConfigProps {
  onNext: () => void;
  onBack: () => void;
}

type Provider = "none" | "resend" | "smtp";

export function StepEmailConfig({ onNext, onBack }: StepEmailConfigProps) {
  const [provider, setProvider] = useState<Provider>("none");
  const [resendApiKey, setResendApiKey] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testStatus, setTestStatus] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSendTest = async () => {
    if (!testEmail) return;
    setTestStatus("sending");
    setTestMessage("");
    try {
      const result = await apiFetch<{ success: boolean; message?: string }>(
        "/setup/test-email",
        {
          method: "POST",
          body: JSON.stringify({ to: testEmail }),
        },
      );
      if (result.success) {
        setTestStatus("success");
        setTestMessage("Test email sent successfully");
      } else {
        setTestStatus("error");
        setTestMessage(result.message || "Failed to send test email");
      }
    } catch (err) {
      setTestStatus("error");
      setTestMessage(
        err instanceof Error ? err.message : "Failed to send test email",
      );
    }
  };

  const handleNext = async () => {
    if (provider === "none") {
      // An org that finishes setup without email cannot deliver client
      // invitations, so this is worth separating from a real configuration.
      track("setup_email_configured", { provider: "none" });
      onNext();
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = { provider, fromEmail };
      if (provider === "resend") {
        payload.resendApiKey = resendApiKey;
      } else if (provider === "smtp") {
        payload.smtpHost = smtpHost;
        payload.smtpPort = parseInt(smtpPort, 10);
        payload.smtpUser = smtpUser;
        payload.smtpPass = smtpPass;
        payload.smtpSecure = smtpSecure;
      }

      await apiFetch("/setup/email", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      track("setup_email_configured", { provider });
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Email Configuration</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Configure email delivery for sending invitations and notifications.
          You can skip this step and set it up later via environment variables.
        </p>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
          {error}
        </div>
      )}

      {/* Provider selector */}
      <div className="space-y-3">
        <label className="text-sm font-medium">Email Provider</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(
            [
              {
                value: "none",
                label: "Skip for now",
                desc: "Configure later",
              },
              {
                value: "resend",
                label: "Resend",
                desc: "Simple email API",
              },
              {
                value: "smtp",
                label: "SMTP",
                desc: "Any SMTP server",
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setProvider(opt.value)}
              className={`p-4 border rounded-lg text-left transition-colors ${
                provider === opt.value
                  ? "border-[var(--primary)] bg-blue-50/50"
                  : "border-[var(--border)] hover:bg-[var(--muted)]"
              }`}
            >
              <div className="flex items-center gap-2">
                <Mail size={16} />
                <span className="text-sm font-medium">{opt.label}</span>
              </div>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                {opt.desc}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Resend config */}
      {provider === "resend" && (
        <div className="space-y-4 p-4 border border-[var(--border)] rounded-lg">
          <div className="space-y-2">
            <label htmlFor="setup-resend-key" className="text-sm font-medium">
              Resend API Key
            </label>
            <input
              id="setup-resend-key"
              type="password"
              value={resendApiKey}
              onChange={(e) => setResendApiKey(e.target.value)}
              placeholder="re_..."
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="setup-from-email" className="text-sm font-medium">
              From Email
            </label>
            <input
              id="setup-from-email"
              type="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="noreply@yourdomain.com"
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
        </div>
      )}

      {/* SMTP config */}
      {provider === "smtp" && (
        <div className="space-y-4 p-4 border border-[var(--border)] rounded-lg">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="setup-smtp-host" className="text-sm font-medium">
                SMTP Host
              </label>
              <input
                id="setup-smtp-host"
                type="text"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.example.com"
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="setup-smtp-port" className="text-sm font-medium">
                Port
              </label>
              <input
                id="setup-smtp-port"
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                placeholder="587"
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="setup-smtp-user" className="text-sm font-medium">
                Username
              </label>
              <input
                id="setup-smtp-user"
                type="text"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="setup-smtp-pass" className="text-sm font-medium">
                Password
              </label>
              <input
                id="setup-smtp-pass"
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="setup-smtp-secure"
              type="checkbox"
              checked={smtpSecure}
              onChange={(e) => setSmtpSecure(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <label htmlFor="setup-smtp-secure" className="text-sm">
              Use SSL/TLS
            </label>
          </div>
          <div className="space-y-2">
            <label
              htmlFor="setup-smtp-from-email"
              className="text-sm font-medium"
            >
              From Email
            </label>
            <input
              id="setup-smtp-from-email"
              type="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="noreply@yourdomain.com"
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
        </div>
      )}

      {/* Test Email */}
      {provider !== "none" && (
        <div className="p-4 border border-[var(--border)] rounded-lg space-y-3">
          <label htmlFor="setup-test-email" className="text-sm font-medium">
            Send Test Email
          </label>
          <div className="flex gap-2">
            <input
              id="setup-test-email"
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="your-email@example.com"
              className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
            <button
              type="button"
              onClick={handleSendTest}
              disabled={testStatus === "sending" || !testEmail}
              className="flex items-center gap-2 px-4 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] disabled:opacity-50"
            >
              <Send size={14} />
              {testStatus === "sending" ? "Sending..." : "Send Test"}
            </button>
          </div>
          {testStatus === "success" && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle size={14} />
              {testMessage}
            </div>
          )}
          {testStatus === "error" && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <XCircle size={14} />
              {testMessage}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors"
        >
          Back
        </button>
        <div className="flex gap-3">
          {provider !== "none" && (
            <button
              onClick={() => {
                track("setup_step_skipped", { step: "email" });
                onNext();
              }}
              className="px-6 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              Skip
            </button>
          )}
          <button
            onClick={handleNext}
            disabled={saving}
            className="px-6 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : provider === "none"
                ? "Skip & Continue"
                : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
