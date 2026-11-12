import { beforeEach, describe, expect, it, mock } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { symmetricEncrypt } from "better-auth/crypto";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import { TwoFactorService } from "./two-factor.service";
import type { StatusInput } from "./two-factor.service";

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
};

const config = { getOrThrow: (): string => SECRET } as unknown as ConfigService;

function service(): TwoFactorService {
  return new TwoFactorService(prisma as unknown as PrismaService, config);
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
