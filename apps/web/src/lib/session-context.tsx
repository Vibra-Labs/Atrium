"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface SessionValue {
  userId: string;
  userName: string;
  role: string;
  orgId: string;
  /** Served on an agency's custom portal domain, where passkeys can't be used. */
  onCustomDomain?: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Seeded by the dashboard and portal layouts, so pages don't re-fetch the session or role. */
export function SessionProvider({
  userId,
  userName,
  role,
  orgId,
  onCustomDomain = false,
  children,
}: SessionValue & { children: ReactNode }) {
  const value = useMemo<SessionValue>(
    () => ({ userId, userName, role, orgId, onCustomDomain }),
    [userId, userName, role, orgId, onCustomDomain],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside a SessionProvider");
  return value;
}
