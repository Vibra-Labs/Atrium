"use client";

import { useEffect } from "react";
import { apiFetch } from "@/lib/api";

/**
 * Owners who never open workspace settings would otherwise get scheduled emails
 * on UTC time. The layout renders this only while the workspace has no timezone,
 * so it just fills in the browser's zone once.
 */
export function TimezoneSync(): null {
  useEffect(() => {
    const timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timezone) return;
    apiFetch("/settings", { method: "PATCH", body: JSON.stringify({ timezone }) }).catch((err: unknown) =>
      console.error("Failed to sync workspace timezone", err),
    );
  }, []);
  return null;
}
