"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { SidebarNav } from "./sidebar-nav";
import { SignOutButton } from "./sign-out-button";
import { NotificationBell } from "@/components/notification-bell";
import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { OrgSwitcher, type SwitchableOrg } from "@/components/org-switcher";

interface MobileNavProps {
  logoSrc: string | null;
  orgName: string | null;
  hideLogo?: boolean;
  orgs: SwitchableOrg[];
  activeOrgId: string | null;
}

export function MobileNav({
  logoSrc,
  orgName,
  hideLogo,
  orgs,
  activeOrgId,
}: MobileNavProps) {
  const { userName, role } = useSession();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      {/* Top bar */}
      <div className="fixed top-0 left-0 right-0 z-40 h-14 border-b border-[var(--border)] bg-[var(--background)] flex items-center px-4 gap-3">
        <button
          onClick={() => setOpen(true)}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-[var(--muted)]"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        {!hideLogo && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoSrc || "/icon-64.png"}
            alt=""
            className="h-6 w-6 object-contain shrink-0"
          />
        )}
        <span className="font-bold text-sm truncate">
          {orgName || "Atrium"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <GlobalSearch iconOnly />
          <NotificationBell align="left" />
          <ThemeToggle />
        </div>
      </div>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-[var(--background)] border-r border-[var(--border)] p-4 flex flex-col transform transition-transform duration-200 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-6">
          <OrgSwitcher
            orgs={orgs}
            activeOrgId={activeOrgId}
            orgName={orgName}
            logoSrc={logoSrc}
            hideLogo={hideLogo}
          />
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-[var(--muted)]"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <SidebarNav onNavigate={() => setOpen(false)} />
        <div className="mt-auto pt-4 border-t border-[var(--border)] space-y-1">
          <Link
            href="/dashboard/settings/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-[var(--muted)] transition-colors group"
          >
            <div className="w-8 h-8 rounded-full bg-[var(--muted)] text-[var(--foreground)] border border-[var(--border)] flex items-center justify-center font-semibold text-xs shrink-0">
              {(userName || "U")
                .split(" ")
                .map((n: string) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-xs font-semibold text-[var(--foreground)] truncate group-hover:text-[var(--primary)] transition-colors">
                {userName || "My Account"}
              </p>
              <p className="text-[11px] text-[var(--muted-foreground)] capitalize truncate">
                {role || "Member"}
              </p>
            </div>
          </Link>
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
