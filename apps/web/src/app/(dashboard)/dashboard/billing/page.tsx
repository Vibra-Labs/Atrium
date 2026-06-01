"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CreditCard, FileUp, Loader2, ReceiptText, X } from "lucide-react";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { apiFetch, fetchAllPages } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { formatHours } from "@/lib/format-duration";

interface BillingClient {
  id: string;
  name: string;
  slug: string;
  defaultHourlyRateCents: number | null;
  billingPeriod: string | null;
  archivedAt: string | null;
}

interface TimeReportRow {
  projectId: string;
  projectName: string;
  seconds: number;
  billableSeconds: number;
  valueCents: number;
}

interface TimeReport {
  totals: { seconds: number; billableSeconds: number; valueCents: number };
  byProject: TimeReportRow[];
  byUser: {
    userId: string;
    name: string;
    seconds: number;
    billableSeconds: number;
    valueCents: number;
  }[];
  byTask: {
    taskId: string;
    taskTitle: string;
    projectId: string;
    projectName: string;
    seconds: number;
    billableSeconds: number;
    valueCents: number;
  }[];
}

interface BillingClientsResponse {
  data: BillingClient[];
}

interface GenerateInvoiceResponse {
  invoiceId: string;
}

interface RecordedInvoiceResponse {
  invoiceNumber: string;
  externalReference?: string | null;
}

interface TimeEntryListItem {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  description: string | null;
  billable: boolean;
  hourlyRateCents?: number | null;
  invoiceLineItemId: string | null;
  project: { id: string; name: string };
  task: { id: string; title: string } | null;
  user: { id: string; name: string; email: string };
}

interface TimeEntryListResponse {
  data: TimeEntryListItem[];
  meta?: { total: number; page: number; limit: number; totalPages: number };
}

interface ProjectBillingRow {
  projectId: string;
  projectName: string;
  seconds: number;
  notInvoicedValueCents: number;
  invoicedValueCents: number;
}

const EMPTY_REPORT: TimeReport = {
  totals: { seconds: 0, billableSeconds: 0, valueCents: 0 },
  byProject: [],
  byUser: [],
  byTask: [],
};

function formatHourLabel(seconds: number): string {
  return `${formatHours(seconds)} h`;
}

function normalizeBillingClients(
  response: BillingClientsResponse | BillingClient[],
): BillingClient[] {
  const clients = Array.isArray(response) ? response : response.data;
  return clients.filter((client) => client.archivedAt === null);
}

function buildReportPath(
  billingClientId: string,
  invoiced: boolean,
  from?: string,
  to?: string,
): string {
  const params = new URLSearchParams({
    billingClientId,
    invoiced: invoiced ? "true" : "false",
  });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return `/time-entries/report?${params.toString()}`;
}

function buildUnbilledEntryPath(
  billingClientId: string,
  from: string,
  to: string,
): string {
  const params = new URLSearchParams({
    billingClientId,
    invoiced: "false",
    billable: "true",
    from,
    to,
    limit: "200",
  });
  return `/time-entries?${params.toString()}`;
}

function computeEntryValueCents(entry: TimeEntryListItem): number {
  if (!entry.billable || entry.durationSec == null || entry.hourlyRateCents == null) {
    return 0;
  }
  return Math.round((entry.durationSec / 3600) * entry.hourlyRateCents);
}

function formatEntryDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function centsToCurrencyInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function parseCurrencyToCents(value: string): number {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) return 0;
  const match = normalized.match(/^(\d+)(?:\.(\d{0,2})?)?$/);
  if (!match) return Number.NaN;
  const dollars = Number.parseInt(match[1] ?? "0", 10);
  const cents = Number.parseInt((match[2] ?? "").padEnd(2, "0"), 10) || 0;
  return dollars * 100 + cents;
}

function mergeProjectRows(
  notInvoiced: TimeReport,
  invoiced: TimeReport,
): ProjectBillingRow[] {
  const rows = new Map<string, ProjectBillingRow>();

  for (const row of notInvoiced.byProject) {
    rows.set(row.projectId, {
      projectId: row.projectId,
      projectName: row.projectName,
      seconds: row.seconds,
      notInvoicedValueCents: row.valueCents,
      invoicedValueCents: 0,
    });
  }

  for (const row of invoiced.byProject) {
    const existing = rows.get(row.projectId);
    if (existing) {
      existing.seconds += row.seconds;
      existing.invoicedValueCents = row.valueCents;
    } else {
      rows.set(row.projectId, {
        projectId: row.projectId,
        projectName: row.projectName,
        seconds: row.seconds,
        notInvoicedValueCents: 0,
        invoicedValueCents: row.valueCents,
      });
    }
  }

  return Array.from(rows.values()).sort((a, b) => {
    if (b.notInvoicedValueCents !== a.notInvoicedValueCents) {
      return b.notInvoicedValueCents - a.notInvoicedValueCents;
    }
    return b.invoicedValueCents - a.invoicedValueCents;
  });
}

