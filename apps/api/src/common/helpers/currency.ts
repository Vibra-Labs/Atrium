import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { DEFAULT_CURRENCY } from "@atrium/shared";

const logger = new Logger("Currency");
let warnedFor: string | null = null;

function isValidCurrency(code: string): boolean {
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    return true;
  } catch (err) {
    logger.debug(`Rejected currency code "${code}": ${(err as Error).message}`);
    return false;
  }
}

/**
 * The instance-wide ISO 4217 currency (lowercase), from STRIPE_CURRENCY.
 * An invalid code falls back to USD everywhere, so display and Stripe agree.
 */
export function getCurrency(config: ConfigService): string {
  const value: string = (config.get<string>("STRIPE_CURRENCY")?.trim() || DEFAULT_CURRENCY).toLowerCase();
  if (isValidCurrency(value)) return value;
  if (warnedFor !== value) {
    logger.warn(`STRIPE_CURRENCY "${value}" is not a valid ISO 4217 code; using ${DEFAULT_CURRENCY}`);
    warnedFor = value;
  }
  return DEFAULT_CURRENCY;
}
