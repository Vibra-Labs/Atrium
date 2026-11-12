import { describe, expect, it, mock } from "bun:test";
import type { PrismaService } from "../prisma/prisma.service";
import { claimTotpDisable, deletePasskeyGuarded, releaseTotpDisable, TOTP_DISABLING } from "./passkey-delete";

interface Fake {
  prisma: PrismaService;
  calls: string[];
  deleteMany: ReturnType<typeof mock>;
}

function fake(opts: { owns?: boolean; passkeys?: number; totp?: boolean; disabling?: boolean }): Fake {
  const calls: string[] = [];
  const deleteMany = mock(() => {
    calls.push("delete");
    return Promise.resolve({ count: 1 });
  });
  const tx = {
    $queryRaw: mock(() => {
      calls.push("lock");
      return Promise.resolve([{ id: "u1" }]);
    }),
    passkey: {
      findFirst: mock(() => {
        calls.push("find");
        return Promise.resolve(opts.owns === false ? null : { id: "pk1" });
      }),
      count: mock(() => {
        calls.push("count");
        return Promise.resolve(opts.passkeys ?? 1);
      }),
      deleteMany,
    },
    user: {
      findUnique: mock(() => Promise.resolve({ twoFactorEnabled: opts.totp ?? false })),
    },
    verification: {
      count: mock(() => Promise.resolve(opts.disabling ? 1 : 0)),
      create: mock(() => {
        calls.push("mark");
        return Promise.resolve({});
      }),
      deleteMany: mock(() => Promise.resolve({ count: 1 })),
    },
  };
  const prisma = {
    verification: tx.verification,
    $transaction: mock(async (fn: (t: typeof tx) => Promise<unknown>): Promise<unknown> => fn(tx)),
  } as unknown as PrismaService;
  return { prisma, calls, deleteMany };
}

describe("deletePasskeyGuarded", () => {
  it("locks the user before counting, so two removals can't both pass the check", async () => {
    const f = fake({ passkeys: 2 });
    expect(await deletePasskeyGuarded(f.prisma, "u1", "pk1", async () => true)).toBe("deleted");
    expect(f.calls[0]).toBe("lock");
    expect(f.calls.indexOf("count")).toBeLessThan(f.calls.indexOf("delete"));
    expect(f.deleteMany).toHaveBeenCalledWith({ where: { id: "pk1", userId: "u1" } });
  });

  it("refuses the last factor of staff in a requiring workspace", async () => {
    const f = fake({ passkeys: 1, totp: false });
    expect(await deletePasskeyGuarded(f.prisma, "u1", "pk1", async () => true)).toBe("last_factor");
    expect(f.deleteMany).not.toHaveBeenCalled();
  });

  it("allows it when TOTP remains, or nothing requires a factor", async () => {
    expect(await deletePasskeyGuarded(fake({ passkeys: 1, totp: true }).prisma, "u1", "pk1", async () => true)).toBe(
      "deleted",
    );
    expect(await deletePasskeyGuarded(fake({ passkeys: 1 }).prisma, "u1", "pk1", async () => false)).toBe("deleted");
  });

  it("reports someone else's passkey as not found", async () => {
    const f = fake({ owns: false });
    expect(await deletePasskeyGuarded(f.prisma, "u1", "pk1", async () => false)).toBe("not_found");
    expect(f.deleteMany).not.toHaveBeenCalled();
  });
});

describe("turning TOTP off and deleting the last passkey at once", () => {
  it("treats TOTP as off while a turn-off is in progress, so the last passkey stays", async () => {
    const f = fake({ passkeys: 1, totp: true, disabling: true });
    expect(await deletePasskeyGuarded(f.prisma, "u1", "pk1", async () => true)).toBe("last_factor");
    expect(f.deleteMany).not.toHaveBeenCalled();
  });

  it("claims the turn-off under the same lock, after re-counting passkeys", async () => {
    const f = fake({ passkeys: 1 });
    expect(await claimTotpDisable(f.prisma, "u1")).toBe("ok");
    expect(f.calls[0]).toBe("lock");
    expect(f.calls.indexOf("count")).toBeLessThan(f.calls.indexOf("mark"));
  });

  it("refuses the turn-off once the last passkey is gone", async () => {
    const f = fake({ passkeys: 0 });
    expect(await claimTotpDisable(f.prisma, "u1")).toBe("last_factor");
    expect(f.calls).not.toContain("mark");
  });

  it("clears the marker when the turn-off is over", async () => {
    const f = fake({});
    await releaseTotpDisable(f.prisma, "u1");
    const del = (f.prisma as unknown as { verification: { deleteMany: ReturnType<typeof mock> } }).verification.deleteMany;
    expect(del).toHaveBeenCalledWith({ where: { identifier: `${TOTP_DISABLING}u1` } });
  });
});
