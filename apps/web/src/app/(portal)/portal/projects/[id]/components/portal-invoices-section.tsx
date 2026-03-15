"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import { Receipt, Download } from "lucide-react";
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
  draft: { bg: "#e5e7eb", text: "#374151" },
  sent: { bg: "#dbeafe", text: "#1d4ed8" },
  paid: { bg: "#dcfce7", text: "#15803d" },
  overdue: { bg: "#fee2e2", text: "#b91c1c" },
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
  const { error: showError } = useToast();

  useEffect(() => {
    apiFetch<{ paymentInstructions: string | null }>("/settings/payment-instructions")
      .then((res) => setPaymentInstructions(res.paymentInstructions))
      .catch(console.error);
  }, []);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<PaginatedResponse<InvoiceListItem>>(
        `/invoices/mine?page=${page}&limit=20`,
      );
      // Filter to this project client-side
      const projectInvoices = res.data.filter(
        (inv) => inv.projectId === projectId,
      );
      setInvoices(projectInvoices);
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
            const colors = statusColors[inv.status] || statusColors.draft;
            const total = inv.type === "uploaded"
              ? (inv.amount || 0)
              : inv.lineItems.reduce(
                  (s, li) => s + li.quantity * li.unitPrice,
                  0,
                );
            const isExpanded = expandedId === inv.id;

            return (
              <div key={inv.id} className="border border-[var(--border)] rounded-lg">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                  className="flex items-center justify-between w-full p-3 text-left hover:bg-[var(--muted)] transition-colors rounded-lg"
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
                      className="text-xs px-2 py-1 rounded-full font-medium"
                      style={{ backgroundColor: colors.bg, color: colors.text }}
                    >
                      {inv.status}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 space-y-3 border-t border-[var(--border)]">
                    <div className="flex items-center justify-between pt-3">
                      {inv.dueDate ? (
                        <p className="text-sm text-[var(--muted-foreground)]">
                          Due: {new Date(inv.dueDate).toLocaleDateString()}
                        </p>
                      ) : <div />}
                      <div className="flex items-center gap-3">
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

                    {paymentInstructions && (
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
