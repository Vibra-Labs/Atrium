import { describe, expect, it, mock } from "bun:test";
import type { PrismaService } from "../prisma/prisma.service";
import { deletePasskeyGuarded } from "./passkey-delete";

interface Fake {
  prisma: PrismaService;
  calls: string[];
  deleteMany: ReturnType<typeof mock>;
}

function fake(opts: { owns?: boolean; passkeys?: number; totp?: boolean }): Fake {
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
  };
  const prisma = {
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
