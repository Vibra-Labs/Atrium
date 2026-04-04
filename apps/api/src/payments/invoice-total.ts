/**
 * Calculate the total amount in cents for an invoice.
 * Works for both uploaded (fixed amount) and itemized (line items) invoices.
 */
export function calculateInvoiceTotal(invoice: {
  type: string;
  amount?: number | null;
  lineItems: Array<{ quantity: number; unitPrice: number }>;
}): number {
  if (invoice.type === "uploaded" && invoice.amount != null) {
    return invoice.amount;
  }
  return invoice.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
}
