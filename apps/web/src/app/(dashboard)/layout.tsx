import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignOutButton } from "./sign-out-button";
import { SidebarNav } from "./sidebar-nav";
import { EmailVerificationBanner } from "./email-verification-banner";

const API_URL = process.env.API_URL || "http://localhost:3001";

async function getSessionWithRole() {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();

    const res = await fetch(`${API_URL}/api/auth/get-session`, {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const session = await res.json();
    if (!session) return null;

    // Get the user's role in the active org
    const memberRes = await fetch(
      `${API_URL}/api/auth/organization/get-active-member`,
      {
        headers: { Cookie: cookieHeader },
        cache: "no-store",
      },
    );
    if (!memberRes.ok) return { ...session, role: null };
    const member = await memberRes.json();
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
  if (branding.logoKey) return `${API_URL}/api/branding/logo/${branding.organizationId}`;
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
  if (session.role === "owner") {
    const setupStatus = await getSetupStatus();
    if (setupStatus && !setupStatus.completed) {
      redirect("/setup");
    }
  }

  const logoSrc = getLogoSrc(branding);

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 border-r border-[var(--border)] p-4 flex flex-col">
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
        </div>
        <SidebarNav />
        <SignOutButton />
      </aside>
      <main className="flex-1 p-8">
        {!session.user?.emailVerified && (
          <EmailVerificationBanner email={session.user?.email} />
        )}
        {children}
      </main>
    </div>
  );
}
