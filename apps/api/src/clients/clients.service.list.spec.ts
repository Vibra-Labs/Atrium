import { describe, expect, it, mock } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { ClientsService } from "./clients.service";

function buildPrisma(members: unknown[], total: number) {
  return {
    member: {
      findMany: mock(() => Promise.resolve(members)),
      count: mock(() => Promise.resolve(total)),
      findFirst: mock(() => Promise.resolve(members[0] ?? null)),
    },
    clientProfile: { findMany: mock(() => Promise.resolve([{ userId: "u2", company: "Globex" }])) },
  };
}

describe("ClientsService.list", () => {
  it("returns members enriched with profiles, scoped to the org", async () => {
    const prisma = buildPrisma([{ id: "m2", userId: "u2", role: "member" }], 1);
    const service = new ClientsService(prisma as never, {} as never);

    const result = await service.list("org1", 1, 20);

    expect(result.data[0].profile).toEqual({ userId: "u2", company: "Globex" });
    expect(result.meta.total).toBe(1);
    expect(prisma.member.findMany.mock.calls[0][0].where).toEqual({ organizationId: "org1" });
  });

  it("filters by name or email when search is given", async () => {
    const prisma = buildPrisma([], 0);
    await new ClientsService(prisma as never, {} as never).list("org1", 1, 20, "glo");
    expect(prisma.member.findMany.mock.calls[0][0].where).toEqual({
      organizationId: "org1",
      user: { OR: [
        { name: { contains: "glo", mode: "insensitive" } },
        { email: { contains: "glo", mode: "insensitive" } },
      ] },
    });
  });

  it("findMember throws NotFound when the user is not in the org", async () => {
    const service = new ClientsService(buildPrisma([], 0) as never, {} as never);
    await expect(service.findMember("nope", "org1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
