import { notFound } from "next/navigation";
import { getBrandingBySlug, buildBrandingStyle } from "@/lib/branding";
import { LoginForm } from "../login-form";

export default async function BrandedLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const branding = await getBrandingBySlug(slug);

  if (!branding) notFound();

  return (
    <div style={buildBrandingStyle(branding)}>
      <LoginForm
        orgName={branding.orgName}
        logoSrc={branding.logoSrc}
        hideLogo={branding.hideLogo}
      />
    </div>
  );
}
