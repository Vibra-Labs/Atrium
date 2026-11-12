import { describe, expect, it, mock } from "bun:test";
import type { PrismaService } from "../prisma/prisma.service";
import { secondFactorsOf } from "./second-factors-of";
import { isStaffAnywhere } from "./staff-requirement";

describe("secondFactorsOf", () => {
  it("reports TOTP and the passkey count", async () => {
    const prisma = {
      user: { findUnique: mock(() => Promise.resolve({ twoFactorEnabled: true })) },
      passkey: { count: mock(() => Promise.resolve(2)) },
    } as unknown as PrismaService;
    expect(await secondFactorsOf(prisma, "u1")).toEqual({ totp: true, passkeys: 2 });
  });

  it("treats a missing user as having nothing", async () => {
    const prisma = {
      user: { findUnique: mock(() => Promise.resolve(null)) },
      passkey: { count: mock(() => Promise.resolve(0)) },
    } as unknown as PrismaService;
    expect(await secondFactorsOf(prisma, "u1")).toEqual({ totp: false, passkeys: 0 });
  });
});

describe("isStaffAnywhere", () => {
  it("looks for an owner or admin membership in any workspace", async () => {
    const findFirst = mock(() => Promise.resolve({ id: "m1" }));
    const prisma = { member: { findFirst } } as unknown as PrismaService;
    expect(await isStaffAnywhere(prisma, "u1")).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: "u1", role: { in: ["owner", "admin"] } },
      select: { id: true },
    });
  });
});
