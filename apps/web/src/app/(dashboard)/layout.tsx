import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignOutButton } from "./sign-out-button";
import { SidebarNav } from "./sidebar-nav";
import { EmailVerificationBanner } from "./email-verification-banner";
import { TelemetryConsentBanner } from "@/components/telemetry-consent-banner";
import { MobileNav } from "./mobile-nav";
import { OrgSwitcher, type SwitchableOrg } from "./org-switcher";
import { NotificationBell } from "@/components/notification-bell";
import { GlobalSearch } from "@/components/global-search";
import { DynamicFavicon } from "@/components/dynamic-favicon";
import { DEFAULT_BRANDING } from "@atrium/shared";

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

async function getActiveOrg(): Promise<{ id: string; name: string } | null> {
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
    if (!org?.id) return null;
    return { id: org.id, name: org.name };
  } catch (err) {
    console.error("Failed to load active organization", err);
    return null;
  }
}

// Every org this user is a member of, for the sidebar switcher.
async function getOrgs(): Promise<SwitchableOrg[]> {
  try {
    const cookieStore = await cookies();
    const res = await fetch(`${API_URL}/api/auth/organization/list`, {
      headers: { Cookie: cookieStore.toString() },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const orgs = await res.json();
    return Array.isArray(orgs) ? orgs : [];
  } catch (err) {
    console.error("Failed to load organizations", err);
    return [];
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
  const [session, branding, activeOrg, orgs] = await Promise.all([
    getSessionWithRole(),
    getBranding(),
    getActiveOrg(),
    getOrgs(),
  ]);
  const orgName = activeOrg?.name || null;

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
    <div
      className="min-h-screen flex"
      style={
        {
          "--primary": branding?.primaryColor || DEFAULT_BRANDING.primaryColor,
        } as React.CSSProperties
      }
    >
      <DynamicFavicon href={logoSrc || "/icon.png"} />
      {/* Desktop sidebar - hidden on mobile */}
      <aside className="hidden md:flex w-64 border-r border-[var(--border)] p-4 flex-col">
        <div className="flex items-center mb-6">
          <OrgSwitcher
            orgs={orgs}
            activeOrgId={activeOrg?.id || null}
            orgName={orgName}
            logoSrc={logoSrc}
            hideLogo={branding?.hideLogo}
          />
        </div>
        <SidebarNav />
        <div className="mt-auto pt-4">
          <SignOutButton />
        </div>
      </aside>

      {/* Mobile nav */}
      <MobileNav
        logoSrc={logoSrc}
        orgName={orgName}
        hideLogo={branding?.hideLogo}
        orgs={orgs}
        activeOrgId={activeOrg?.id || null}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Global actions live here rather than in the sidebar, so the org
            name gets the full sidebar width. Desktop only — MobileNav
            carries its own copy of these. */}
        <header className="hidden md:flex items-center justify-end gap-1 px-6 lg:px-8 pt-4">
          <GlobalSearch iconOnly />
          <NotificationBell />
        </header>

        {/* pt-[4.5rem] on mobile = h-14 navbar (3.5rem) + 1rem spacing */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-md:pt-[4.5rem] md:pt-4">
          {!session.user?.emailVerified && (
            <EmailVerificationBanner email={session.user?.email} />
          )}
          {session.role === "owner" && telemetryEnabled === null && (
            <TelemetryConsentBanner />
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
