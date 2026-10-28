import { DEFAULT_CURRENCY, formatMoney } from "@atrium/shared";

export function formatCurrency(cents: number, currency?: string): string {
  return formatMoney(cents, currency);
}

interface InvoiceAmounts {
  type: string;
  amount?: number | null;
  lineItems?: { quantity: number; unitPrice: number }[];
}

/** An invoice's total in cents: the stored amount for uploaded PDFs, otherwise the sum of its line items. */
export function invoiceTotal(invoice: InvoiceAmounts): number {
  if (invoice.type === "uploaded") return invoice.amount ?? 0;
  return (invoice.lineItems ?? []).reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
}

/** The symbol for a currency, e.g. "€" for "eur". */
export function currencySymbol(currency: string = DEFAULT_CURRENCY): string {
  try {
    const parts = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? "$";
  } catch (err) {
    console.error(`Invalid currency code "${currency}"`, err);
    return "$";
  }
}
