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
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export function getBrandingByDomain(host: string) {
  return fetchBranding(`${API_URL}/api/branding/domain?host=${encodeURIComponent(host)}`);
}

export function getBrandingBySlug(slug: string) {
  return fetchBranding(`${API_URL}/api/branding/public/${slug}`);
}

export function getInstanceBranding() {
  return fetchBranding(`${API_URL}/api/branding/instance`);
}

export function buildBrandingStyle(branding: BrandingData | null): React.CSSProperties {
  const style: Record<string, string> = {};
  if (branding?.primaryColor) style["--primary"] = branding.primaryColor;
  if (branding?.accentColor) style["--accent"] = branding.accentColor;
  return style as React.CSSProperties;
}
