export interface LogoBranding {
  logoKey?: string;
  logoUrl?: string;
  organizationId?: string;
}

/**
 * The logo URL the browser loads. `publicApiUrl` is NEXT_PUBLIC_API_URL, which
 * is empty when the API is served from the same origin as the app.
 */
export function logoSrc(branding: LogoBranding | null, publicApiUrl: string): string | null {
  if (!branding) return null;
  if (branding.logoKey) {
    return `${publicApiUrl}/api/branding/logo/${branding.organizationId}?k=${encodeURIComponent(branding.logoKey)}`;
  }
  return branding.logoUrl ?? null;
}
