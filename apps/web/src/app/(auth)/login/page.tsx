import { headers } from "next/headers";
import type { Metadata } from "next";
import { getBrandingByDomain, getInstanceBranding, buildBrandingStyle } from "@/lib/branding";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const customHost = headersList.get("x-custom-host");
  const branding = customHost
    ? await getBrandingByDomain(customHost)
    : await getInstanceBranding();
  if (!branding?.orgName) return {};
  return { title: `Sign in to ${branding.orgName}` };
}

export default async function LoginPage() {
  const headersList = await headers();
  const customHost = headersList.get("x-custom-host");

  const branding = customHost
    ? await getBrandingByDomain(customHost)
    : await getInstanceBranding();

  return (
    <div style={buildBrandingStyle(branding)}>
      <LoginForm
        orgName={branding?.orgName}
        logoSrc={branding?.logoSrc}
        hideLogo={branding?.hideLogo}
      />
    </div>
  );
}
