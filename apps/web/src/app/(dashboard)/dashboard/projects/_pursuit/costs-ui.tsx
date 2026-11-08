"use client";

// Cost, profit and margin on a potential contract. Stays editable after a win.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAppConfig } from "@/lib/app-config";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/components/toast";
import {
  addCostLine,
  costSummary,
  getCosts,
  removeCostLine,
  toCents,
  updateCostLine,
  updateCosts,
  withCommas,
} from "@/lib/pursuit";
import type { ContractCosts, CostSummary } from "@/lib/pursuit";

const input =
  "w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] disabled:opacity-60 read-only:bg-[var(--muted)]";
const label = "block text-xs text-[var(--muted-foreground)] mb-1";

/** 2500000 -> "25,000"; 506750 -> "5,067.50". */
function centsText(cents: number | null): string {
  if (cents === null) return "";
  return withCommas(cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
}

/** Money field that saves when you leave it, and only if it changed. */
function MoneyField({
  ariaLabel,
  cents,
  onSave,
  disabled,
  readOnly,
  placeholder,
}: {
  ariaLabel: string;
  cents: number | null;
  onSave?: (cents: number | null) => Promise<boolean>;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState<string>(centsText(cents));
  useEffect(() => setText(centsText(cents)), [cents]);
  return (
    <input
      aria-label={ariaLabel}
      inputMode="decimal"
      value={text}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      onChange={(e) => setText(withCommas(e.target.value))}
      onBlur={async () => {
        if (readOnly || !onSave) return;
        const next: number | null = toCents(text);
        if (next === cents) return;
        if (!(await onSave(next))) setText(centsText(cents));
      }}
      className={input}
    />
  );
}

export function CostSection({
  projectId,
  valueCents,
  editable,
  valueField,
  onSaved,
}: {
  projectId: string;
  valueCents: number | null;
  /** Open or won, and not archived. */
  editable: boolean;
  /** The Value field, shown beside Cost. */
  valueField: React.ReactNode;
  onSaved: () => void;
}) {
  const config = useAppConfig();
  const money = (cents: number): string => formatCurrency(cents, config?.currency);
  const { error: showError } = useToast();
  const [costs, setCosts] = useState<ContractCosts | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [newAmount, setNewAmount] = useState<string>("");

  useEffect(() => {
    getCosts(projectId)
      .then((c) => {
        setCosts(c);
        setOpen(c.summary.detailed);
      })
      .catch((err: unknown) => console.error("Failed to load costs", err));
  }, [projectId]);

  /** Returns false when the save was rejected, so a field can go back to the saved value. */
  async function run(action: () => Promise<ContractCosts>): Promise<boolean> {
    try {
      setCosts(await action());
      onSaved();
      return true;
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to save the cost");
      return false;
    }
  }

  // Worked out here so a new Value shows up in the profit line straight away.
  const summary: CostSummary | null = costs
    ? costSummary({
        valueCents,
        costCents: costs.costCents,
        laborRateCents: costs.laborRateCents,
        trackedSeconds: costs.trackedSeconds,
        lineCents: costs.lines.map((l) => l.amountCents),
      })
    : null;
  const hours: number = costs ? Number((costs.trackedSeconds / 3600).toFixed(1)) : 0;

  async function add(): Promise<void> {
    const amountCents: number = toCents(newAmount) ?? 0;
    if (await run(() => addCostLine(projectId, { label: newName.trim(), amountCents }))) {
      setNewName("");
      setNewAmount("");
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {valueField}
        <div>
          <label className={label}>
            Cost
            {summary?.detailed && (
              <span data-testid="cost-from-details" className="ml-1 italic">
                from details
              </span>
            )}
          </label>
          <MoneyField
            ariaLabel="Cost"
            cents={summary?.costCents ?? null}
            disabled={!editable || !costs}
            readOnly={summary?.detailed}
            placeholder={editable ? money(0) : "—"}
            onSave={(costCents) => run(() => updateCosts(projectId, { costCents }))}
          />
        </div>
      </div>

      {summary && summary.profitCents !== null && summary.marginPct !== null && (
        <p
          data-testid="profit-line"
          className={`text-sm font-medium ${summary.profitCents < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}
        >
          Profit {money(summary.profitCents)} · Margin {summary.marginPct}%
        </p>
      )}

      {costs && (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="text-sm">
          <summary className="cursor-pointer text-xs text-[var(--muted-foreground)]">Cost details</summary>
          <div className="mt-2 space-y-3">
            <div className="space-y-1">
              <p data-testid="labor-line" className="text-xs">
                Labor (tracked time) · {hours}h
                {costs.laborRateCents !== null &&
                  ` × ${money(costs.laborRateCents)} = ${money(summary?.laborCents ?? 0)}`}
              </p>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">Cost per hour</span>
                <MoneyField
                  ariaLabel="Cost per hour"
                  cents={costs.laborRateCents}
                  disabled={!editable}
                  placeholder={editable ? "What an hour costs you" : "—"}
                  onSave={(laborRateCents) => run(() => updateCosts(projectId, { laborRateCents }))}
                />
              </div>
            </div>

            {costs.lines.length > 0 && (
              <ul className="space-y-2">
                {costs.lines.map((l) => (
                  <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-2">
                    <input
                      aria-label="Cost name"
                      defaultValue={l.label}
                      disabled={!editable}
                      onBlur={(e) => {
                        const next: string = e.target.value.trim();
                        if (!next) {
                          e.target.value = l.label;
                          return;
                        }
                        if (next !== l.label) void run(() => updateCostLine(projectId, l.id, { label: next }));
                      }}
                      className={input}
                    />
                    <MoneyField
                      ariaLabel="Cost amount"
                      cents={l.amountCents}
                      disabled={!editable}
                      onSave={(amountCents) =>
                        run(() => updateCostLine(projectId, l.id, { amountCents: amountCents ?? 0 }))
                      }
                    />
                    {editable && (
                      <button
                        type="button"
                        aria-label={`Remove ${l.label}`}
                        onClick={() => void run(() => removeCostLine(projectId, l.id))}
                        className="shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* The card is narrow: name on its own line, then amount and the button. */}
            {editable && (
              <div className="space-y-2">
                <input
                  aria-label="New cost name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New cost (e.g. Materials, Permits)"
                  maxLength={100}
                  className={input}
                />
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <input
                    aria-label="New cost amount"
                    inputMode="decimal"
                    value={newAmount}
                    onChange={(e) => setNewAmount(withCommas(e.target.value))}
                    placeholder={money(0)}
                    className={input}
                  />
                  <button
                    type="button"
                    onClick={() => void add()}
                    disabled={!newName.trim()}
                    className="px-3 py-2 border border-[var(--border)] rounded-lg text-sm whitespace-nowrap hover:bg-[var(--muted)] disabled:opacity-40"
                  >
                    Add cost
                  </button>
                </div>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
