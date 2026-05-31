"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Loader2, ReceiptText } from "lucide-react";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { apiFetch } from "@/lib/api";
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
        const response = await apiFetch<BillingClientsResponse | BillingClient[]>(
          "/billing-clients?limit=200",
        );
        if (cancelled) return;
        const activeClients = normalizeBillingClients(response);
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

  return (
    <div className="space-y-6">
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
