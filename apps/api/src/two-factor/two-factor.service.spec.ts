import { beforeEach, describe, expect, it, mock } from "bun:test";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { symmetricEncrypt } from "better-auth/crypto";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import { TwoFactorService } from "./two-factor.service";
import type { ResetInput, StatusInput } from "./two-factor.service";
import type { AuthService } from "../auth/auth.service";
import type { SessionCache } from "../auth/session-cache";

const SECRET: string = "s".repeat(32);

const prisma = {
  user: { findUnique: mock((): Promise<unknown> => Promise.resolve({ twoFactorEnabled: false })) },
  twoFactor: { findUnique: mock((): Promise<unknown> => Promise.resolve(null)) },
  systemSettings: {
    findUnique: mock((): Promise<unknown> => Promise.resolve(null)),
    update: mock((): Promise<unknown> => Promise.resolve({})),
  },
  member: {
    count: mock((): Promise<number> => Promise.resolve(1)),
    findFirst: mock((): Promise<unknown> => Promise.resolve(null)),
  },
  $transaction: mock(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
    fn({
      twoFactor: { deleteMany: (): Promise<{ count: number }> => Promise.resolve({ count: 1 }) },
      user: { update: (): Promise<unknown> => Promise.resolve({}) },
      session: { deleteMany: (): Promise<unknown> => Promise.resolve({}) },
      verification: { deleteMany: (): Promise<unknown> => Promise.resolve({}) },
    }),
  ),
};

const verifyTOTP = mock((): Promise<unknown> => Promise.resolve({ token: "t" }));
const verifyBackupCode = mock((): Promise<unknown> => Promise.resolve({ token: "t" }));
const sendAlert = mock((): Promise<void> => Promise.resolve());
const authService = { auth: { api: { verifyTOTP, verifyBackupCode } }, sendAlert };
const deleteUser = mock(() => undefined);
const sessionCache = { deleteUser };

const config = { getOrThrow: (): string => SECRET } as unknown as ConfigService;

function service(): TwoFactorService {
  return new TwoFactorService(
    prisma as unknown as PrismaService,
    config,
    authService as unknown as AuthService,
    sessionCache as unknown as SessionCache,
  );
}

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return { userId: "u1", secondFactor: null, organizationId: "org1", role: "owner", ...overrides };
}

describe("TwoFactorService.getStatus", () => {
  beforeEach(() => {
    prisma.user.findUnique.mockImplementation(() => Promise.resolve({ twoFactorEnabled: false }));
    prisma.twoFactor.findUnique.mockImplementation(() => Promise.resolve(null));
    prisma.systemSettings.findUnique.mockImplementation(() => Promise.resolve(null));
    prisma.member.count.mockImplementation(() => Promise.resolve(1));
    prisma.member.findFirst.mockImplementation(() => Promise.resolve(null));
  });

  it("counts the recovery codes left", async () => {
    prisma.user.findUnique.mockImplementation(() => Promise.resolve({ twoFactorEnabled: true }));
    const backupCodes: string = await symmetricEncrypt({ key: SECRET, data: JSON.stringify(["a", "b", "c"]) });
    prisma.twoFactor.findUnique.mockImplementation(() => Promise.resolve({ backupCodes }));
    const status = await service().getStatus(input({ secondFactor: "totp" }));
    expect(status.enabled).toBe(true);
    expect(status.recoveryCodesLeft).toBe(3);
    expect(status.pending).toBe(false);
  });

  it("reports a session that has not passed its factor as pending", async () => {
    prisma.user.findUnique.mockImplementation(() => Promise.resolve({ twoFactorEnabled: true }));
    const status = await service().getStatus(input());
    expect(status.pending).toBe(true);
  });

  it("requires enrollment from staff in a requiring workspace", async () => {
    prisma.systemSettings.findUnique.mockImplementation(() => Promise.resolve({ requireTwoFactor: true }));
    const status = await service().getStatus(input({ role: "admin" }));
    expect(status.workspaceRequires).toBe(true);
    expect(status.enrollmentRequired).toBe(true);
    expect(status.recoveryCodesLeft).toBeNull();
  });

  it("never requires enrollment from a client", async () => {
    prisma.systemSettings.findUnique.mockImplementation(() => Promise.resolve({ requireTwoFactor: true }));
    const status = await service().getStatus(input({ role: "member" }));
    expect(status.enrollmentRequired).toBe(false);
    expect(status.isStaff).toBe(false);
  });

  it("flags the only owner of a workspace", async () => {
    const status = await service().getStatus(input());
    expect(status.isOwner).toBe(true);
    expect(status.soloOwner).toBe(true);
  });

  it("does not let staff in a requiring workspace turn their only factor off", async () => {
    prisma.user.findUnique.mockImplementation(() => Promise.resolve({ twoFactorEnabled: true }));
    prisma.member.findFirst.mockImplementation(() => Promise.resolve({ id: "m1" }));
    const status = await service().getStatus(input({ secondFactor: "totp" }));
    expect(status.canTurnOff).toBe(false);
  });
});

