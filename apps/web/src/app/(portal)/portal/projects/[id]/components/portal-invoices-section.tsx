"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import { Receipt, Download, CreditCard } from "lucide-react";
import { downloadFile } from "@/lib/download";

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  status: string;
  type: string;
  amount?: number | null;
  dueDate?: string | null;
  notes?: string | null;
  projectId?: string | null;
  uploadedFileId?: string | null;
  uploadedFile?: { id: string; filename: string; sizeBytes: number } | null;
  lineItems: LineItem[];
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const statusColors: Record<string, { bg: string; text: string }> = {
  sent: { bg: "#dbeafe", text: "#1d4ed8" },
  paid: { bg: "#dcfce7", text: "#15803d" },
  overdue: { bg: "#fee2e2", text: "#b91c1c" },
  cancelled: { bg: "#e5e7eb", text: "#374151" },
};

export function PortalInvoicesSection({
  projectId,
}: {
  projectId: string;
}) {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [paymentInstructions, setPaymentInstructions] = useState<string | null>(null);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const { success, info, error: showError } = useToast();

  useEffect(() => {
    apiFetch<{ paymentInstructions: string | null; stripeConnectEnabled: boolean }>("/settings/payment-instructions")
      .then((res) => {
        setPaymentInstructions(res.paymentInstructions);
        setStripeEnabled(res.stripeConnectEnabled);
      })
      .catch(console.error);
  }, []);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<PaginatedResponse<InvoiceListItem>>(
        `/invoices/mine?page=${page}&limit=20&projectId=${encodeURIComponent(projectId)}`,
      );
      setInvoices(res.data);
      setTotalPages(res.meta.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, projectId]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  // Check for payment redirect results
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentParam = params.get("payment");
    if (paymentParam === "success") {
      success("Payment successful! The invoice has been marked as paid.");
      loadInvoices(); // Refresh to show updated status
    } else if (paymentParam === "cancelled") {
      info("Payment was not completed. You can try again below.");
    }

    if (paymentParam) {
      const url = new URL(window.location.href);
      url.searchParams.delete("payment");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileDownload = async (fileId: string, filename: string) => {
    try {
      await downloadFile(fileId, filename);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to download file");
    }
  };

  const handleDownloadPdf = async (invoiceId: string, invoiceNumber: string) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ""}/api/invoices/mine/${invoiceId}/pdf`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to download PDF");
    }
  };

  const handlePayNow = async (e: React.MouseEvent, invoiceId: string) => {
    e.stopPropagation(); // Prevent row expand/collapse
    setPayingInvoiceId(invoiceId);
    try {
      const currentUrl = window.location.href.split("?")[0];
      const res = await apiFetch<{ url: string }>(
        `/payments/checkout/${invoiceId}`,
        {
          method: "POST",
          body: JSON.stringify({
            successUrl: `${currentUrl}?payment=success`,
            cancelUrl: `${currentUrl}?payment=cancelled`,
          }),
        },
      );
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to start payment");
      setPayingInvoiceId(null);
    }
  };

  const isPayable = (status: string) => ["sent", "overdue"].includes(status);

  if (loading) {
    return (
      <div>
        <h2 className="text-sm font-medium mb-3">Invoices</h2>
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 bg-[var(--muted)] rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-medium mb-3">Invoices</h2>

      {invoices.length > 0 ? (
        <div className="space-y-2">
          {invoices.map((inv) => {
            const colors = statusColors[inv.status] || { bg: "#e5e7eb", text: "#374151" };
            const total = inv.type === "uploaded"
              ? (inv.amount || 0)
              : inv.lineItems.reduce(
                  (s, li) => s + li.quantity * li.unitPrice,
                  0,
                );
            const isExpanded = expandedId === inv.id;
            const expandedPanelId = `invoice-details-${inv.id}`;

            return (
              <div key={inv.id} className="border border-[var(--border)] rounded-lg">
                <div className="flex items-center w-full">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                    aria-expanded={isExpanded}
                    aria-controls={expandedPanelId}
                    className="flex items-center justify-between flex-1 p-3 text-left hover:bg-[var(--muted)] transition-colors rounded-lg"
                  >
                    <span className="text-sm font-medium">{inv.invoiceNumber}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium">
                        {formatCurrency(total)}
                      </span>
                      {inv.dueDate && (
                        <span className="text-xs text-[var(--muted-foreground)]">
                          Due {new Date(inv.dueDate).toLocaleDateString()}
                        </span>
                      )}
                      <span
                        className="text-xs px-2 py-1 rounded-full font-medium capitalize"
                        style={{ backgroundColor: colors.bg, color: colors.text }}
                      >
                        {inv.status}
                      </span>
                    </div>
                  </button>
                  {/* Pay Now on row — visible without expanding */}
                  {stripeEnabled && isPayable(inv.status) && (
                    <button
                      onClick={(e) => handlePayNow(e, inv.id)}
                      disabled={payingInvoiceId === inv.id}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 mr-3 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity shrink-0"
                    >
                      <CreditCard size={12} />
                      {payingInvoiceId === inv.id ? "..." : "Pay"}
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div id={expandedPanelId} className="px-3 pb-3 space-y-3 border-t border-[var(--border)]">
                    <div className="flex items-center justify-between pt-3">
                      {inv.dueDate ? (
                        <p className="text-sm text-[var(--muted-foreground)]">
                          Due: {new Date(inv.dueDate).toLocaleDateString()}
                        </p>
                      ) : <div />}
                      <div className="flex items-center gap-3">
                        {stripeEnabled && isPayable(inv.status) && (
                          <button
                            onClick={(e) => handlePayNow(e, inv.id)}
                            disabled={payingInvoiceId === inv.id}
                            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
                          >
                            <CreditCard size={14} />
                            {payingInvoiceId === inv.id ? "Redirecting..." : "Pay Now"}
                          </button>
                        )}
                        {inv.type === "uploaded" && inv.uploadedFile && (
                          <button
                            onClick={() =>
                              handleFileDownload(
                                inv.uploadedFile!.id,
                                inv.uploadedFile!.filename,
                              )
                            }
                            className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
                          >
                            <Download size={14} />
                            Download File
                          </button>
                        )}
                        {inv.type !== "uploaded" && (
                          <button
                            onClick={() => handleDownloadPdf(inv.id, inv.invoiceNumber)}
                            className="flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
                          >
                            <Download size={14} />
                            Download PDF
                          </button>
                        )}
                      </div>
                    </div>

                    {inv.type === "uploaded" ? (
                      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--muted)]">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-[var(--muted-foreground)]">Total Amount</span>
                          <span className="text-lg font-bold">{formatCurrency(total)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-[var(--muted)]">
                              <th className="text-left px-4 py-2 font-medium">Description</th>
                              <th className="text-right px-4 py-2 font-medium">Qty</th>
                              <th className="text-right px-4 py-2 font-medium">Unit Price</th>
                              <th className="text-right px-4 py-2 font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inv.lineItems.map((li) => (
                              <tr key={li.id} className="border-t border-[var(--border)]">
                                <td className="px-4 py-2">{li.description}</td>
                                <td className="px-4 py-2 text-right">{li.quantity}</td>
                                <td className="px-4 py-2 text-right">
                                  {formatCurrency(li.unitPrice)}
                                </td>
                                <td className="px-4 py-2 text-right font-medium">
                                  {formatCurrency(li.quantity * li.unitPrice)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-[var(--border)] bg-[var(--muted)]">
                              <td colSpan={3} className="px-4 py-2 text-right font-medium">
                                Total
                              </td>
                              <td className="px-4 py-2 text-right font-bold">
                                {formatCurrency(total)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}

                    {inv.notes && (
                      <div>
                        <p className="text-xs font-medium mb-1">Notes</p>
                        <p className="text-sm text-[var(--muted-foreground)] whitespace-pre-wrap">
                          {inv.notes}
                        </p>
                      </div>
                    )}

                    {/* Only show payment instructions for unpaid invoices */}
                    {paymentInstructions && isPayable(inv.status) && (
                      <div>
                        <p className="text-xs font-medium mb-1">Payment Instructions</p>
                        <p className="text-sm text-[var(--muted-foreground)] whitespace-pre-wrap">
                          {paymentInstructions}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-6">
          <Receipt size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
          <p className="text-sm text-[var(--muted-foreground)]">
            No invoices yet.
          </p>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="mt-3">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
