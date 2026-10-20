import "reflect-metadata";
import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ConflictException, NotFoundException, BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { ContactsService } from "./contacts.service";
import { ContactsController } from "./contacts.controller";
import { CompaniesController } from "./companies.controller";
import type { ContactRevenueService } from "./contact-revenue.service";
import { ROLES_KEY } from "../common";

const prisma = {
  contact: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
    findMany: mock(() => Promise.resolve([] as unknown[])),
    count: mock(() => Promise.resolve(0)),
    create: mock((a: { data: Record<string, unknown> }) => Promise.resolve({ id: "c-1", ...a.data })),
    update: mock(() => Promise.resolve({ id: "c-1" })),
    delete: mock(() => Promise.resolve({})),
  },
  company: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
    create: mock(() => Promise.resolve({ id: "co-new" })),
  },
  leadSource: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
    create: mock(() => Promise.resolve({ id: "ls-new" })),
  },
  project: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  projectContact: {
    findUnique: mock(() => Promise.resolve(null as unknown)),
    create: mock(() => Promise.resolve({})),
    deleteMany: mock(() => Promise.resolve({ count: 1 })),
  },
  contactNote: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    count: mock(() => Promise.resolve(0)),
    create: mock(() => Promise.resolve({ id: "n-1" })),
    findFirst: mock(() => Promise.resolve(null as unknown)),
    delete: mock(() => Promise.resolve({})),
  },
  contactEvent: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    count: mock(() => Promise.resolve(0)),
    create: mock(() => Promise.resolve({})),
  },
  user: { findMany: mock(() => Promise.resolve([] as unknown[])) },
};

const revenue = {
  forContact: mock(() => Promise.resolve({ paidCents: 0, outstandingCents: 0, monthly: [] })),
  paidTotals: mock(() => Promise.resolve(new Map<string, number>())),
};

function resetAll(): void {
  for (const model of Object.values(prisma)) {
    for (const fn of Object.values(model)) (fn as ReturnType<typeof mock>).mockClear();
  }
  prisma.contact.findFirst.mockImplementation(() => Promise.resolve(null));
  prisma.company.findFirst.mockImplementation(() => Promise.resolve(null));
  prisma.leadSource.findFirst.mockImplementation(() => Promise.resolve(null));
  prisma.project.findFirst.mockImplementation(() => Promise.resolve(null));
  prisma.projectContact.findUnique.mockImplementation(() => Promise.resolve(null));
  prisma.contactNote.findMany.mockImplementation(() => Promise.resolve([]));
  prisma.contactEvent.findMany.mockImplementation(() => Promise.resolve([]));
  prisma.contactNote.count.mockImplementation(() => Promise.resolve(0));
  prisma.contactEvent.count.mockImplementation(() => Promise.resolve(0));
}

async function rejects(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected rejection");
}

