"use client";

import { formatCurrency } from "@/lib/format";
import type { Revenue } from "./types";

const MIN_BAR_PERCENT = 6;

export function RevenueStrip({ revenue }: { revenue: Revenue }) {
  if (revenue.paidCents === 0) return null;

  const max = Math.max(...revenue.monthly.map((m) => m.paidCents));

  return (
    <div
      data-testid="revenue-strip"
      title="Paid invoices on this contact's projects"
      className="border border-[var(--border)] rounded-xl p-4 flex gap-6 items-center"
    >
      <div className="min-w-[9rem]">
        <p className="text-xs text-[var(--muted-foreground)]">Paid, all time</p>
        <p className="text-2xl font-semibold">{formatCurrency(revenue.paidCents)}</p>
        {revenue.outstandingCents > 0 && (
          <p className="text-xs text-[var(--muted-foreground)]">
            {formatCurrency(revenue.outstandingCents)} outstanding
          </p>
        )}
      </div>
      <div className="flex-1">
        <div className="flex items-end gap-1 h-16">
          {revenue.monthly.map((m) => {
            const percent =
              m.paidCents === 0 ? 0 : Math.max(MIN_BAR_PERCENT, (m.paidCents / max) * 100);
            return (
              <div key={m.month} className="flex-1 h-full flex items-end">
                <div
                  title={`${m.month}: ${formatCurrency(m.paidCents)}`}
                  className="w-full rounded-sm bg-[var(--primary)] opacity-70"
                  style={{ height: `${percent}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-1 mt-1">
          {revenue.monthly.map((m) => (
            <span
              key={m.month}
              className="flex-1 text-center text-[10px] text-[var(--muted-foreground)]"
            >
              {monthInitial(m.month)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function monthInitial(month: string): string {
  const [year, mm] = month.split("-").map(Number);
  return new Date(year, mm - 1, 1).toLocaleDateString("en-US", { month: "narrow" });
}
