"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface ReportTab {
  href: string;
  label: string;
}

// Add new reports here. The tab strip shows automatically once there are 2+.
const REPORTS: ReportTab[] = [
  { href: "/dashboard/reports/time", label: "Time" },
];

export default function ReportsLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reports</h1>
      {REPORTS.length > 1 && (
        <div className="flex gap-1 border-b border-[var(--border)]">
          {REPORTS.map((r) => {
            const isActive = pathname === r.href;
            return (
              <Link
                key={r.href}
                href={r.href}
                className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                  isActive
                    ? "text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {r.label}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)]" />
                )}
              </Link>
            );
          })}
        </div>
      )}
      {children}
    </div>
  );
}