describe("ContactsService", () => {
  let service: ContactsService;

  beforeEach(() => {
    resetAll();
    service = new ContactsService(
      prisma as unknown as PrismaService,
      revenue as unknown as ContactRevenueService,
    );
  });

  it("create lowercases email and rejects duplicates with 409", async () => {
    await service.create({ name: "Ann", email: "  Ann@Example.COM " }, "org-1");
    const arg = prisma.contact.create.mock.calls[0][0] as { data: { email: string } };
    expect(arg.data.email).toBe("ann@example.com");
    expect(prisma.contactEvent.create).toHaveBeenCalled();

    prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "x" }));
    const e = await rejects(service.create({ name: "Ann", email: "ann@example.com" }, "org-1"));
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as Error).message).toBe("A contact with this email already exists");
  });

  it("create with companyName finds existing company case-insensitively", async () => {
    prisma.company.findFirst.mockImplementation(() => Promise.resolve({ id: "co-1" }));
    await service.create({ name: "Ann", companyName: "acme" }, "org-1");
    expect(prisma.company.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", name: { equals: "acme", mode: "insensitive" } },
    });
    expect(prisma.company.create).not.toHaveBeenCalled();
    const arg = prisma.contact.create.mock.calls[0][0] as { data: { companyId: string } };
    expect(arg.data.companyId).toBe("co-1");
  });

  it("create with leadSourceName creates a new source once", async () => {
    await service.create({ name: "Ann", leadSourceName: "Podcast" }, "org-1");
    expect(prisma.leadSource.create).toHaveBeenCalledTimes(1);
    const arg = prisma.contact.create.mock.calls[0][0] as { data: { leadSourceId: string } };
    expect(arg.data.leadSourceId).toBe("ls-new");
  });

  it("linkProject 404s for a project in another org and writes nothing", async () => {
    prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
    const e = await rejects(service.linkProject("c-1", "p-other", "org-1"));
    expect(e).toBeInstanceOf(NotFoundException);
    expect(prisma.projectContact.create).not.toHaveBeenCalled();
    expect(prisma.contactEvent.create).not.toHaveBeenCalled();
  });

  it("linkProject writes project_linked event and skips duplicates", async () => {
    prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
    prisma.project.findFirst.mockImplementation(() => Promise.resolve({ id: "p-1", name: "Site" }));
    await service.linkProject("c-1", "p-1", "org-1");
    expect(prisma.contactEvent.create).toHaveBeenCalledWith({
      data: {
        contactId: "c-1",
        organizationId: "org-1",
        type: "project_linked",
        detail: 'Linked to project "Site"',
        refId: "p-1",
      },
    });
    prisma.contactEvent.create.mockClear();
    prisma.projectContact.create.mockClear();
    prisma.projectContact.findUnique.mockImplementation(() => Promise.resolve({ id: "pc" }));
    await service.linkProject("c-1", "p-1", "org-1");
    expect(prisma.projectContact.create).not.toHaveBeenCalled();
    expect(prisma.contactEvent.create).not.toHaveBeenCalled();
  });

  it("create 404s for companyId and referredById in another org", async () => {
    const e1 = await rejects(service.create({ name: "A", companyId: "co-x" }, "org-1"));
    expect(e1).toBeInstanceOf(NotFoundException);
    const e2 = await rejects(service.create({ name: "A", referredById: "c-x" }, "org-1"));
    expect(e2).toBeInstanceOf(NotFoundException);
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it("delete refuses contacts with a portal login", async () => {
    prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1", userId: "u-1" }));
    const e = await rejects(service.remove("c-1", "org-1"));
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as Error).message).toBe("Remove this client from the workspace first");
    expect(prisma.contact.delete).not.toHaveBeenCalled();
  });

  it("timeline merges notes and events newest first", async () => {
    prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
    prisma.contactNote.findMany.mockImplementation(() =>
      Promise.resolve([
        { id: "n1", content: "hi", authorId: "u1", createdAt: new Date("2026-01-03") },
        { id: "n2", content: "old", authorId: "u9", createdAt: new Date("2026-01-01") },
      ]),
    );
    prisma.contactEvent.findMany.mockImplementation(() =>
      Promise.resolve([
        { id: "e1", type: "contact_created", detail: "Created", createdAt: new Date("2026-01-02") },
      ]),
    );
    prisma.contactNote.count.mockImplementation(() => Promise.resolve(2));
    prisma.contactEvent.count.mockImplementation(() => Promise.resolve(1));
    prisma.user.findMany.mockImplementation(() => Promise.resolve([{ id: "u1", name: "Eve" }]));

    const res = await service.timeline("c-1", "org-1", 1, 20);
    expect(res.data.map((d) => d.id)).toEqual(["n1", "e1", "n2"]);
    expect(res.data[0]).toMatchObject({ kind: "note", author: { id: "u1", name: "Eve" } });
    expect(res.data[2]).toMatchObject({ author: { id: "u9", name: "Unknown" } });
    expect(res.meta.total).toBe(3);
  });

  it("controllers are owner/admin only at class level", () => {
    expect(Reflect.getMetadata(ROLES_KEY, ContactsController)).toEqual(["owner", "admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, CompaniesController)).toEqual(["owner", "admin"]);
  });
});
