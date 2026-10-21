import { Suspense } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import Link from "next/link";
import { SignOutButton } from "./sign-out-button";
import { getSession } from "@/lib/auth";
import { NotificationBell, NotificationProvider } from "@/components/notification-bell";
import { DynamicFavicon } from "@/components/dynamic-favicon";
import { PreviewModeProvider } from "@/lib/preview-mode";
import { PreviewBanner } from "@/components/preview-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { serverFetch } from "@/lib/server-api";
import { logoSrc as buildLogoSrc } from "@/lib/logo-src";
import { SessionProvider } from "@/lib/session-context";

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

async function getOrg(): Promise<{ id: string; name: string; role: string } | null> {
  try {
    const res: Response = await serverFetch("/api/organization/current");
    if (!res.ok) return null;
    const org: { id?: string; name?: string; role?: string } = await res.json();
    if (!org?.id) return null;
    return { id: org.id, name: org.name ?? "", role: org.role ?? "" };
  } catch (err) {
    // cookies() throws a control-flow signal during static render; let it through.
    unstable_rethrow(err);
    console.error("Failed to load organization", err);
    return null;
  }
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, branding, org] = await Promise.all([
    getSession(),
    getBranding(),
    getOrg(),
  ]);
  if (!session) {
    redirect("/login");
  }

  const orgName: string | null = org?.name || null;
  const logoSrc: string | null = buildLogoSrc(branding, process.env.NEXT_PUBLIC_API_URL || "");

  return (
    <Suspense fallback={null}>
      <SessionProvider
        userId={session.user?.id ?? ""}
        userName={session.user?.name ?? ""}
        role={org?.role ?? ""}
        orgId={org?.id ?? ""}
      >
      <NotificationProvider>
      <PreviewModeProvider>
        <div
          style={
            {
              "--primary": branding?.primaryColor || "#006b68",
            } as React.CSSProperties
          }
        >
          <DynamicFavicon href={logoSrc || "/icon.png"} />
          <PreviewBanner />
          <header className="border-b border-[var(--border)] px-4 sm:px-6 py-4 flex items-center gap-2 sm:gap-3">
            {!branding?.hideLogo && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logoSrc || "/icon.png"} alt="Logo" className="h-8 w-8 object-contain shrink-0" />
            )}
            <span className="font-semibold flex-1 min-w-0 truncate">{orgName || "Atrium"}</span>
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
            <NotificationBell />
            <ThemeToggle />
            <SignOutButton />
          </header>
          <main className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">{children}</main>
          {branding?.poweredBy && (
            <footer className="py-6 text-center">
              <a
                href="https://atrium.vibralabs.co?ref=portal"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                Powered by Atrium
              </a>
            </footer>
          )}
        </div>
      </PreviewModeProvider>
      </NotificationProvider>
      </SessionProvider>
    </Suspense>
  );
}
