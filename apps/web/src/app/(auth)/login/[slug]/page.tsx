import { notFound } from "next/navigation";
import { LoginForm } from "../login-form";

const API_URL = process.env.API_URL || "http://localhost:3001";

interface BrandingData {
  orgName: string;
  orgId: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoSrc: string | null;
  hideLogo: boolean;
}

async function getOrgBranding(slug: string): Promise<BrandingData | null> {
  try {
    const res = await fetch(`${API_URL}/api/branding/public/${slug}`, {
      next: { revalidate: 60 },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function BrandedLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const branding = await getOrgBranding(slug);

  if (!branding) notFound();

  const style: Record<string, string> = {};
  if (branding.primaryColor) style["--primary"] = branding.primaryColor;
  if (branding.accentColor) style["--accent"] = branding.accentColor;

  return (
    <div style={style as React.CSSProperties}>
      <LoginForm
        orgName={branding.orgName}
        logoSrc={branding.logoSrc}
        hideLogo={branding.hideLogo}
      />
    </div>
  );
}
