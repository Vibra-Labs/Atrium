"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import { Plus, Trash2, Receipt, Download } from "lucide-react";
import { track } from "@/lib/track";

interface LineItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  status: string;
  dueDate?: string | null;
  notes?: string | null;
  lineItems: LineItem[];
  createdAt: string;
}

interface InvoiceStats {
  outstandingAmount: number;
  totalInvoices: number;
  paidAmount: number;
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

export function InvoicesSection({
  projectId,
  isArchived,
}: {
  projectId: string;
  isArchived: boolean;
}) {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newDueDate, setNewDueDate] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newLineItems, setNewLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editItems, setEditItems] = useState<LineItem[]>([]);
  const [editNotes, setEditNotes] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "10");
      params.set("projectId", projectId);
      if (statusFilter) params.set("status", statusFilter);
      const res = await apiFetch<PaginatedResponse<InvoiceListItem>>(
        `/invoices?${params.toString()}`,
      );
      setInvoices(res.data);
      setTotalPages(res.meta.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, page, statusFilter]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const outstanding = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce(
      (sum, inv) =>
        sum + inv.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0),
      0,
    );

  // Create handlers
  const updateNewLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    setNewLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      await apiFetch("/invoices", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          dueDate: newDueDate || undefined,
          notes: newNotes || undefined,
          lineItems: newLineItems.filter((li) => li.description.trim()),
        }),
      });
      track("invoice_created", { amount: newTotal });
      setShowCreate(false);
      setNewDueDate("");
      setNewNotes("");
      setNewLineItems([{ description: "", quantity: 1, unitPrice: 0 }]);
      loadInvoices();
      success("Invoice created");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setSubmitting(false);
    }
  };

  // Status transition
  const handleStatusChange = async (invoiceId: string, newStatus: string) => {
    try {
      await apiFetch(`/invoices/${invoiceId}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
      loadInvoices();
      success(`Invoice marked as ${newStatus}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  // Edit handlers
  const startEditing = (inv: InvoiceListItem) => {
    setEditingId(inv.id);
    setEditItems(
      inv.lineItems.map((li) => ({
        id: li.id,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
      })),
    );
    setEditNotes(inv.notes || "");
    setEditDueDate(inv.dueDate ? inv.dueDate.split("T")[0] : "");
  };

  const handleSaveEdit = async (invoiceId: string) => {
    setSaving(true);
    try {
      await apiFetch(`/invoices/${invoiceId}`, {
        method: "PUT",
        body: JSON.stringify({
          dueDate: editDueDate || null,
          notes: editNotes,
          lineItems: editItems.filter((li) => li.description.trim()),
        }),
      });
      setEditingId(null);
      loadInvoices();
      success("Invoice updated");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update invoice");
    } finally {
      setSaving(false);
    }
  };

  const updateEditItem = (index: number, field: keyof LineItem, value: string | number) => {
    setEditItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  // Delete
  const handleDelete = async (invoiceId: string) => {
    const ok = await confirm({
      title: "Delete Invoice",
      message: "Delete this invoice? This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/invoices/${invoiceId}`, { method: "DELETE" });
      loadInvoices();
      success("Invoice deleted");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete invoice");
    }
  };

  const handleDownloadPdf = async (invoiceId: string, invoiceNumber: string) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ""}/api/invoices/${invoiceId}/pdf`,
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

  const newTotal = newLineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Receipt size={14} />
          Invoices{invoices.length > 0 && ` (${invoices.length})`}
        </h2>
        {!isArchived && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
          >
            <Plus size={14} />
            New Invoice
          </button>
        )}
      </div>

      {/* Stats line */}
      {invoices.length > 0 && (
        <p className="text-xs text-[var(--muted-foreground)] mb-3">
          {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
          {outstanding > 0 && ` \u2014 ${formatCurrency(outstanding)} outstanding`}
        </p>
      )}

      {/* Status filter */}
      <div className="mb-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreate(false);
          }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-2xl mx-4 p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold">New Invoice</h3>

            <div>
              <label className="text-sm text-[var(--muted-foreground)]">Due Date</label>
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted-foreground)] mb-2 block">Line Items</label>
              <div className="space-y-2">
                {newLineItems.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateNewLineItem(index, "description", e.target.value)}
                      placeholder="Description"
                      className="flex-1 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                    />
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateNewLineItem(index, "quantity", parseInt(e.target.value) || 0)}
                      min={1}
                      className="w-20 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                    />
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted-foreground)]">$</span>
                      <input
                        type="number"
                        value={item.unitPrice / 100 || ""}
                        onChange={(e) =>
                          updateNewLineItem(index, "unitPrice", Math.round(parseFloat(e.target.value || "0") * 100))
                        }
                        step="0.01"
                        min={0}
                        className="w-28 pl-7 pr-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                      />
                    </div>
                    <span className="text-sm font-medium w-24 text-right">
                      {formatCurrency(item.quantity * item.unitPrice)}
                    </span>
                    {newLineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setNewLineItems((prev) => prev.filter((_, i) => i !== index))}
                        className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setNewLineItems((prev) => [...prev, { description: "", quantity: 1, unitPrice: 0 }])}
                className="mt-2 flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
              >
                <Plus size={14} />
                Add Line Item
              </button>
            </div>

            <div className="flex justify-end">
              <div className="text-right">
                <span className="text-sm text-[var(--muted-foreground)]">Total</span>
                <p className="text-xl font-bold">{formatCurrency(newTotal)}</p>
              </div>
            </div>

            <div>
              <label className="text-sm text-[var(--muted-foreground)]">Notes</label>
              <textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={2}
                placeholder="Additional notes..."
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm resize-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting || newLineItems.every((li) => !li.description.trim())}
                className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "Creating..." : "Create Invoice"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 bg-[var(--muted)] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : invoices.length > 0 ? (
        <div className="space-y-2">
          {invoices.map((inv) => {
            const colors = statusColors[inv.status] || statusColors.draft;
            const total = inv.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
            const isExpanded = expandedId === inv.id;
            const isDraft = inv.status === "draft";
            const isEditing = editingId === inv.id;

            return (
              <div key={inv.id} className="border border-[var(--border)] rounded-lg">
                {/* Row header */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                  className="flex items-center justify-between w-full p-3 text-left hover:bg-[var(--muted)] transition-colors rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium">{inv.invoiceNumber}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium">{formatCurrency(total)}</span>
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

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-3 border-t border-[var(--border)]">
                    {/* Actions bar */}
                    <div className="flex items-center gap-2 pt-3">
                      {isDraft && !isArchived && (
                        <button
                          onClick={() => handleStatusChange(inv.id, "sent")}
                          className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs hover:opacity-90"
                        >
                          Mark as Sent
                        </button>
                      )}
                      {(inv.status === "sent" || inv.status === "overdue") && !isArchived && (
                        <button
                          onClick={() => handleStatusChange(inv.id, "paid")}
                          className="px-3 py-1 bg-green-600 text-white rounded-lg text-xs hover:opacity-90"
                        >
                          Mark as Paid
                        </button>
                      )}
                      <button
                        onClick={() => handleDownloadPdf(inv.id, inv.invoiceNumber)}
                        className="flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                      >
                        <Download size={12} />
                        PDF
                      </button>
                      {isDraft && !isArchived && !isEditing && (
                        <button
                          onClick={() => startEditing(inv)}
                          className="text-xs text-[var(--primary)] hover:underline"
                        >
                          Edit
                        </button>
                      )}
                      {!isArchived && (
                        <button
                          onClick={() => handleDelete(inv.id)}
                          className="ml-auto flex items-center gap-1 text-xs text-red-500 hover:underline"
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      )}
                    </div>

                    {/* Edit mode */}
                    {isEditing && isDraft ? (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs text-[var(--muted-foreground)]">Due Date</label>
                          <input
                            type="date"
                            value={editDueDate}
                            onChange={(e) => setEditDueDate(e.target.value)}
                            className="w-full mt-1 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          {editItems.map((item, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={item.description}
                                onChange={(e) => updateEditItem(index, "description", e.target.value)}
                                placeholder="Description"
                                className="flex-1 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                              />
                              <input
                                type="number"
                                value={item.quantity}
                                onChange={(e) => updateEditItem(index, "quantity", parseInt(e.target.value) || 0)}
                                min={1}
                                className="w-20 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                              />
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted-foreground)]">$</span>
                                <input
                                  type="number"
                                  value={item.unitPrice / 100 || ""}
                                  onChange={(e) =>
                                    updateEditItem(index, "unitPrice", Math.round(parseFloat(e.target.value || "0") * 100))
                                  }
                                  step="0.01"
                                  min={0}
                                  className="w-28 pl-7 pr-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                                />
                              </div>
                              <span className="text-sm font-medium w-24 text-right">
                                {formatCurrency(item.quantity * item.unitPrice)}
                              </span>
                              {editItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setEditItems((prev) => prev.filter((_, i) => i !== index))}
                                  className="p-1 text-[var(--muted-foreground)] hover:text-red-500"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => setEditItems((prev) => [...prev, { description: "", quantity: 1, unitPrice: 0 }])}
                            className="flex items-center gap-1.5 text-xs text-[var(--primary)] hover:underline"
                          >
                            <Plus size={12} />
                            Add Line Item
                          </button>
                        </div>
                        <div>
                          <label className="text-xs text-[var(--muted-foreground)]">Notes</label>
                          <textarea
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            rows={2}
                            className="w-full mt-1 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm resize-none"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveEdit(inv.id)}
                            disabled={saving}
                            className="px-3 py-1 bg-[var(--primary)] text-white rounded-lg text-xs hover:opacity-90 disabled:opacity-50"
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1 border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--muted)]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Line items table */}
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
                              {inv.lineItems.map((li, idx) => (
                                <tr key={li.id || idx} className="border-t border-[var(--border)]">
                                  <td className="px-4 py-2">{li.description}</td>
                                  <td className="px-4 py-2 text-right">{li.quantity}</td>
                                  <td className="px-4 py-2 text-right">{formatCurrency(li.unitPrice)}</td>
                                  <td className="px-4 py-2 text-right font-medium">
                                    {formatCurrency(li.quantity * li.unitPrice)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-[var(--border)] bg-[var(--muted)]">
                                <td colSpan={3} className="px-4 py-2 text-right font-medium">Total</td>
                                <td className="px-4 py-2 text-right font-bold">{formatCurrency(total)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>

                        {inv.notes && (
                          <div>
                            <p className="text-xs font-medium mb-1">Notes</p>
                            <p className="text-sm text-[var(--muted-foreground)] whitespace-pre-wrap">
                              {inv.notes}
                            </p>
                          </div>
                        )}
                      </>
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

      <div className="mt-3">
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}
