import { describe, expect, it } from "bun:test";
import { currencySymbol, formatCurrency } from "./format";

describe("formatCurrency", () => {
  it("defaults to USD", () => {
    expect(formatCurrency(123456)).toBe("$1,234.56");
  });

  it("formats in the given currency", () => {
    expect(formatCurrency(123456, "eur")).toContain("€");
    expect(formatCurrency(123456, "gbp")).toContain("£");
  });

  it("accepts upper or lower case codes", () => {
    expect(formatCurrency(100, "EUR")).toBe(formatCurrency(100, "eur"));
  });

  it("falls back to USD for an invalid code", () => {
    expect(formatCurrency(100, "not-a-code")).toBe("$1.00");
  });
});

describe("currencySymbol", () => {
  it("returns the symbol for a currency", () => {
    expect(currencySymbol()).toBe("$");
    expect(currencySymbol("eur")).toBe("€");
    expect(currencySymbol("gbp")).toBe("£");
  });

  it("falls back to $ for an invalid code", () => {
    expect(currencySymbol("nope")).toBe("$");
  });
});
