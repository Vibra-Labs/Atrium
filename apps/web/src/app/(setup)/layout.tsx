import { redirect, unstable_rethrow } from "next/navigation";
import { DEFAULT_BRANDING } from "@atrium/shared";
import { serverFetch } from "@/lib/server-api";

async function getSessionWithRole() {
  try {
    const res: Response = await serverFetch("/api/auth/get-session");
    if (!res.ok) return null;
    const session = await res.json();
    if (!session) return null;

    const memberRes: Response = await serverFetch("/api/auth/organization/get-active-member");
    if (!memberRes.ok) return { ...session, role: null };
    const member = await memberRes.json();
    return { ...session, role: member?.role || null };
  } catch (err) {
    // cookies() throws a control-flow signal during static render; let it through.
    unstable_rethrow(err);
    console.error("Failed to load session", err);
    return null;
  }
}

async function getBranding(): Promise<{
  primaryColor?: string;
} | null> {
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
        } as React.CSSProperties
      }
    >
      <main className="max-w-4xl mx-auto p-8">{children}</main>
    </div>
  );
}
