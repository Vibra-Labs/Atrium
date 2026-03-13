/**
 * Wrapper around Umami's tracking API.
 * No-ops silently when Umami isn't loaded (e.g. no NEXT_PUBLIC_TRACKERS set).
 */
export function track(event: string, data?: Record<string, string | number | boolean>) {
  if (typeof window !== "undefined" && typeof window.umami !== "undefined") {
    window.umami.track(event, data);
  }
}
