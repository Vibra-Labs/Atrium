import { describe, expect, it } from "bun:test";
import type { ConfigService } from "@nestjs/config";
import { getCurrency } from "./currency";

const makeConfig = (value?: string): ConfigService =>
  ({ get: () => value }) as unknown as ConfigService;

describe("getCurrency", () => {
  it("defaults to usd", () => {
    expect(getCurrency(makeConfig())).toBe("usd");
  });

  it("lowercases STRIPE_CURRENCY", () => {
    expect(getCurrency(makeConfig("EUR"))).toBe("eur");
  });

  it("treats a blank value as unset", () => {
    expect(getCurrency(makeConfig("  "))).toBe("usd");
  });
});
