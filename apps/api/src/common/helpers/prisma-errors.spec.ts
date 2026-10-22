import { describe, expect, it } from "bun:test";
import { isPrismaUniqueViolation } from "./prisma-errors";

describe("isPrismaUniqueViolation", () => {
  it("matches only a P2002 error", () => {
    expect(isPrismaUniqueViolation(Object.assign(new Error("dup"), { code: "P2002" }))).toBe(true);
    expect(isPrismaUniqueViolation({ code: "P2002" })).toBe(true);
    expect(isPrismaUniqueViolation({ code: "P2003" })).toBe(false);
    expect(isPrismaUniqueViolation(new Error("boom"))).toBe(false);
    expect(isPrismaUniqueViolation(null)).toBe(false);
    expect(isPrismaUniqueViolation("P2002")).toBe(false);
  });
});
