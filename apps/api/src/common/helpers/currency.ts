import type { ConfigService } from "@nestjs/config";
import { DEFAULT_CURRENCY } from "@atrium/shared";

/** The instance-wide ISO 4217 currency (lowercase), from STRIPE_CURRENCY. */
export function getCurrency(config: ConfigService): string {
  const value: string | undefined = config.get<string>("STRIPE_CURRENCY")?.trim();
  return (value || DEFAULT_CURRENCY).toLowerCase();
}
