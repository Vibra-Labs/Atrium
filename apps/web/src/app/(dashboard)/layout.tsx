import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignOutButton } from "./sign-out-button";
import { SidebarNav } from "./sidebar-nav";
import { EmailVerificationBanner } from "./email-verification-banner";
import { TelemetryConsentBanner } from "@/components/telemetry-consent-banner";
import { MobileNav } from "./mobile-nav";
import { NotificationBell } from "@/components/notification-bell";
import { GlobalSearch } from "@/components/global-search";
import { DynamicFavicon } from "@/components/dynamic-favicon";

const API_URL = process.env.API_URL || "http://localhost:3001";

async function getSessionWithRole() {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();
    const init = { headers: { Cookie: cookieHeader }, cache: "no-store" as const };

    const [sessionRes, memberRes] = await Promise.all([
      fetch(`${API_URL}/api/auth/get-session`, init),
      fetch(`${API_URL}/api/auth/organization/get-active-member`, init),
    ]);

    if (!sessionRes.ok) return null;
    const session = await sessionRes.json();
    if (!session) return null;

    const member = memberRes.ok ? await memberRes.json() : null;
    return { ...session, role: member?.role || null };
  } catch {
    return null;
  }
}

async function getBranding() {
  try {
    const cookieStore = await cookies();
    const res = await fetch(`${API_URL}/api/branding`, {
      headers: { Cookie: cookieStore.toString() },
      cache: "no-store",
    });
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
  if (branding.logoKey) return `${API_URL}/api/branding/logo/${branding.organizationId}?k=${encodeURIComponent(branding.logoKey)}`;
  if (branding.logoUrl) return branding.logoUrl;
  return null;
}

async function getSetupStatus() {
  try {
    const cookieStore = await cookies();
    const res = await fetch(`${API_URL}/api/setup/status`, {
      headers: { Cookie: cookieStore.toString() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ completed: boolean }>;
  } catch {
    return null;
  }
}

async function getTelemetryStatus(): Promise<boolean | null> {
  try {
    const cookieStore = await cookies();
    const res = await fetch(`${API_URL}/api/settings`, {
      headers: { Cookie: cookieStore.toString() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const settings = await res.json();
    return settings?.telemetryEnabled ?? null;
  } catch {
    return null;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, branding, orgName] = await Promise.all([
    getSessionWithRole(),
    getBranding(),
    getOrgName(),
  ]);

  if (!session) {
    redirect("/login");
  }

  // Clients (members) should use the portal, not the dashboard
  if (session.role === "member") {
    redirect("/portal");
  }

  // Redirect owners to setup wizard if setup is not completed
  let telemetryEnabled: boolean | null = null;
  const isHostedDeployment = process.env.NEXT_PUBLIC_SENTRY_ENABLED === "true";
  if (session.role === "owner") {
    const [setupStatus, telemetry] = await Promise.all([
      getSetupStatus(),
      isHostedDeployment ? Promise.resolve(true) : getTelemetryStatus(),
    ]);
    if (setupStatus && !setupStatus.completed) {
      redirect("/setup");
    }
    telemetryEnabled = telemetry;
  }

  const logoSrc = getLogoSrc(branding);

  return (
    <div className="min-h-screen flex">
      <DynamicFavicon href={logoSrc || "/icon.png"} />
      {/* Desktop sidebar - hidden on mobile */}
      <aside className="hidden md:flex w-64 border-r border-[var(--border)] p-4 flex-col">
        <div className="flex items-center gap-2.5 mb-6">
          {!branding?.hideLogo && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={logoSrc || "/icon.png"}
              alt=""
              className="h-7 w-7 object-contain shrink-0"
            />
          )}
          <span className="font-bold text-lg leading-none truncate">
            {orgName || "Atrium"}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <GlobalSearch iconOnly />
            <NotificationBell align="left" />
          </div>
        </div>
        <SidebarNav />
        <div className="mt-auto pt-4">
          <SignOutButton />
        </div>
      </aside>

      {/* Mobile nav */}
      <MobileNav logoSrc={logoSrc} orgName={orgName} hideLogo={branding?.hideLogo} />

      {/* pt-[4.5rem] on mobile = h-14 navbar (3.5rem) + 1rem spacing */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-md:pt-[4.5rem]">
        {!session.user?.emailVerified && (
          <EmailVerificationBanner email={session.user?.email} />
        )}
        {session.role === "owner" && telemetryEnabled === null && (
          <TelemetryConsentBanner />
        )}
        {children}
      </main>
    </div>
  );
}
