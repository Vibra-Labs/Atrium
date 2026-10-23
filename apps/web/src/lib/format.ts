import { DEFAULT_CURRENCY, formatMoney } from "@atrium/shared";

export function formatCurrency(cents: number, currency?: string): string {
  return formatMoney(cents, currency);
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
