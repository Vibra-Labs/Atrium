import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { BillingClientsService } from "./billing-clients.service";

let service: BillingClientsService;
let prisma: PrismaService;
let orgId: string;
let otherOrgId: string;

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    providers: [BillingClientsService, PrismaService],
  }).compile();
  service = mod.get(BillingClientsService);
  prisma = mod.get(PrismaService);
});

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { id: `bc-org-${stamp}`, name: `bc-org-${stamp}`, slug: `bc-${stamp}` },
  });
  const otherOrg = await prisma.organization.create({
    data: { id: `bc-other-org-${stamp}`, name: `bc-other-org-${stamp}`, slug: `bc-other-${stamp}` },
  });
  orgId = org.id;
  otherOrgId = otherOrg.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("BillingClientsService", () => {
  it("creates and reads a billing client scoped to the organization", async () => {
    const created = await service.create({ name: "CSP", slug: "csp", defaultHourlyRateCents: 12500 }, orgId);

    const found = await service.findOne(created.id, orgId);
    expect(found.id).toBe(created.id);
    expect(found.organizationId).toBe(orgId);
    expect(found.defaultHourlyRateCents).toBe(12500);
  });

  it("lists active billing clients and excludes archived clients by default", async () => {
    const active = await service.create({ name: "Active", slug: "active" }, orgId);
    const archived = await service.create({ name: "Archived", slug: "archived" }, orgId);
    await service.archive(archived.id, orgId);

    const list = await service.findAll(orgId, {});
    expect(list.data.map((client) => client.id)).toContain(active.id);
    expect(list.data.map((client) => client.id)).not.toContain(archived.id);

    const withArchived = await service.findAll(orgId, { archived: "true" });
    expect(withArchived.data.map((client) => client.id)).toContain(archived.id);
  });

  it("updates only within the current organization", async () => {
    const own = await service.create({ name: "Own", slug: "own" }, orgId);
    const other = await service.create({ name: "Other", slug: "other" }, otherOrgId);

    const updated = await service.update(own.id, { name: "Own Updated", billingPeriod: "biweekly" }, orgId);
    expect(updated.name).toBe("Own Updated");
    expect(updated.billingPeriod).toBe("biweekly");

    await expect(service.update(other.id, { name: "Leak" }, orgId)).rejects.toBeInstanceOf(NotFoundException);
    const otherReloaded = await prisma.billingClient.findUnique({ where: { id: other.id } });
    expect(otherReloaded?.name).toBe("Other");
  });

  it("soft-deletes via archivedAt instead of hard deleting", async () => {
    const client = await service.create({ name: "Delete Me", slug: "delete-me" }, orgId);

    const archived = await service.archive(client.id, orgId);
    expect(archived.archivedAt).toBeInstanceOf(Date);

    const reloaded = await prisma.billingClient.findUnique({ where: { id: client.id } });
    expect(reloaded).not.toBeNull();
    expect(reloaded?.archivedAt).toBeInstanceOf(Date);
  });

  it("does not read another organization's billing client", async () => {
    const other = await service.create({ name: "Other Org Client", slug: "other-org-client" }, otherOrgId);

    await expect(service.findOne(other.id, orgId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
