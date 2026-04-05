const API_URL = process.env.API_URL || "http://localhost:3001";

export interface BrandingData {
  orgName: string;
  orgId?: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoSrc: string | null;
  hideLogo: boolean;
}

async function fetchBranding(url: string): Promise<BrandingData | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (res.status === 404 || res.status === 204) return null;
    if (!res.ok) throw new Error(`Branding fetch failed: ${res.status}`);
    return res.json();
  } catch (err) {
    // Re-throw so callers can distinguish "not found" (null) from "API error" (thrown)
    throw err;
  }
}

export function getBrandingByDomain(host: string) {
  return fetchBranding(`${API_URL}/api/branding/domain?host=${encodeURIComponent(host)}`).catch(() => null);
}

// Throws on 5xx so the caller can show a proper 404 vs error page
export function getBrandingBySlug(slug: string) {
  return fetchBranding(`${API_URL}/api/branding/public/${slug}`);
}

export function getInstanceBranding() {
  return fetchBranding(`${API_URL}/api/branding/instance`).catch(() => null);
}

export function buildBrandingStyle(branding: BrandingData | null): React.CSSProperties {
  const style: Record<string, string> = {};
  if (branding?.primaryColor) style["--primary"] = branding.primaryColor;
  if (branding?.accentColor) style["--accent"] = branding.accentColor;
  return style as React.CSSProperties;
}
