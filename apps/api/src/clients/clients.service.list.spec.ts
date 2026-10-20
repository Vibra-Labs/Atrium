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
    contact: {
      findMany: mock(() =>
        Promise.resolve([{ userId: "u2", labels: [{ label: { id: "l1", name: "VIP", color: "#fff" } }] }]),
      ),
    },
  };
}

describe("ClientsService.list", () => {
  it("returns members enriched with profiles, scoped to the org", async () => {
    const prisma = buildPrisma([{ id: "m2", userId: "u2", role: "member" }], 1);
    const service = new ClientsService(prisma as never, {} as never, {} as never);

    const result = await service.list("org1", 1, 20);

    expect(result.data[0].profile).toEqual({ userId: "u2", company: "Globex" });
    expect(result.meta.total).toBe(1);
    expect(prisma.member.findMany.mock.calls[0][0].where).toEqual({ organizationId: "org1" });
  });

  it("returns labels from the member's contact in the { label } shape", async () => {
    const prisma = buildPrisma(
      [
        { id: "m2", userId: "u2", role: "member" },
        { id: "m3", userId: "u3", role: "member" },
      ],
      2,
    );
    const result = await new ClientsService(prisma as never, {} as never, {} as never).list("org1", 1, 20);

    expect(prisma.contact.findMany.mock.calls[0][0].where).toEqual({
      organizationId: "org1",
      userId: { in: ["u2", "u3"] },
    });
    expect(result.data[0].labels).toEqual([{ label: { id: "l1", name: "VIP", color: "#fff" } }]);
    expect(result.data[1].labels).toEqual([]);
  });

  it("returns staff labels from MemberLabel and client labels from the contact", async () => {
    const staffLabels = [{ label: { id: "l2", name: "Design", color: "#000" } }];
    const prisma = buildPrisma(
      [
        { id: "m1", userId: "u1", role: "owner", labels: staffLabels },
        { id: "m2", userId: "u2", role: "member", labels: [] },
      ],
      2,
    );
    const result = await new ClientsService(prisma as never, {} as never, {} as never).list("org1", 1, 20);

    const select = prisma.member.findMany.mock.calls[0][0].select;
    expect(select.labels).toEqual({
      select: { label: { select: { id: true, name: true, color: true } } },
    });
    expect(prisma.contact.findMany.mock.calls[0][0].where).toEqual({
      organizationId: "org1",
      userId: { in: ["u2"] },
    });
    expect(result.data[0].labels).toEqual(staffLabels);
    expect(result.data[1].labels).toEqual([{ label: { id: "l1", name: "VIP", color: "#fff" } }]);
  });

  it("filters by name or email when search is given", async () => {
    const prisma = buildPrisma([], 0);
    await new ClientsService(prisma as never, {} as never, {} as never).list("org1", 1, 20, "glo");
    expect(prisma.member.findMany.mock.calls[0][0].where).toEqual({
      organizationId: "org1",
      user: { OR: [
        { name: { contains: "glo", mode: "insensitive" } },
        { email: { contains: "glo", mode: "insensitive" } },
      ] },
    });
  });

  it("findMember throws NotFound when the user is not in the org", async () => {
    const service = new ClientsService(buildPrisma([], 0) as never, {} as never, {} as never);
    await expect(service.findMember("nope", "org1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
