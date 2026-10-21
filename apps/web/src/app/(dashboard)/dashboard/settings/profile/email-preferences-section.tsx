"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";

interface EmailPreferences {
  weeklyUpdateReminders: boolean;
  mondayDigest: boolean;
}

const OPTIONS: { key: keyof EmailPreferences; label: string; hint: string; on: string; off: string }[] = [
  {
    key: "mondayDigest",
    label: "Monday digest",
    hint: "Tasks due this week, what clients did since last week, and overdue invoices. Skipped when there's nothing.",
    on: "Monday digest turned on",
    off: "Monday digest turned off",
  },
  {
    key: "weeklyUpdateReminders",
    label: "Friday reminder to send client updates",
    hint: "Lists client projects that went a week without an update, each with a drafted update ready to review.",
    on: "Friday reminders turned on",
    off: "Friday reminders turned off",
  },
];

/** Owner/admin switches for Atrium's scheduled emails. Hidden for clients. */
export function EmailPreferencesSection(): React.ReactElement | null {
  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const { success, error: showError } = useToast();

  useEffect(() => {
    apiFetch<EmailPreferences>("/email-preferences")
      .then(setPrefs)
      .catch((err: unknown) => {
        // Clients get a 403: these emails are for people who run projects.
        console.error("Failed to load email preferences", err);
      });
  }, []);

  if (!prefs) return <div className="h-24 bg-[var(--muted)] rounded-lg animate-pulse" />;

  const toggle = async (option: (typeof OPTIONS)[number], next: boolean): Promise<void> => {
    const previous: EmailPreferences = prefs;
    setPrefs({ ...prefs, [option.key]: next }); // reflect the click at once; revert if the save fails
    try {
      const saved = await apiFetch<EmailPreferences>("/email-preferences", {
        method: "PUT",
        body: JSON.stringify({ [option.key]: next }),
      });
      setPrefs(saved);
      success(next ? option.on : option.off);
    } catch (err) {
      console.error("Failed to save email preference", err);
      setPrefs(previous);
      showError(err instanceof Error ? err.message : "Failed to save setting");
    }
  };

  return (
    <div className="max-w-md" id="notifications">
      <h2 className="text-base font-semibold mb-3">Email notifications</h2>
      <div className="space-y-3">
        {OPTIONS.map((option) => (
          <label key={option.key} className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs[option.key]}
              onChange={(e) => void toggle(option, e.target.checked)}
              className="mt-1 accent-[var(--primary)]"
            />
            <span className="text-sm">
              {option.label}
              <span className="block text-[var(--muted-foreground)]">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
