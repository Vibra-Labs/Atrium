"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Section {
  href: string;
  label: string;
}

const SECTIONS: Section[] = [
  { href: "/dashboard/settings/account", label: "Account" },
  { href: "/dashboard/settings/workspace", label: "Workspace" },
  { href: "/dashboard/settings/payments", label: "Payments" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-[var(--border)]">
        {SECTIONS.map((s) => {
          const isActive = pathname.startsWith(s.href);
          return (
            <Link
              key={s.href}
              href={s.href}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${
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
      </div>
      {children}
    </div>
  );
}
