"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { deliverableStatus } from "@/lib/deliverable";

interface PendingApproval {
  id: string;
  title: string;
  status: string;
  version: number;
  sentAt: string | null;
  projectId: string;
  projectName: string;
  latestReason: string | null;
  decidedBy: string | null;
}

/** Deliverables waiting on a client, and ones the client sent back with changes. */
export function PendingApprovalsCard(): React.ReactElement | null {
  const [items, setItems] = useState<PendingApproval[] | null>(null);

  useEffect(() => {
    apiFetch<PendingApproval[]>("/documents/approvals/pending")
      .then(setItems)
      .catch((err: unknown) => {
        console.error("Failed to load pending approvals", err);
        setItems([]);
      });
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <section data-testid="pending-approvals-card" className="p-4 border border-[var(--border)] rounded-lg space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={16} className="text-[var(--primary)]" />
        <h2 className="text-lg font-semibold">Awaiting client review</h2>
      </div>
      <ul className="space-y-2">
        {items.map((item) => {
          const s = deliverableStatus(item.status);
          return (
            <li key={item.id}>
              <Link href={`/dashboard/projects/${item.projectId}?tab=files`} className="flex items-center justify-between gap-3 p-2 rounded-md hover:bg-[var(--muted)]">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{item.title}{item.version > 1 ? ` · v${item.version}` : ""}</p>
                  <p className="text-xs text-[var(--muted-foreground)] truncate">
                    {item.projectName}
                    {item.status === "declined" && item.latestReason ? ` · ${item.decidedBy ?? "Client"}: “${item.latestReason}”` : ""}
                    {item.status === "pending" && item.sentAt ? ` · sent ${formatRelativeTime(item.sentAt)}` : ""}
                  </p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
