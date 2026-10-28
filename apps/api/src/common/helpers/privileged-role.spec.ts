import { describe, expect, it } from "bun:test";
import { isPrivilegedRole } from "./privileged-role";

describe("isPrivilegedRole", () => {
  it("is true for owners and admins", () => {
    expect(isPrivilegedRole("owner")).toBe(true);
    expect(isPrivilegedRole("admin")).toBe(true);
  });

  it("is false for clients and missing roles", () => {
    expect(isPrivilegedRole("member")).toBe(false);
    expect(isPrivilegedRole(undefined)).toBe(false);
  });
});