describe("TwoFactorService.setRequirement", () => {
  it("refuses to turn the requirement on for an owner without 2FA", async () => {
    prisma.user.findUnique.mockImplementation(() => Promise.resolve({ twoFactorEnabled: false }));
    await expect(service().setRequirement("u1", "org1", true)).rejects.toThrow(BadRequestException);
    expect(prisma.systemSettings.update).not.toHaveBeenCalled();
  });

  it("turns the requirement on for an owner with 2FA", async () => {
    prisma.user.findUnique.mockImplementation(() => Promise.resolve({ twoFactorEnabled: true }));
    const result = await service().setRequirement("u1", "org1", true);
    expect(result).toEqual({ required: true });
    expect(prisma.systemSettings.update).toHaveBeenCalledWith({
      where: { organizationId: "org1" },
      data: { requireTwoFactor: true },
    });
  });

  it("always lets the requirement be turned off", async () => {
    prisma.user.findUnique.mockImplementation(() => Promise.resolve({ twoFactorEnabled: false }));
    expect(await service().setRequirement("u1", "org1", false)).toEqual({ required: false });
  });
});

describe("TwoFactorService.isStaffInRequiringWorkspace", () => {
  it("looks for a staff membership in a workspace that requires 2FA", async () => {
    prisma.member.findFirst.mockImplementation(() => Promise.resolve({ id: "m1" }));
    expect(await service().isStaffInRequiringWorkspace("u1")).toBe(true);
    expect(prisma.member.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        role: { in: ["owner", "admin"] },
        organization: { systemSettings: { requireTwoFactor: true } },
      },
      select: { id: true },
    });
  });
});

describe("TwoFactorService.resetForMember", () => {
  /** Member rows by user id in org1; `elsewhere` users also belong to another workspace. */
  let roles: Record<string, string>;
  let elsewhere: Set<string>;
  let actorHasTwoFactor: boolean;

  beforeEach(() => {
    roles = { owner1: "owner", owner2: "owner", admin1: "admin", admin2: "admin", client1: "member" };
    elsewhere = new Set<string>();
    actorHasTwoFactor = false;
    prisma.member.findFirst.mockImplementation(((args: { where: { userId: string; organizationId?: unknown } }) => {
      const { userId, organizationId } = args.where;
      if (organizationId && typeof organizationId === "object") {
        return Promise.resolve(elsewhere.has(userId) ? { id: "other" } : null);
      }
      return Promise.resolve(roles[userId] ? { role: roles[userId] } : null);
    }) as unknown as () => Promise<unknown>);
    prisma.user.findUnique.mockImplementation(() => Promise.resolve({ twoFactorEnabled: actorHasTwoFactor }));
    verifyTOTP.mockReset();
    verifyTOTP.mockImplementation(() => Promise.resolve({ token: "t" }));
    verifyBackupCode.mockClear();
    sendAlert.mockClear();
    deleteUser.mockClear();
    prisma.$transaction.mockClear();
  });

  function reset(overrides: Partial<ResetInput>): Promise<{ success: true }> {
    return service().resetForMember({
      actorId: "owner1",
      actorRole: "owner",
      organizationId: "org1",
      targetUserId: "admin1",
      headers: new Headers(),
      hosted: false,
      ...overrides,
    });
  }

  it("refuses a reset of your own account", async () => {
    await expect(reset({ targetUserId: "owner1" })).rejects.toThrow(BadRequestException);
  });

  it("refuses a target outside the workspace", async () => {
    await expect(reset({ targetUserId: "stranger" })).rejects.toThrow(NotFoundException);
  });

  it("refuses an admin resetting an owner", async () => {
    await expect(reset({ actorId: "admin1", actorRole: "admin", targetUserId: "owner1" })).rejects.toThrow(
      "Only an owner can reset another owner's two-factor.",
    );
  });

  it("lets an owner reset another owner", async () => {
    await reset({ targetUserId: "owner2" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("lets an admin reset another admin", async () => {
    await reset({ actorId: "admin1", actorRole: "admin", targetUserId: "admin2" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("refuses when the target also belongs to another workspace", async () => {
    elsewhere.add("client1");
    await expect(reset({ targetUserId: "client1" })).rejects.toThrow(ConflictException);
    await expect(reset({ targetUserId: "client1" })).rejects.toThrow("or ask whoever runs this server.");
    await expect(reset({ targetUserId: "client1", hosted: true })).rejects.toThrow("or contact support.");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("asks an actor with 2FA for a code", async () => {
    actorHasTwoFactor = true;
    await expect(reset({})).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a wrong code from an actor with 2FA", async () => {
    actorHasTwoFactor = true;
    verifyTOTP.mockImplementation(() => Promise.reject(new Error("INVALID_CODE")));
    await expect(reset({ code: "000000" })).rejects.toThrow("Enter a code from your authenticator app to confirm.");
  });

  it("accepts a recovery code from an actor with 2FA", async () => {
    actorHasTwoFactor = true;
    await reset({ code: "abcde-12345" });
    expect(verifyBackupCode).toHaveBeenCalledTimes(1);
    expect(verifyTOTP).not.toHaveBeenCalled();
  });

  it("resets, signs the target out and emails them", async () => {
    actorHasTwoFactor = true;
    const result = await reset({ code: "123456" });
    expect(result).toEqual({ success: true });
    expect(verifyTOTP).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith("admin1");
    expect(sendAlert).toHaveBeenCalledWith("admin1", { kind: "two_factor_disabled", by: "admin" });
  });
});
