import { redirect, unstable_rethrow } from "next/navigation";
import { SignOutButton } from "./sign-out-button";
import { SidebarNav } from "./sidebar-nav";
import { EmailVerificationBanner } from "./email-verification-banner";
import { TrialBanner } from "./trial-banner";
import { TimezoneSync } from "./timezone-sync";
import { TelemetryConsentBanner } from "@/components/telemetry-consent-banner";
import { MobileNav } from "./mobile-nav";
import { OrgSwitcher, type SwitchableOrg } from "@/components/org-switcher";
import { NotificationBell } from "@/components/notification-bell";
import { GlobalSearch } from "@/components/global-search";
import { DynamicFavicon } from "@/components/dynamic-favicon";
import { ThemeToggle } from "@/components/theme-toggle";
import { DEFAULT_BRANDING } from "@atrium/shared";
import { serverFetch } from "@/lib/server-api";
import { logoSrc as buildLogoSrc } from "@/lib/logo-src";
import { SessionProvider } from "@/lib/session-context";

async function getSession() {
  try {
    const res: Response = await serverFetch("/api/auth/get-session");
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    // cookies() throws a control-flow signal during static render; let it through.
    unstable_rethrow(err);
    console.error("Failed to load session", err);
    return null;
  }
}

async function getBranding() {
  try {
    const res: Response = await serverFetch("/api/branding");
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    // cookies() throws a control-flow signal during static render; let it through.
    unstable_rethrow(err);
    console.error("Failed to load branding", err);
    return null;
  }
}

/** Owner-only workspace settings; null on any failure (including non-owners). */
async function getSettings(): Promise<{
  timezone?: string | null;
  telemetryEnabled?: boolean | null;
} | null> {
  try {
    const res: Response = await serverFetch("/api/settings");
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    // cookies() throws a control-flow signal during static render; let it through.
    unstable_rethrow(err);
    console.error("Failed to load workspace settings", err);
    return null;
  }
}

async function getActiveOrg(): Promise<{ id: string; name: string; role: string } | null> {
  try {
    const res: Response = await serverFetch("/api/organization/current");
    if (!res.ok) return null;
    const org: { id?: string; name: string; role?: string } = await res.json();
    if (!org?.id) return null;
    return { id: org.id, name: org.name, role: org.role ?? "" };
  } catch (err) {
    // cookies() throws a control-flow signal during Next's static render
    // pass; that must propagate, not be logged as a failure.
    unstable_rethrow(err);
    console.error("Failed to load active organization", err);
    return null;
  }
}

// Every org this user is a member of, for the sidebar switcher.
async function getOrgs(): Promise<SwitchableOrg[]> {
  try {
    const res: Response = await serverFetch("/api/auth/organization/list");
    if (!res.ok) return [];
    const orgs = await res.json();
    return Array.isArray(orgs) ? orgs : [];
  } catch (err) {
    unstable_rethrow(err);
    console.error("Failed to load organizations", err);
    return [];
  }
}

async function getSetupStatus() {
  try {
    const res: Response = await serverFetch("/api/setup/status");
    if (!res.ok) return null;
    return res.json() as Promise<{ completed: boolean }>;
  } catch (err) {
    // cookies() throws a control-flow signal during static render; let it through.
    unstable_rethrow(err);
    console.error("Failed to load setup status", err);
    return null;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // One round: setup status and settings are owner-only, so non-owners
  // just ignore those results.
  const [session, branding, activeOrg, orgs, setupStatus, settings] = await Promise.all([
    getSession(),
    getBranding(),
    getActiveOrg(),
    getOrgs(),
    getSetupStatus(),
    getSettings(),
  ]);
  const orgName = activeOrg?.name || null;
  const role: string = activeOrg?.role ?? "";

  if (!session) {
    redirect("/login");
  }

  // Clients (members) should use the portal, not the dashboard
  if (role === "member") {
    redirect("/portal");
  }

  // Redirect owners to setup wizard if setup is not completed
  let telemetryEnabled: boolean | null = null;
  let timezoneMissing: boolean = false;
  const isHostedDeployment = process.env.NEXT_PUBLIC_SENTRY_ENABLED === "true";
  if (role === "owner") {
    if (setupStatus && !setupStatus.completed) {
      redirect("/setup");
    }
    telemetryEnabled = isHostedDeployment ? true : (settings?.telemetryEnabled ?? null);
    timezoneMissing = settings !== null && !settings.timezone;
  }

  const logoSrc: string | null = buildLogoSrc(branding, process.env.NEXT_PUBLIC_API_URL || "");

  return (
    <SessionProvider
      userId={session.user?.id ?? ""}
      userName={session.user?.name ?? ""}
      role={role}
      orgId={activeOrg?.id ?? ""}
    >
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
      <aside className="hidden md:flex w-64 border-r border-[var(--border)] p-4 flex-col sticky top-0 h-screen overflow-y-auto">
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
          <ThemeToggle />
        </header>

        {/* pt-[4.5rem] on mobile = h-14 navbar (3.5rem) + 1rem spacing */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-md:pt-[4.5rem] md:pt-4">
          {!session.user?.emailVerified && (
            <EmailVerificationBanner email={session.user?.email} />
          )}
          {role === "owner" && <TrialBanner />}
          {timezoneMissing && <TimezoneSync />}
          {role === "owner" && telemetryEnabled === null && (
            <TelemetryConsentBanner />
          )}
          {children}
        </main>
      </div>
    </div>
    </SessionProvider>
  );
}
