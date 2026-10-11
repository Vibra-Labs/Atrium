"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";

interface WeeklyUpdateDue {
  projectId: string;
  projectName: string;
  lastUpdateAt: string | null;
  clientCount: number;
}

/** Client projects that haven't had an update in a week, with a one-click drafted update. */
export function WeeklyUpdatesCard(): React.ReactElement | null {
  const [due, setDue] = useState<WeeklyUpdateDue[] | null>(null);

  useEffect(() => {
    apiFetch<WeeklyUpdateDue[]>("/updates/weekly-due")
      .then(setDue)
      .catch((err: unknown) => {
        console.error("Failed to load weekly updates", err);
        setDue([]);
      });
  }, []);

  if (!due || due.length === 0) return null;

  return (
    <section data-testid="weekly-updates-card" className="p-4 border border-[var(--border)] rounded-lg space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={16} className="text-[var(--primary)]" />
        <h2 className="text-lg font-semibold">Weekly updates</h2>
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">
        These clients haven&apos;t heard from you in a week. Atrium drafts the update from what you finished.
      </p>
      <ul className="space-y-2">
        {due.map((p) => (
          <li key={p.projectId} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{p.projectName}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {p.lastUpdateAt ? `Last update ${formatRelativeTime(p.lastUpdateAt)}` : "No updates yet"}
                {" · "}
                {p.clientCount} {p.clientCount === 1 ? "client" : "clients"}
              </p>
            </div>
            <Link
              href={`/dashboard/projects/${p.projectId}?tab=updates&compose=weekly`}
              className="shrink-0 px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
            >
              Draft update
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
