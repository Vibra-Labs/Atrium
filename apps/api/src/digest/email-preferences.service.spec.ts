import { describe, expect, it, mock } from "bun:test";
import { EmailPreferencesService } from "./email-preferences.service";

function build() {
  const row = { weeklyUpdateReminders: true, mondayDigest: false };
  const prisma = {
    member: {
      findUniqueOrThrow: mock(() => Promise.resolve(row)),
      update: mock(({ data }: { data: Partial<typeof row> }) => Promise.resolve({ ...row, ...data })),
    },
  };
  return { service: new EmailPreferencesService(prisma as never), prisma };
}

const SELECT = { weeklyUpdateReminders: true, mondayDigest: true };

describe("EmailPreferencesService", () => {
  it("reads both switches for the member", async () => {
    const { service, prisma } = build();
    expect(await service.get("m1")).toEqual({ weeklyUpdateReminders: true, mondayDigest: false });
    expect(prisma.member.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "m1" }, select: SELECT });
  });

  it("updates only the switches that were sent", async () => {
    const { service, prisma } = build();
    expect(await service.update("m1", { mondayDigest: true })).toEqual({ weeklyUpdateReminders: true, mondayDigest: true });
    expect(prisma.member.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { mondayDigest: true }, select: SELECT });
  });
});
