"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { setDemoAnalytics } from "./track";
import { setDemoTracking } from "./demo-tracking";

export interface SessionValue {
  userId: string;
  userName: string;
  role: string;
  orgId: string;
  /** Served on an agency's custom portal domain, where passkeys can't be used. */
  onCustomDomain?: boolean;
  /** This is the public demo workspace: show the banner, disable what the demo refuses. */
  isDemo?: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Seeded by the dashboard and portal layouts, so pages don't re-fetch the session or role. */
export function SessionProvider({
  userId,
  userName,
  role,
  orgId,
  onCustomDomain = false,
  isDemo = false,
  children,
}: SessionValue & { children: ReactNode }) {
  // Told to the analytics module as soon as the tree renders, before any page
  // can fire an event. The demo permits creating a project, and
  // `project_created` is a Google Ads conversion — so without this a demo
  // visitor would be counted as one, spending real ad budget against the
  // number the demo exists to improve.
  setDemoAnalytics(isDemo === true);
  setDemoTracking(isDemo === true);

  const value = useMemo<SessionValue>(
    () => ({ userId, userName, role, orgId, onCustomDomain, isDemo }),
    [userId, userName, role, orgId, onCustomDomain, isDemo],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside a SessionProvider");
  return value;
}
