"use client";

import { useEffect } from "react";
import { apiFetch } from "@/lib/api";

/**
 * Owners who never open workspace settings would otherwise get scheduled emails
 * on UTC time. Fill the timezone in from the browser once, only when it's unset.
 */
export function TimezoneSync(): null {
  useEffect(() => {
    const timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timezone) return;
    apiFetch<{ timezone: string | null }>("/settings")
      .then((settings) => {
        if (settings.timezone) return;
        return apiFetch("/settings", { method: "PATCH", body: JSON.stringify({ timezone }) });
      })
      .catch((err: unknown) => console.error("Failed to sync workspace timezone", err));
  }, []);
  return null;
}
