"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Section {
  href: string;
  label: string;
}

const SECTIONS: Section[] = [
  { href: "/dashboard/settings/workspace", label: "General" },
  { href: "/dashboard/settings/branding", label: "Branding" },
  { href: "/dashboard/settings/team", label: "Team" },
  { href: "/dashboard/settings/billing", label: "Billing & Payments" },
  { href: "/dashboard/settings/integrations", label: "Integrations" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const isPersonalAccount = pathname === "/dashboard/settings/account";

  // When visiting personal profile from avatar, show Account tab so they know where they are
  const sections = isPersonalAccount
    ? [...SECTIONS, { href: "/dashboard/settings/account", label: "Account" }]
    : SECTIONS;

  return (
    <div className="space-y-6">
      {/* Scrolls sideways on a phone instead of pushing the page wider. */}
      <nav aria-label="Settings" className="flex gap-1 border-b border-[var(--border)] overflow-x-auto">
        {sections.map((s) => {
          const isActive = pathname === s.href;
          return (
            <Link
              key={s.href}
              href={s.href}
              aria-current={isActive ? "page" : undefined}
              ref={isActive ? (el) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors relative ${
                isActive
                  ? "text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {s.label}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)]" />
              )}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
