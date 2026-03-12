import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SignOutButton } from "./sign-out-button";
import { getSession } from "@/lib/auth";

const API_URL = process.env.API_URL || "http://localhost:3001";

async function getBranding() {
  try {
    const cookieStore = await cookies();
    const res = await fetch(
      `${API_URL}/api/branding`,
      {
        headers: { Cookie: cookieStore.toString() },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function getOrgName() {
  try {
    const cookieStore = await cookies();
    const res = await fetch(
      `${API_URL}/api/auth/organization/get-full-organization`,
      {
        headers: { Cookie: cookieStore.toString() },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const org = await res.json();
    return org?.name || null;
  } catch {
    return null;
  }
}

function getLogoSrc(branding: { logoKey?: string; logoUrl?: string; organizationId?: string } | null) {
  if (!branding) return null;
  if (branding.logoKey) {
    return `${API_URL}/api/branding/logo/${branding.organizationId}`;
  }
  if (branding.logoUrl) {
    return branding.logoUrl;
  }
  return null;
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, branding, orgName] = await Promise.all([
    getSession(),
    getBranding(),
    getOrgName(),
  ]);
  if (!session) {
    redirect("/login");
  }

  const logoSrc = getLogoSrc(branding);

  return (
    <div
      style={
        {
          "--primary": branding?.primaryColor || "#006b68",
          "--accent": branding?.accentColor || "#ff6b5c",
        } as React.CSSProperties
      }
    >
      <header className="border-b border-[var(--border)] px-6 py-4 flex items-center gap-3">
        {!branding?.hideLogo && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={logoSrc || "/icon.png"} alt="Logo" className="h-8 w-8 object-contain" />
        )}
        <span className="font-semibold flex-1">{orgName || "Atrium"}</span>
        <Link
          href="/portal"
          className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          Projects
        </Link>
        <Link
          href="/portal/settings"
          className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          Settings
        </Link>
        <SignOutButton />
      </header>
      <main className="max-w-6xl mx-auto p-8">{children}</main>
    </div>
  );
}
