import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEFAULT_BRANDING } from "@atrium/shared";

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

async function getBranding(): Promise<{
  primaryColor?: string;
  accentColor?: string;
} | null> {
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

export default async function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, branding] = await Promise.all([
    getSessionWithRole(),
    getBranding(),
  ]);

  if (!session) {
    redirect("/login");
  }

  // Only owners should see the setup wizard
  if (session.role !== "owner") {
    redirect("/dashboard");
  }

  return (
    <div
      className="min-h-screen"
      style={
        {
          "--primary": branding?.primaryColor || DEFAULT_BRANDING.primaryColor,
          "--accent": branding?.accentColor || DEFAULT_BRANDING.accentColor,
        } as React.CSSProperties
      }
    >
      <main className="max-w-4xl mx-auto p-8">{children}</main>
    </div>
  );
}
