import { describe, expect, it } from "bun:test";
import { initials } from "./initials";

describe("initials", () => {
  it("takes the first and last name", () => {
    expect(initials("Ana Maria Lopez")).toBe("AL");
  });

  it("uses two letters of a single name", () => {
    expect(initials("cher")).toBe("CH");
  });

  it("ignores extra spaces", () => {
    expect(initials("  Ana   Lopez ")).toBe("AL");
  });

  it("falls back when there is no name", () => {
    expect(initials("")).toBe("?");
    expect(initials(null, "AT")).toBe("AT");
  });
});
