import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignOutButton } from "./sign-out-button";
import { SidebarNav } from "./sidebar-nav";
import { EmailVerificationBanner } from "./email-verification-banner";

async function getSessionWithRole() {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();
    const apiUrl = process.env.API_URL || "http://localhost:3001";

    const res = await fetch(`${apiUrl}/api/auth/get-session`, {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const session = await res.json();
    if (!session) return null;

    // Get the user's role in the active org
    const memberRes = await fetch(
      `${apiUrl}/api/auth/organization/get-active-member`,
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

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionWithRole();

  if (!session) {
    redirect("/login");
  }

  // Clients (members) should use the portal, not the dashboard
  if (session.role === "member") {
    redirect("/portal");
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 border-r border-[var(--border)] p-4 flex flex-col">
        <div className="font-bold text-lg mb-6">Atrium</div>
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