function SummaryCard({
  label,
  valueCents,
  seconds,
  emphasis = false,
}: {
  label: string;
  valueCents: number;
  seconds: number;
  emphasis?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        emphasis
          ? "border-emerald-300 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/20"
          : "border-[var(--border)] bg-[var(--background)]"
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </div>
      <div
        className={`mt-2 text-2xl font-semibold ${
          emphasis ? "text-emerald-700 dark:text-emerald-300" : ""
        }`}
      >
        {formatCurrency(valueCents)}
      </div>
      <div className="mt-1 text-sm text-[var(--muted-foreground)]">
        {formatHourLabel(seconds)}
      </div>
    </div>
  );
}


function RecordExternalInvoiceModal({
  client,
  from,
  to,
  notInvoicedReport,
  onClose,
  onRecorded,
}: {
  client: BillingClient;
  from: string;
  to: string;
  notInvoicedReport: TimeReport;
  onClose: () => void;
  onRecorded: () => Promise<void>;
}): React.ReactElement {
  const { success } = useToast();
  const [entries, setEntries] = useState<TimeEntryListItem[]>([]);
  const [entryMeta, setEntryMeta] = useState<TimeEntryListResponse["meta"]>(undefined);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [modalReport, setModalReport] = useState<TimeReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [externalReference, setExternalReference] = useState<string>("");
  const [amountInput, setAmountInput] = useState<string>("0.00");
  const [amountTouched, setAmountTouched] = useState<boolean>(false);
  const [dueDate, setDueDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedIds.has(entry.id)),
    [entries, selectedIds],
  );

  const selectedTotals = useMemo(
    () => selectedEntries.reduce(
      (acc, entry) => {
        const seconds = entry.durationSec ?? 0;
        acc.seconds += seconds;
        acc.valueCents += computeEntryValueCents(entry);
        return acc;
      },
      { seconds: 0, valueCents: 0 },
    ),
    [selectedEntries],
  );

  const activeReport = modalReport ?? notInvoicedReport;
  const reportSeconds = activeReport.totals.billableSeconds;
  const reportValueCents = activeReport.totals.valueCents;
  const reconciled =
    selectedTotals.seconds === reportSeconds &&
    selectedTotals.valueCents === reportValueCents;
  const missingRateCount = entries.filter(
    (entry) => entry.billable && entry.hourlyRateCents == null,
  ).length;
  const truncated = entryMeta ? entryMeta.total > entries.length : false;
  const amountCents = parseCurrencyToCents(amountInput);
  const amountInvalid = !Number.isFinite(amountCents) || amountCents < 1;
  const submitDisabled =
    loading ||
    submitting ||
    selectedIds.size === 0 ||
    !externalReference.trim() ||
    amountInvalid;

  const loadEntries = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    setSubmitError(null);
    try {
      const [entryResponse, reportResponse] = await Promise.all([
        apiFetch<TimeEntryListResponse>(buildUnbilledEntryPath(client.id, from, to)),
        apiFetch<TimeReport>(buildReportPath(client.id, false, from, to)),
      ]);
      const nextEntries = entryResponse.data;
      setEntries(nextEntries);
      setEntryMeta(entryResponse.meta);
      setModalReport(reportResponse);
      setSelectedIds(new Set(nextEntries.map((entry) => entry.id)));
      setAmountTouched(false);
      setAmountInput(
        centsToCurrencyInput(
          nextEntries.reduce((sum, entry) => sum + computeEntryValueCents(entry), 0),
        ),
      );
    } catch (err) {
      console.error(err);
      setLoadError(err instanceof Error ? err.message : "Failed to load unbilled time entries");
      setEntries([]);
      setEntryMeta(undefined);
      setModalReport(null);
      setSelectedIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [client.id, from, to]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!amountTouched) {
      setAmountInput(centsToCurrencyInput(selectedTotals.valueCents));
    }
  }, [amountTouched, selectedTotals.valueCents]);

  function toggleEntry(entryId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (submitDisabled) return;
    setSubmitting(true);
    setSubmitError(null);
    const timeEntryIds = Array.from(selectedIds);
    const trimmedReference = externalReference.trim();
    const trimmedNotes = notes.trim();

    try {
      let recorded: RecordedInvoiceResponse;
      if (file) {
        const form = new FormData();
        form.append("billingClientId", client.id);
        form.append("externalReference", trimmedReference);
        form.append("amount", String(amountCents));
        form.append("timeEntryIds", JSON.stringify(timeEntryIds));
        if (dueDate) form.append("dueDate", dueDate);
        if (trimmedNotes) form.append("notes", trimmedNotes);
        form.append("file", file);
        recorded = await apiFetch<RecordedInvoiceResponse>("/invoices/record/upload", {
          method: "POST",
          body: form,
        });
      } else {
        recorded = await apiFetch<RecordedInvoiceResponse>("/invoices/record", {
          method: "POST",
          body: JSON.stringify({
            billingClientId: client.id,
            externalReference: trimmedReference,
            amount: amountCents,
            timeEntryIds,
            ...(dueDate ? { dueDate } : {}),
            ...(trimmedNotes ? { notes: trimmedNotes } : {}),
          }),
        });
      }

      success(`Recorded external invoice ${recorded.invoiceNumber}`);
      onClose();
      await onRecorded();
    } catch (err) {
      console.error(err);
      setSubmitError(err instanceof Error ? err.message : "Failed to record external invoice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <FileUp size={16} /> Record external invoice
            </div>
            <h2 className="mt-1 text-xl font-semibold">{client.name}</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Selecting billable, not-yet-invoiced time from {from} through {to}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            aria-label="Close record external invoice modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid max-h-[calc(90vh-8rem)] gap-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Unbilled time entries</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Default selection includes every returned billable entry.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set(entries.map((entry) => entry.id)))}
                  disabled={loading || entries.length === 0}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  disabled={loading || selectedIds.size === 0}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>

            {loadError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
                <div>{loadError}</div>
                <button
                  type="button"
                  onClick={loadEntries}
                  className="mt-2 rounded-md border border-current px-2 py-1 text-xs font-medium"
                >
                  Retry
                </button>
              </div>
            )}

            {truncated && entryMeta && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                Showing {entries.length} of {entryMeta.total} matching entries. Narrow the date
                range before recording so nothing is missed.
              </div>
            )}

            {missingRateCount > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                {missingRateCount} billable {missingRateCount === 1 ? "entry is" : "entries are"} missing
                a rate, so their computed value is $0.00.
              </div>
            )}

            {loading ? (
              <div className="rounded-xl border border-[var(--border)] p-8 text-center text-sm text-[var(--muted-foreground)]">
                <Loader2 className="mx-auto mb-3 animate-spin" size={20} />
                Loading selectable entries…
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted-foreground)]">
                No billable, not-yet-invoiced entries were returned for this client and date range.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                <div className="divide-y divide-[var(--border)]">
                  {entries.map((entry) => {
                    const entryValueCents = computeEntryValueCents(entry);
                    const checked = selectedIds.has(entry.id);
                    return (
                      <label
                        key={entry.id}
                        className="flex cursor-pointer items-start gap-3 p-3 text-sm hover:bg-[var(--muted)]/40"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEntry(entry.id)}
                          className="mt-1 h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-medium">{entry.task?.title ?? entry.description ?? "Untitled time entry"}</span>
                            <span className="text-xs text-[var(--muted-foreground)]">• {entry.project.name}</span>
                          </div>
                          {entry.task && entry.description && (
                            <div className="mt-0.5 line-clamp-2 text-xs text-[var(--muted-foreground)]">
                              {entry.description}
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
                            <span>{formatEntryDate(entry.startedAt)}</span>
                            <span>{formatHourLabel(entry.durationSec ?? 0)}</span>
                            <span>{entry.user.name || entry.user.email}</span>
                            {entry.hourlyRateCents == null ? (
                              <span>No rate</span>
                            ) : (
                              <span>{formatCurrency(entry.hourlyRateCents)}/hr</span>
                            )}
                          </div>
                        </div>
                        <div className="whitespace-nowrap text-right font-semibold">
                          {formatCurrency(entryValueCents)}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-4 border-t border-[var(--border)] bg-[var(--muted)]/20 p-5 lg:border-l lg:border-t-0">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
                <div className="text-xs font-medium text-[var(--muted-foreground)]">Selected</div>
                <div className="mt-1 text-lg font-semibold">{formatCurrency(selectedTotals.valueCents)}</div>
                <div className="text-xs text-[var(--muted-foreground)]">{formatHourLabel(selectedTotals.seconds)}</div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
                <div className="text-xs font-medium text-[var(--muted-foreground)]">Report</div>
                <div className="mt-1 text-lg font-semibold">{formatCurrency(reportValueCents)}</div>
                <div className="text-xs text-[var(--muted-foreground)]">{formatHourLabel(reportSeconds)}</div>
              </div>
            </div>

            {!reconciled && (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 shrink-0" size={16} />
                <span>
                  Selected entries do not match the not-invoiced report total for this client and date range.
                </span>
              </div>
            )}

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                External reference <span className="text-red-500">*</span>
              </span>
              <input
                type="text"
                value={externalReference}
                onChange={(e) => setExternalReference(e.target.value)}
                placeholder="Digits INV-1043"
                maxLength={200}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                Amount <span className="text-red-500">*</span>
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => {
                  setAmountTouched(true);
                  setAmountInput(e.target.value);
                }}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
              {amountInvalid && (
                <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
                  Enter an amount greater than $0.00.
                </span>
              )}
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                Due date
              </span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                Notes
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
                rows={3}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                Attachment
              </span>
              <input
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-dashed border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--muted)] file:px-2 file:py-1 file:text-xs file:font-medium"
              />
              {file && (
                <span className="mt-1 block truncate text-xs text-[var(--muted-foreground)]">
                  {file.name}
                </span>
              )}
            </label>

            {submitError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
                {submitError}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitDisabled}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {submitting ? "Recording…" : "Record invoice"}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default function BillingPage(): React.ReactElement {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [clients, setClients] = useState<BillingClient[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [notInvoiced, setNotInvoiced] = useState<TimeReport | null>(null);
  const [invoiced, setInvoiced] = useState<TimeReport | null>(null);
  const [clientsLoading, setClientsLoading] = useState<boolean>(true);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [recordModalOpen, setRecordModalOpen] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedClient = clients.find((client) => client.id === clientId) ?? null;
  const reportsReady = notInvoiced !== null && invoiced !== null;
  const filteredNotInvoiced = notInvoiced ?? EMPTY_REPORT;
  const filteredInvoiced = invoiced ?? EMPTY_REPORT;
  const hasDateFilter = Boolean(from || to);

  const totalValueCents =
    filteredNotInvoiced.totals.valueCents + filteredInvoiced.totals.valueCents;
  const totalSeconds =
    filteredNotInvoiced.totals.seconds + filteredInvoiced.totals.seconds;

  const projectRows = useMemo(
    () => mergeProjectRows(filteredNotInvoiced, filteredInvoiced),
    [filteredNotInvoiced, filteredInvoiced],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadClients(): Promise<void> {
      setClientsLoading(true);
      setErrorMessage(null);
      try {
        const allClients = await fetchAllPages<BillingClient>("/billing-clients");
        if (cancelled) return;
        const activeClients = normalizeBillingClients(allClients);
        setClients(activeClients);
        setClientId((current) => current || activeClients[0]?.id || "");
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to load billing clients";
          setErrorMessage(message);
          showError(message);
        }
      } finally {
        if (!cancelled) setClientsLoading(false);
      }
    }

    loadClients();

    return () => {
      cancelled = true;
    };
  }, [showError]);

  const loadReports = useCallback(async (): Promise<void> => {
    if (!clientId) {
      setNotInvoiced(null);
      setInvoiced(null);
      return;
    }

    setReportLoading(true);
    setErrorMessage(null);
    try {
      const [nextNotInvoiced, nextInvoiced] = await Promise.all([
        apiFetch<TimeReport>(buildReportPath(clientId, false, from, to)),
        apiFetch<TimeReport>(buildReportPath(clientId, true, from, to)),
      ]);
      setNotInvoiced(nextNotInvoiced);
      setInvoiced(nextInvoiced);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to load billing summary";
      setErrorMessage(message);
      showError(message);
      setNotInvoiced(null);
      setInvoiced(null);
    } finally {
      setReportLoading(false);
    }
  }, [clientId, from, showError, to]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  async function handleGenerateInvoice(): Promise<void> {
    if (!selectedClient || !notInvoiced || notInvoiced.totals.valueCents === 0) {
      return;
    }

    setGenerating(true);
    try {
      const amountReport = hasDateFilter
        ? await apiFetch<TimeReport>(buildReportPath(selectedClient.id, false))
        : notInvoiced;
      const amountCents = amountReport.totals.valueCents;
      const amountHours = amountReport.totals.seconds;

      if (amountCents === 0) {
        showError("There is no un-invoiced billable time left for this client.");
        await loadReports();
        return;
      }

      const ok = await confirm({
        title: "Generate draft invoice?",
        message: `Create a draft invoice for ${selectedClient.name} covering ${formatCurrency(
          amountCents,
        )} (${formatHourLabel(amountHours)}) of un-invoiced billable time.${
          hasDateFilter
            ? " Date filters only affect this page preview; invoice generation covers all un-invoiced time for the billing client."
            : ""
        }`,
        confirmLabel: "Generate invoice",
      });

      if (!ok) return;

      const response = await apiFetch<GenerateInvoiceResponse>(
        "/time-entries/generate-invoice",
        {
          method: "POST",
          body: JSON.stringify({ billingClientId: selectedClient.id }),
        },
      );
      success(`Draft invoice created: ${response.invoiceId}`);
      await loadReports();
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to generate invoice";
      showError(message);
    } finally {
      setGenerating(false);
    }
  }

  const generateDisabled =
    !reportsReady ||
    reportLoading ||
    generating ||
    filteredNotInvoiced.totals.valueCents === 0;
  const recordDisabled =
    !selectedClient ||
    !reportsReady ||
    reportLoading ||
    generating ||
    !from ||
    !to;

  return (
    <div className="space-y-6">
      {recordModalOpen && selectedClient && reportsReady && (
        <RecordExternalInvoiceModal
          client={selectedClient}
          from={from}
          to={to}
          notInvoicedReport={filteredNotInvoiced}
          onClose={() => setRecordModalOpen(false)}
          onRecorded={loadReports}
        />
      )}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <CreditCard size={16} /> Billing summary
          </div>
          <h1 className="mt-1 text-2xl font-bold">Billing</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted-foreground)]">
            Track not-yet-invoiced vs invoiced time by billing client and roll
            un-invoiced billable work into a draft invoice.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRecordModalOpen(true)}
            disabled={recordDisabled}
            title={!from || !to ? "Choose a billing client and date range first" : undefined}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FileUp size={16} />
            Record external invoice
          </button>
          <button
            type="button"
            onClick={handleGenerateInvoice}
            disabled={generateDisabled}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <ReceiptText size={16} />}
            {generating ? "Generating…" : "Generate invoice"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_160px_160px]">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
              Billing client
            </span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={clientsLoading || clients.length === 0}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {clients.length === 0 ? (
                <option value="">
                  {clientsLoading ? "Loading clients…" : "No billing clients"}
                </option>
              ) : (
                clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
              From
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
              To
            </span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </label>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
          {errorMessage}
        </div>
      )}

      {clientsLoading || reportLoading || !reportsReady ? (
        <div className="rounded-xl border border-[var(--border)] p-8 text-center text-sm text-[var(--muted-foreground)]">
          <Loader2 className="mx-auto mb-3 animate-spin" size={20} />
          Loading billing summary…
        </div>
      ) : clients.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <h2 className="font-semibold">No active billing clients</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Add billing clients before generating client-level invoices.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryCard
              label="Not yet invoiced"
              valueCents={filteredNotInvoiced.totals.valueCents}
              seconds={filteredNotInvoiced.totals.seconds}
              emphasis
            />
            <SummaryCard
              label="Invoiced"
              valueCents={filteredInvoiced.totals.valueCents}
              seconds={filteredInvoiced.totals.seconds}
            />
            <SummaryCard
              label="Total billable"
              valueCents={totalValueCents}
              seconds={totalSeconds}
            />
          </div>

          {filteredNotInvoiced.totals.valueCents === 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-sm text-[var(--muted-foreground)]">
              This client has no not-yet-invoiced billable time in the current
              view. The generate-invoice action is disabled until there is work
              to invoice.
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-[var(--border)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <div>
                <h2 className="font-semibold">By project</h2>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Sorted by not-yet-invoiced value.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                    <th className="px-4 py-3 font-medium">Project</th>
                    <th className="px-4 py-3 font-medium">Hours</th>
                    <th className="px-4 py-3 font-medium">Not-invoiced $</th>
                    <th className="px-4 py-3 font-medium">Invoiced $</th>
                  </tr>
                </thead>
                <tbody>
                  {projectRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-[var(--muted-foreground)]"
                      >
                        No billable project time in this view.
                      </td>
                    </tr>
                  ) : (
                    projectRows.map((row) => (
                      <tr
                        key={row.projectId}
                        className="border-b border-[var(--border)] last:border-0"
                      >
                        <td className="px-4 py-3 font-medium">{row.projectName}</td>
                        <td className="px-4 py-3 text-[var(--muted-foreground)]">
                          {formatHourLabel(row.seconds)}
                        </td>
                        <td className="px-4 py-3 font-medium text-emerald-700 dark:text-emerald-300">
                          {formatCurrency(row.notInvoicedValueCents)}
                        </td>
                        <td className="px-4 py-3">
                          {formatCurrency(row.invoicedValueCents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
