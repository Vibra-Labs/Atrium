"use client";

// Cost, profit and margin on a potential contract. Stays editable after a win.
// One typed total by default (a subcontractor quote, say). The breakdown is optional and,
// once used, adds the total up for you.

import { useEffect, useRef, useState } from "react";
import { Info, Plus, X } from "lucide-react";
import { Tooltip } from "@/components/tooltip";
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

/** Shared with pursuit-ui. */
export const input =
  "w-full h-10 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] disabled:opacity-60";
export const label = "block text-xs text-[var(--muted-foreground)] mb-1";
/** A fixed number shown where an input would be, so the two line up. */
export const readValue = "h-10 flex items-center text-sm font-medium tabular-nums";
/** Breakdown rows: name, amount, remove. */
const row = "grid grid-cols-[minmax(0,1fr)_6.5rem_1.25rem] items-center gap-2";

/** Costs most contracts have. "Create my own" lets you type a name. */
const COMMON_COSTS: string[] = ["Labor", "Materials", "Subcontractor", "Equipment", "Permits & fees", "Travel"];
const OTHER = "__other";

/** 2500000 -> "25,000"; 506750 -> "5,067.50". */
function centsText(cents: number | null): string {
  if (cents === null) return "";
  return withCommas(cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
}

/** A money input with the currency symbol inside it, so "45" reads as $45. */
export function CurrencyInput({
  small = false,
  className = input,
  ...props
}: React.ComponentProps<"input"> & { small?: boolean }) {
  const config = useAppConfig();
  const symbol: string = formatCurrency(0, config?.currency).replace(/[\d.,\s]/g, "");
  const pad: string = symbol.length > 1 ? "pl-9" : small ? "pl-4" : "pl-6";
  return (
    <span className="relative block">
      <span
        aria-hidden
        className={`absolute top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none ${small ? "left-1.5 text-xs" : "left-3 text-sm"}`}
      >
        {symbol}
      </span>
      <input inputMode="decimal" {...props} className={`${className} ${pad}`} />
    </span>
  );
}

/** Money field that saves when you leave it, and only if it changed. */
function MoneyField({
  ariaLabel,
  cents,
  onSave,
  placeholder = "0",
  small = false,
  className = input,
}: {
  ariaLabel: string;
  cents: number | null;
  onSave: (cents: number | null) => Promise<boolean>;
  placeholder?: string;
  small?: boolean;
  className?: string;
}) {
  const [text, setText] = useState<string>(centsText(cents));
  useEffect(() => setText(centsText(cents)), [cents]);
  return (
    <CurrencyInput
      aria-label={ariaLabel}
      small={small}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(withCommas(e.target.value))}
      onBlur={async () => {
        const next: number | null = toCents(text);
        if (next === cents) return;
        if (!(await onSave(next))) setText(centsText(cents));
      }}
      className={className}
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
  /** The Value field (an input, or the fixed value), shown beside Cost. */
  valueField: React.ReactNode;
  onSaved: () => void;
}) {
  const config = useAppConfig();
  const money = (cents: number): string => formatCurrency(cents, config?.currency);
  const { error: showError } = useToast();
  const [costs, setCosts] = useState<ContractCosts | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [adding, setAdding] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [newAmount, setNewAmount] = useState<string>("");
  /** Typing a name of your own instead of picking a common one. */
  const [customName, setCustomName] = useState<boolean>(false);
  const amountRef = useRef<HTMLInputElement>(null);
  /** Stops a quick second Enter from adding the same line twice. */
  const saving = useRef<boolean>(false);

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
  const detailed: boolean = !!summary?.detailed;

  async function add(): Promise<void> {
    if (!newName.trim() || saving.current) return;
    saving.current = true;
    const amountCents: number = toCents(newAmount) ?? 0;
    const ok: boolean = await run(() => addCostLine(projectId, { label: newName.trim(), amountCents }));
    saving.current = false;
    if (ok) closeAdd();
  }

  function closeAdd(): void {
    setNewName("");
    setNewAmount("");
    setCustomName(false);
    setAdding(false);
  }

  function pickName(value: string): void {
    if (value === OTHER) {
      setCustomName(true);
      setNewName("");
      return;
    }
    setNewName(value);
    amountRef.current?.focus();
  }

  function onAddKey(e: React.KeyboardEvent<HTMLElement>): void {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) void add();
    if (e.key === "Escape") closeAdd();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {valueField}
        <div>
          <p className={label}>Cost{detailed && " (from breakdown)"}</p>
          {editable && costs && !detailed ? (
            <MoneyField
              ariaLabel="Cost"
              cents={costs.costCents}
              onSave={(costCents) => run(() => updateCosts(projectId, { costCents }))}
            />
          ) : (
            <p data-testid="cost-total" className={readValue}>
              {summary?.costCents != null ? money(summary.costCents) : "—"}
            </p>
          )}
        </div>
      </div>

      {summary && summary.profitCents !== null && summary.marginPct !== null && (
        <p
          data-testid="profit-line"
          className={`text-sm font-medium tabular-nums ${summary.profitCents < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}
        >
          Profit {money(summary.profitCents)} · {summary.marginPct}% margin
        </p>
      )}

      {costs && (editable || detailed) && (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="text-sm">
          <summary className="cursor-pointer text-xs text-[var(--muted-foreground)]">Break down cost</summary>
          <div className="mt-2 rounded-lg border border-[var(--border)] p-3 space-y-2">
            {!detailed && (
              <p className="text-xs text-[var(--muted-foreground)]">
                List what goes into the cost and the total is added up for you.
              </p>
            )}

            {/* Older contracts may have a cost per hour; show it so the total still adds up. Clearing it removes the row. */}
            {costs.laborRateCents !== null && (
              <div data-testid="tracked-time-row" className={row}>
                <div className="min-w-0">
                  <p className="flex items-center gap-1">
                    Tracked time
                    <Tooltip
                      wrap
                      label="Hours your team logged on this project, times what an hour of work costs you (not what you bill). If you add labor as its own cost below, leave this blank so it isn't counted twice."
                    >
                      <button
                        type="button"
                        aria-label="About tracked time"
                        className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      >
                        <Info size={13} />
                      </button>
                    </Tooltip>
                  </p>
                  <div className="text-xs text-[var(--muted-foreground)] flex items-center gap-1 whitespace-nowrap">
                    {hours}h ×
                    {editable ? (
                      <MoneyField
                        ariaLabel="Cost per hour"
                        cents={costs.laborRateCents}
                        small
                        onSave={(laborRateCents) => run(() => updateCosts(projectId, { laborRateCents }))}
                        className="w-16 h-7 px-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-xs outline-none focus:border-[var(--primary)]"
                      />
                    ) : (
                      <span>{money(costs.laborRateCents)}</span>
                    )}
                    /hr
                  </div>
                </div>
                <span className="text-right tabular-nums">{money(summary?.laborCents ?? 0)}</span>
                <span />
              </div>
            )}

            {costs.lines.map((l) =>
              editable ? (
                <div key={l.id} className={row}>
                  <input
                    aria-label="Cost name"
                    defaultValue={l.label}
                    onBlur={async (e) => {
                      const field: HTMLInputElement = e.target;
                      const next: string = field.value.trim();
                      if (next === l.label) return;
                      if (!next || !(await run(() => updateCostLine(projectId, l.id, { label: next })))) {
                        field.value = l.label;
                      }
                    }}
                    className={input}
                  />
                  <MoneyField
                    ariaLabel="Cost amount"
                    cents={l.amountCents}
                    onSave={(amountCents) =>
                      run(() => updateCostLine(projectId, l.id, { amountCents: amountCents ?? 0 }))
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${l.label}`}
                    onClick={() => void run(() => removeCostLine(projectId, l.id))}
                    className="flex justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div key={l.id} className={row}>
                  <span className="truncate">{l.label}</span>
                  <span className="text-right tabular-nums">{money(l.amountCents)}</span>
                  <span />
                </div>
              ),
            )}

            {editable &&
              (adding ? (
                <div
                  className={row}
                  onBlur={(e) => {
                    // Leaving an empty add row closes it.
                    if (!e.currentTarget.contains(e.relatedTarget) && !newName.trim() && !newAmount) closeAdd();
                  }}
                >
                  {customName ? (
                    <input
                      aria-label="New cost name"
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={onAddKey}
                      placeholder="Name it"
                      maxLength={100}
                      className={input}
                    />
                  ) : (
                    <select
                      aria-label="New cost name"
                      autoFocus
                      value={newName}
                      onChange={(e) => pickName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && closeAdd()}
                      className={input}
                    >
                      <option value="" disabled>
                        Pick a cost
                      </option>
                      {COMMON_COSTS.filter((name) => !costs.lines.some((l) => l.label === name)).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                      <option value={OTHER}>Create my own…</option>
                    </select>
                  )}
                  <CurrencyInput
                    ref={amountRef}
                    aria-label="New cost amount"
                    value={newAmount}
                    onChange={(e) => setNewAmount(withCommas(e.target.value))}
                    onKeyDown={onAddKey}
                    placeholder="0"
                    className={input}
                  />
                  <button
                    type="button"
                    aria-label="Add cost"
                    onClick={() => void add()}
                    disabled={!newName.trim()}
                    className="flex justify-center text-[var(--primary)] disabled:opacity-40"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="py-1 text-xs text-[var(--primary)] hover:underline"
                >
                  + Add a cost
                </button>
              ))}

            <div className="flex justify-between border-t border-[var(--border)] pt-2 font-medium">
              <span>Total cost</span>
              <span data-testid="breakdown-total" className="tabular-nums">
                {money(detailed ? (summary?.costCents ?? 0) : 0)}
              </span>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
