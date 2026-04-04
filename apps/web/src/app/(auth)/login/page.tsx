import { headers } from "next/headers";
import { LoginForm } from "./login-form";

const API_URL = process.env.API_URL || "http://localhost:3001";

interface BrandingData {
  orgName: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoSrc: string | null;
  hideLogo: boolean;
}

async function getBrandingByDomain(host: string): Promise<BrandingData | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/branding/domain?host=${encodeURIComponent(host)}`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getInstanceBranding(): Promise<BrandingData | null> {
  try {
    const res = await fetch(`${API_URL}/api/branding/instance`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function LoginPage() {
  const headersList = await headers();
  const customHost = headersList.get("x-custom-host");

  const branding = customHost
    ? await getBrandingByDomain(customHost)
    : await getInstanceBranding();

  const style: Record<string, string> = {};
  if (branding?.primaryColor) style["--primary"] = branding.primaryColor;
  if (branding?.accentColor) style["--accent"] = branding.accentColor;

  return (
    <div style={style as React.CSSProperties}>
      <LoginForm
        orgName={branding?.orgName}
        logoSrc={branding?.logoSrc}
        hideLogo={branding?.hideLogo}
      />
    </div>
  );
}
