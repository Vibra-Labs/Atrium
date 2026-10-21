import "reflect-metadata";
import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ConflictException, NotFoundException, BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { ContactsService } from "./contacts.service";
import { ContactsController } from "./contacts.controller";
import { CompaniesController } from "./companies.controller";
import type { ContactRevenueService } from "./contact-revenue.service";
import { parseCsv } from "./contacts-csv";
import type { ImportMapping } from "./contacts-csv";
import { planImport } from "./contacts-import";
import { ROLES_KEY } from "../common";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import {
  CreateContactDto,
  ListContactsQueryDto,
  TimelineQueryDto,
  UpdateContactDto,
  SetFollowUpDto,
  SnoozeFollowUpDto,
} from "./contacts.dto";

const prisma = {
  contact: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
    findMany: mock(() => Promise.resolve([] as unknown[])),
    count: mock(() => Promise.resolve(0)),
    create: mock((a: { data: Record<string, unknown> }) => Promise.resolve({ id: "c-1", ...a.data })),
    update: mock(() => Promise.resolve({ id: "c-1" })),
    updateMany: mock(() => Promise.resolve({ count: 1 })),
    delete: mock(() => Promise.resolve({})),
  },
  company: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
    create: mock(() => Promise.resolve({ id: "co-new" })),
    updateMany: mock(() => Promise.resolve({ count: 1 })),
  },
  leadSource: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
    create: mock(() => Promise.resolve({ id: "ls-new" })),
  },
  project: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  projectClient: { findFirst: mock(() => Promise.resolve(null as unknown)) },
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
  label: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
    create: mock((a: { data: { name: string } }) => Promise.resolve({ id: `l-${a.data.name}` })),
  },
  contactLabel: { createMany: mock(() => Promise.resolve({ count: 0 })) },
  user: { findMany: mock(() => Promise.resolve([] as unknown[])) },
  invitation: { findMany: mock(() => Promise.resolve([] as unknown[])) },
  member: { findFirst: mock(() => Promise.resolve(null as unknown)) },
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
  prisma.label.findFirst.mockImplementation(() => Promise.resolve(null));
  prisma.projectContact.findUnique.mockImplementation(() => Promise.resolve(null));
  prisma.projectClient.findFirst.mockImplementation(() => Promise.resolve(null));
  prisma.contactNote.findMany.mockImplementation(() => Promise.resolve([]));
  prisma.contactEvent.findMany.mockImplementation(() => Promise.resolve([]));
  prisma.contactNote.count.mockImplementation(() => Promise.resolve(0));
  prisma.contactEvent.count.mockImplementation(() => Promise.resolve(0));
  prisma.invitation.findMany.mockImplementation(() => Promise.resolve([]));
  prisma.member.findFirst.mockImplementation(() => Promise.resolve(null));
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

  it("timeline bounds the rows it fetches", async () => {
    prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
    const e = await rejects(service.timeline("c-1", "org-1", 51, 100));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(prisma.contactNote.findMany).not.toHaveBeenCalled();

    await service.timeline("c-1", "org-1", 50, 100);
    const arg = prisma.contactNote.findMany.mock.calls[0][0] as unknown as { take: number };
    expect(arg.take).toBe(5000);
  });

  it("TimelineQueryDto caps page at 50", async () => {
    expect((await validate(plainToInstance(TimelineQueryDto, { page: "51" }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(TimelineQueryDto, { page: "50", limit: "100" }))).length).toBe(0);
  });

  describe("company and lead source names", () => {
    for (const field of ["companyName", "leadSourceName"] as const) {
      it(`blank ${field} is a 400 on create and update`, async () => {
        const e1 = await rejects(service.create({ name: "Ann", [field]: "   " }, "org-1"));
        expect(e1).toBeInstanceOf(BadRequestException);
        expect((e1 as Error).message).toBe("Name is required");
        prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1", userId: null }));
        const e2 = await rejects(service.update("c-1", { [field]: " " }, "org-1"));
        expect(e2).toBeInstanceOf(BadRequestException);
        expect(prisma.contact.create).not.toHaveBeenCalled();
        expect(prisma.contact.update).not.toHaveBeenCalled();
        expect(prisma.company.create).not.toHaveBeenCalled();
        expect(prisma.leadSource.create).not.toHaveBeenCalled();
      });
    }

    it("companyName and leadSourceName are trimmed before lookup", async () => {
      await service.create({ name: "Ann", companyName: "  Acme ", leadSourceName: " Podcast " }, "org-1");
      expect(prisma.company.create).toHaveBeenCalledWith({ data: { organizationId: "org-1", name: "Acme" } });
      expect(prisma.leadSource.create).toHaveBeenCalledWith({ data: { organizationId: "org-1", name: "Podcast" } });
    });

    it("leadSourceName max length matches LeadSourceDto (100)", async () => {
      const ok = plainToInstance(CreateContactDto, { name: "A", leadSourceName: "x".repeat(100) });
      expect(await validate(ok)).toHaveLength(0);
      const tooLong = plainToInstance(CreateContactDto, { name: "A", leadSourceName: "x".repeat(101) });
      expect((await validate(tooLong)).length).toBeGreaterThan(0);
    });
  });

  describe("email of a contact with a portal login", () => {
    const linked = { id: "c-1", userId: "u-1", email: "bob@x.com" };

    it("changing it is a 400", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(linked));
      for (const email of ["new@x.com", null]) {
        const e = await rejects(service.update("c-1", { email }, "org-1"));
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as Error).message).toBe("This contact's email comes from their portal account");
      }
      expect(prisma.contact.update).not.toHaveBeenCalled();
    });

    it("resending the same email (any case) is allowed", async () => {
      prisma.contact.findFirst
        .mockImplementationOnce(() => Promise.resolve(linked)) // getOrThrow
        .mockImplementationOnce(() => Promise.resolve(null)); // assertEmailFree
      await service.update("c-1", { email: " Bob@X.com", name: "Bob" }, "org-1");
      expect(prisma.contact.update).toHaveBeenCalled();
    });

    it("a contact without a login can change email", async () => {
      prisma.contact.findFirst
        .mockImplementationOnce(() => Promise.resolve({ ...linked, userId: null }))
        .mockImplementationOnce(() => Promise.resolve(null));
      await service.update("c-1", { email: "new@x.com" }, "org-1");
      const arg = prisma.contact.update.mock.calls[0][0] as unknown as { data: { email: string } };
      expect(arg.data.email).toBe("new@x.com");
    });
  });

  describe("update clearing", () => {
    beforeEach(() => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
    });
    const updateData = (): Record<string, unknown> =>
      (prisma.contact.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;

    for (const field of ["email", "companyId", "leadSourceId", "referredById"] as const) {
      it(`null clears ${field}`, async () => {
        await service.update("c-1", { [field]: null }, "org-1");
        expect(updateData()[field]).toBeNull();
      });
    }

    it("undefined leaves the four fields alone", async () => {
      await service.update("c-1", { name: "New" }, "org-1");
      const data = updateData();
      for (const f of ["email", "companyId", "leadSourceId", "referredById"]) {
        expect(data[f]).toBeUndefined();
      }
    });

    it("DTO validation accepts null for the clearable fields", async () => {
      const dto = plainToInstance(UpdateContactDto, {
        email: null,
        companyId: null,
        leadSourceId: null,
        referredById: null,
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it("self-referral is a 400", async () => {
      const e = await rejects(service.update("c-1", { referredById: "c-1" }, "org-1"));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(prisma.contact.update).not.toHaveBeenCalled();
    });

    it("update and create do not expose profileImportedAt", async () => {
      prisma.contact.update.mockImplementation(() =>
        Promise.resolve({ id: "c-1", profileImportedAt: new Date() }),
      );
      expect(await service.update("c-1", { name: "x" }, "org-1")).not.toHaveProperty("profileImportedAt");
      prisma.contact.create.mockImplementation(() =>
        Promise.resolve({ id: "c-1", profileImportedAt: new Date() }),
      );
      expect(await service.create({ name: "x" }, "org-1")).not.toHaveProperty("profileImportedAt");
    });
  });

  describe("contact fields", () => {
    const createData = (): Record<string, unknown> =>
      (prisma.contact.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    const updateData = (): Record<string, unknown> =>
      (prisma.contact.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    const stored = {
      id: "c-1",
      name: "Ann Lee",
      firstName: "Ann",
      lastName: "Lee",
      phone: "111",
      phones: [
        { label: "Mobile", number: "111" },
        { label: "Work", number: "222" },
      ],
    };

    it("create stores first/last, title, department, phones, links and rating", async () => {
      await service.create(
        {
          firstName: "Ann",
          lastName: "Lee",
          jobTitle: " CTO ",
          department: "Engineering",
          phones: [
            { label: "Mobile", number: "+1 555" },
            { label: "Work", number: "+1 777" },
          ],
          socialLinks: ["https://linkedin.com/in/ann", " https://linkedin.com/in/ann "],
          rating: "hot",
        },
        "org-1",
      );
      expect(createData()).toMatchObject({
        name: "Ann Lee",
        firstName: "Ann",
        lastName: "Lee",
        jobTitle: "CTO",
        department: "Engineering",
        phone: "+1 555",
        phones: [
          { label: "Mobile", number: "+1 555" },
          { label: "Work", number: "+1 777" },
        ],
        socialLinks: ["https://linkedin.com/in/ann"],
        rating: "hot",
      });
    });

    it("create with only a name splits it; with neither name nor first name is a 400", async () => {
      await service.create({ name: "Ann Marie Lee" }, "org-1");
      expect(createData()).toMatchObject({ name: "Ann Marie Lee", firstName: "Ann", lastName: "Marie Lee" });

      const e = await rejects(service.create({ lastName: "Lee" }, "org-1"));
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as Error).message).toBe("Name is required");
    });

    it("create with a legacy phone fills phones", async () => {
      await service.create({ name: "Ann", phone: "555" }, "org-1");
      expect(createData()).toMatchObject({ phone: "555", phones: [{ label: "Phone", number: "555" }] });
    });

    it("create rejects a non-http(s) social link before writing", async () => {
      const e = await rejects(service.create({ name: "Ann", socialLinks: ["javascript:alert(1)"] }, "org-1"));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(prisma.contact.create).not.toHaveBeenCalled();
    });

    it("update merges a new last name with the stored first name", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(stored));
      await service.update("c-1", { lastName: "Park" }, "org-1");
      expect(updateData()).toMatchObject({ name: "Ann Park", firstName: "Ann", lastName: "Park" });
    });

    it("update can clear the last name but not the first", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(stored));
      await service.update("c-1", { lastName: null }, "org-1");
      expect(updateData()).toMatchObject({ name: "Ann", firstName: "Ann", lastName: null });

      const e = await rejects(service.update("c-1", { firstName: "" }, "org-1"));
      expect(e).toBeInstanceOf(BadRequestException);
    });

    it("update with only a name re-splits it", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(stored));
      await service.update("c-1", { name: "Bo Diddley" }, "org-1");
      expect(updateData()).toMatchObject({ name: "Bo Diddley", firstName: "Bo", lastName: "Diddley" });
    });

    it("update with a legacy phone replaces the first number and keeps the mirror", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(stored));
      await service.update("c-1", { phone: "999" }, "org-1");
      expect(updateData()).toMatchObject({
        phone: "999",
        phones: [
          { label: "Mobile", number: "999" },
          { label: "Work", number: "222" },
        ],
      });
    });

    it("update with phones mirrors the first number; leaving both out leaves phones alone", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(stored));
      await service.update("c-1", { phones: [] }, "org-1");
      expect(updateData()).toMatchObject({ phone: null, phones: [] });

      prisma.contact.update.mockClear();
      await service.update("c-1", { status: "client" }, "org-1");
      expect(updateData().phones).toBeUndefined();
      expect(updateData().phone).toBeUndefined();
      expect(updateData().name).toBeUndefined();
    });

    it("update clears rating, job title and social links with null", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(stored));
      await service.update("c-1", { rating: null, jobTitle: null, socialLinks: null }, "org-1");
      expect(updateData()).toMatchObject({ rating: null, jobTitle: null, socialLinks: [] });
    });

    it("DTOs: create needs no name; rating must be hot/warm/cold; phones are objects", async () => {
      expect(await validate(plainToInstance(CreateContactDto, { firstName: "Ann" }))).toHaveLength(0);
      expect(await validate(plainToInstance(UpdateContactDto, { rating: "hot" }))).toHaveLength(0);
      expect(await validate(plainToInstance(UpdateContactDto, { rating: null }))).toHaveLength(0);
      expect(await validate(plainToInstance(UpdateContactDto, { rating: "lukewarm" }))).not.toHaveLength(0);
      expect(
        await validate(plainToInstance(UpdateContactDto, { phones: [{ label: "Work", number: "1" }] })),
      ).toHaveLength(0);
      expect(await validate(plainToInstance(UpdateContactDto, { phones: ["555"] }))).not.toHaveLength(0);
      expect(await validate(plainToInstance(UpdateContactDto, { socialLinks: [1] }))).not.toHaveLength(0);
      expect(await validate(plainToInstance(ListContactsQueryDto, { rating: "cold" }))).toHaveLength(0);
      expect(await validate(plainToInstance(ListContactsQueryDto, { rating: "x" }))).not.toHaveLength(0);
    });

    it("a contact the backfill hasn't reached shows its legacy phone, and an edit round trip keeps it", async () => {
      const legacy = { id: "c-1", name: "Ann", firstName: null, lastName: null, phone: "555", phones: [] };
      prisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve({ ...legacy, labels: [], projects: [] }),
      );
      const shown = await service.findOne("c-1", "org-1");
      expect(shown.phones).toEqual([{ label: "Phone", number: "555" }]);

      // The edit form sends back what it was shown, plus an unrelated change.
      await service.update("c-1", { phones: shown.phones, jobTitle: "CTO" }, "org-1");
      expect(updateData()).toMatchObject({ phone: "555", phones: [{ label: "Phone", number: "555" }] });

      prisma.contact.findMany.mockImplementation(() =>
        Promise.resolve([{ ...legacy, company: null, labels: [], status: "lead" }]),
      );
      expect((await service.findAll("org-1", {})).data[0].phones).toEqual([{ label: "Phone", number: "555" }]);
    });

    it("DTOs: first/last names at most 99 chars each (joined name stays within 200), at most 50 links", async () => {
      const errors = (body: object): Promise<number> =>
        validate(plainToInstance(UpdateContactDto, body)).then((e) => e.length);
      expect(await errors({ firstName: "a".repeat(99), lastName: "b".repeat(99) })).toBe(0);
      expect(await errors({ firstName: "a".repeat(100) })).toBe(1);
      expect(await errors({ lastName: "b".repeat(100) })).toBe(1);
      expect(await errors({ socialLinks: Array.from({ length: 50 }, () => "https://x.com/a") })).toBe(0);
      expect(await errors({ socialLinks: Array.from({ length: 51 }, () => "https://x.com/a") })).toBe(1);
    });

    it("list filters by rating and returns the new fields", async () => {
      prisma.contact.findMany.mockImplementation(() =>
        Promise.resolve([
          {
            ...stored,
            email: null,
            status: "lead",
            jobTitle: "CTO",
            department: "Eng",
            socialLinks: ["https://x.com/ann"],
            rating: "hot",
            company: null,
            followUpAt: null,
            followUpEveryDays: null,
            userId: null,
            labels: [],
          },
        ]),
      );
      const res = await service.findAll("org-1", { rating: "hot" });
      const arg = prisma.contact.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(arg.where).toMatchObject({ organizationId: "org-1", rating: "hot" });
      expect(res.data[0]).toMatchObject({
        firstName: "Ann",
        lastName: "Lee",
        jobTitle: "CTO",
        department: "Eng",
        phones: stored.phones,
        socialLinks: ["https://x.com/ann"],
        rating: "hot",
      });
    });
  });

  describe("portal access", () => {
    const now = new Date();
    const row = (over: Record<string, unknown>): Record<string, unknown> => ({
      id: "c",
      name: "N",
      email: null,
      status: "lead",
      phones: [],
      socialLinks: [],
      company: null,
      labels: [],
      userId: null,
      ...over,
    });

    function whereOf(): Record<string, unknown> {
      return (prisma.contact.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    }

    it("pending invite emails come from open, unexpired client invitations, lowercased", async () => {
      prisma.invitation.findMany.mockImplementation(() =>
        Promise.resolve([{ email: "Ann@X.com" }, { email: "ann@x.com " }, { email: "bo@x.com" }]),
      );
      expect(await service.pendingInviteEmails("org-1", now)).toEqual(["ann@x.com", "bo@x.com"]);
      expect(prisma.invitation.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", role: "member", status: "pending", expiresAt: { gt: now } },
        select: { email: true },
      });
    });

    it("access=portal lists contacts with a portal login", async () => {
      await service.findAll("org-1", { access: "portal" });
      expect(whereOf()).toEqual({ organizationId: "org-1", userId: { not: null } });
    });

    it("access=pending lists contacts without a login whose email has an open invite", async () => {
      prisma.invitation.findMany.mockImplementation(() => Promise.resolve([{ email: "Ann@X.com" }]));
      await service.findAll("org-1", { access: "pending" });
      expect(whereOf()).toEqual({ organizationId: "org-1", userId: null, email: { in: ["ann@x.com"] } });
    });

    it("access=none excludes logins and pending invites but keeps contacts without an email", async () => {
      prisma.invitation.findMany.mockImplementation(() => Promise.resolve([{ email: "ann@x.com" }]));
      await service.findAll("org-1", { access: "none" });
      expect(whereOf()).toEqual({
        organizationId: "org-1",
        userId: null,
        AND: [{ OR: [{ email: null }, { email: { notIn: ["ann@x.com"] } }] }],
      });
    });

    it("access=pending with a search keeps both conditions", async () => {
      prisma.invitation.findMany.mockImplementation(() => Promise.resolve([{ email: "ann@x.com" }]));
      await service.findAll("org-1", { access: "pending", search: "ann" });
      expect(whereOf()).toEqual({
        organizationId: "org-1",
        userId: null,
        email: { in: ["ann@x.com"] },
        OR: [
          { name: { contains: "ann", mode: "insensitive" } },
          { email: { contains: "ann", mode: "insensitive" } },
          { company: { name: { contains: "ann", mode: "insensitive" } } },
        ],
      });
    });

    it("access=none with a search keeps both conditions", async () => {
      prisma.invitation.findMany.mockImplementation(() => Promise.resolve([{ email: "ann@x.com" }]));
      await service.findAll("org-1", { access: "none", search: "bo" });
      const where = whereOf();
      expect(where.AND).toEqual([{ OR: [{ email: null }, { email: { notIn: ["ann@x.com"] } }] }]);
      expect(where.OR).toHaveLength(3);
      expect(where.userId).toBeNull();
    });

    it("access=none with no open invites is just 'no login'", async () => {
      await service.findAll("org-1", { access: "none" });
      expect(whereOf()).toEqual({ organizationId: "org-1", userId: null });
    });

    it("rows carry a portal / pending badge", async () => {
      prisma.invitation.findMany.mockImplementation(() => Promise.resolve([{ email: "BO@x.com" }]));
      prisma.contact.findMany.mockImplementation(() =>
        Promise.resolve([
          row({ id: "a", userId: "u-1", email: "a@x.com" }),
          row({ id: "b", email: "bo@x.com" }),
          row({ id: "c", email: "cy@x.com" }),
          row({ id: "d" }),
        ]),
      );
      const res = await service.findAll("org-1", {});
      expect(res.data.map((c) => c.portalAccess)).toEqual(["portal", "pending", null, null]);
    });

    it("ListContactsQueryDto accepts only portal / pending / none", async () => {
      for (const access of ["portal", "pending", "none"]) {
        expect(await validate(plainToInstance(ListContactsQueryDto, { access }))).toHaveLength(0);
      }
      expect(await validate(plainToInstance(ListContactsQueryDto, { access: "all" }))).not.toHaveLength(0);
    });

    it("findOne exposes the client membership for a contact with a login", async () => {
      const joinedAt = new Date("2026-01-02T00:00:00Z");
      prisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve(row({ userId: "u-1", projects: [], labels: [] })),
      );
      prisma.member.findFirst.mockImplementation(() =>
        Promise.resolve({ id: "m-1", createdAt: joinedAt, lastSeenAt: null }),
      );
      const res = await service.findOne("c", "org-1");
      expect(prisma.member.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", userId: "u-1", role: "member" },
        select: { id: true, createdAt: true, lastSeenAt: true },
      });
      expect(res.portal).toEqual({ memberId: "m-1", joinedAt, lastSeenAt: null });
    });

    it("findOne has no portal info for a contact without a login", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(row({ projects: [], labels: [] })));
      const res = await service.findOne("c", "org-1");
      expect(res.portal).toBeNull();
      expect(prisma.member.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("sorting", () => {
    const row = (id: string, name: string): Record<string, unknown> => ({
      id,
      name,
      email: null,
      status: "lead",
      phones: [],
      socialLinks: [],
      company: null,
      labels: [],
      userId: null,
    });

    function orderByOf(): unknown {
      return (prisma.contact.findMany.mock.calls[0][0] as { orderBy: unknown }).orderBy;
    }

    it("defaults to name A-Z with id as a tiebreaker", async () => {
      await service.findAll("org-1", {});
      expect(orderByOf()).toEqual([{ name: "asc" }, { id: "asc" }]);
    });

    it("sorts by status in pipeline order and by company with blanks last, across pages", async () => {
      const rows = [
        { id: "p", name: "Pat", status: "past_client", followUpAt: null, company: { name: "Zeta" } },
        { id: "c", name: "Cy", status: "client", followUpAt: null, company: null },
        { id: "l", name: "Lu", status: "lead", followUpAt: null, company: { name: "acme" } },
      ];
      prisma.contact.findMany.mockImplementation((args: unknown) => {
        const a = args as { select?: unknown; where: { id?: { in: string[] } } };
        if (a.select) return Promise.resolve(rows);
        return Promise.resolve((a.where.id?.in ?? []).map((id) => row(id, id)));
      });
      const ids = async (query: ListContactsQueryDto): Promise<string[]> =>
        (await service.findAll("org-1", query)).data.map((c) => c.id);
      expect(await ids({ sort: "status" })).toEqual(["l", "c", "p"]);
      expect(await ids({ sort: "status", dir: "desc" })).toEqual(["p", "c", "l"]);
      expect(await ids({ sort: "company" })).toEqual(["l", "p", "c"]);
      expect(await ids({ sort: "company", dir: "desc" })).toEqual(["p", "l", "c"]);
      prisma.contact.findMany.mockImplementation(() => Promise.resolve([]));
    });

    it("sorts by name and follow-up in the database", async () => {
      const cases: [ListContactsQueryDto, unknown][] = [
        [{ sort: "name", dir: "desc" }, [{ name: "desc" }, { id: "asc" }]],
        // Contacts without a follow-up always go last.
        [
          { sort: "followUp" },
          [{ followUpAt: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
        ],
      ];
      for (const [query, expected] of cases) {
        prisma.contact.findMany.mockClear();
        await service.findAll("org-1", query);
        expect(orderByOf()).toEqual(expected);
      }
    });

    it("sorts by paid total across every page, highest first, ties by name", async () => {
      prisma.contact.findMany.mockImplementation((args: unknown) => {
        const a = args as { select?: unknown; where: { id?: { in: string[] } } };
        if (a.select) {
          return Promise.resolve([
            { id: "a", name: "Ann" },
            { id: "b", name: "Bo" },
            { id: "c", name: "Cy" },
            { id: "d", name: "Al" },
          ]);
        }
        const ids = a.where.id?.in ?? [];
        return Promise.resolve(ids.map((id) => row(id, id)));
      });
      revenue.paidTotals.mockImplementation(() =>
        Promise.resolve(
          new Map([
            ["b", 500],
            ["c", 900],
          ]),
        ),
      );
      prisma.contact.count.mockImplementation(() => Promise.resolve(4));

      const first = await service.findAll("org-1", { sort: "paid", dir: "desc", limit: 3 });
      // Whole workspace in one query rather than a huge id list.
      expect(revenue.paidTotals).toHaveBeenCalledWith(null, "org-1");
      expect(first.data.map((c) => c.id)).toEqual(["c", "b", "d"]);
      expect(first.data.map((c) => c.paidCents)).toEqual([900, 500, 0]);
      expect(first.meta.total).toBe(4);

      const second = await service.findAll("org-1", { sort: "paid", dir: "desc", limit: 3, page: 2 });
      expect(second.data.map((c) => c.id)).toEqual(["a"]);

      const asc = await service.findAll("org-1", { sort: "paid", dir: "asc", limit: 3 });
      expect(asc.data.map((c) => c.id)).toEqual(["d", "a", "b"]);
      prisma.contact.count.mockImplementation(() => Promise.resolve(0));
      prisma.contact.findMany.mockImplementation(() => Promise.resolve([]));
      revenue.paidTotals.mockImplementation(() => Promise.resolve(new Map<string, number>()));
    });

    it("ListContactsQueryDto accepts only known sorts and directions", async () => {
      expect(await validate(plainToInstance(ListContactsQueryDto, { sort: "paid", dir: "desc" }))).toHaveLength(0);
      expect(await validate(plainToInstance(ListContactsQueryDto, { sort: "email" }))).not.toHaveLength(0);
      expect(await validate(plainToInstance(ListContactsQueryDto, { dir: "up" }))).not.toHaveLength(0);
    });
  });

  describe("About (description)", () => {
    it("is stored trimmed; blank or null clears it to an empty string", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1", phones: [] }));
      await service.update("c-1", { description: "  Bakery  " }, "org-1");
      await service.update("c-1", { description: null }, "org-1");
      await service.update("c-1", { description: "   " }, "org-1");
      await service.update("c-1", { jobTitle: "CTO" }, "org-1");
      const data = prisma.contact.update.mock.calls.map(
        (c) => (c as unknown as [{ data: { description?: string } }])[0].data.description,
      );
      expect(data).toEqual(["Bakery", "", "", undefined]);
    });

    it("DTO caps it at 2000 characters", async () => {
      const errors = (description: string): Promise<number> =>
        validate(plainToInstance(UpdateContactDto, { description })).then((e) => e.length);
      expect(await errors("a".repeat(2000))).toBe(0);
      expect(await errors("a".repeat(2001))).toBe(1);
    });
  });

  describe("portal self-service profile", () => {
    const contact = {
      id: "c-1",
      organizationId: "org-1",
      phone: "111",
      phones: [{ label: "Work", number: "111" }, { label: "Home", number: "222" }],
      address: "Old St",
      website: "",
      description: null,
      companyId: null,
      company: null,
    };

    function written(): Record<string, unknown> {
      return (prisma.contact.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    }

    it("reads the contact as the old profile shape", async () => {
      prisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve({ ...contact, company: { name: "Acme" }, description: "" }),
      );
      expect(await service.portalProfile("c-1", "org-1")).toEqual({
        company: "Acme",
        phone: "111",
        address: "Old St",
        website: null,
        description: null,
      });
    });

    it("maps company (find-or-create), phone (first number), address, website and description", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(contact));
      await service.updatePortalProfile(
        "c-1",
        { company: " Acme ", phone: " 999 ", address: " New St ", website: "", description: " Bakery " },
        "org-1",
      );
      expect(prisma.company.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", name: { equals: "Acme", mode: "insensitive" } },
      });
      expect(written()).toEqual({
        companyId: "co-new",
        phone: "999",
        phones: [{ label: "Work", number: "999" }, { label: "Home", number: "222" }],
        address: "New St",
        website: null,
        description: "Bakery",
      });
    });

    it("a blank company unlinks it and fields left out are untouched", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ ...contact, companyId: "co-1", company: { name: "Acme" } }));
      await service.updatePortalProfile("c-1", { company: "  " }, "org-1");
      expect(written()).toEqual({ companyId: null });
      expect(prisma.company.create).not.toHaveBeenCalled();
    });

    it("never writes CRM-only fields, whatever the input carries", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(contact));
      const input = {
        company: "Acme",
        status: "past_client",
        rating: "cold",
        leadSourceId: "ls-1",
        followUpAt: "2026-01-01",
        email: "x@y.com",
      } as unknown as Parameters<ContactsService["updatePortalProfile"]>[1];
      await service.updatePortalProfile("c-1", input, "org-1");
      expect(Object.keys(written()).sort()).toEqual(["companyId"]);
    });

    it("sending the shown values back changes nothing", async () => {
      prisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve({ ...contact, companyId: "co-1", company: { name: "Acme" } }),
      );
      await service.updatePortalProfile("c-1", { company: "acme", phone: "111" }, "org-1");
      expect(written()).toEqual({});
      expect(prisma.company.findFirst).not.toHaveBeenCalled();
    });

    it("404s for a contact outside the org", async () => {
      const e = await rejects(service.updatePortalProfile("c-x", { company: "A" }, "org-1"));
      expect(e).toBeInstanceOf(NotFoundException);
    });
  });

  it("unlinkProject refuses while the contact's user is a client on the project", async () => {
    prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1", userId: "u-1" }));
    prisma.projectClient.findFirst.mockImplementation(() => Promise.resolve({ projectId: "p-1", userId: "u-1" }));
    const e = await rejects(service.unlinkProject("c-1", "p-1", "org-1"));
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as Error).message).toBe("Remove them as a client on the project first");
    expect(prisma.projectClient.findFirst).toHaveBeenCalledWith({
      where: { projectId: "p-1", userId: "u-1", project: { organizationId: "org-1" } },
    });
    expect(prisma.projectContact.deleteMany).not.toHaveBeenCalled();
  });

  it("unlinkProject removes the link when the user is not a client on the project", async () => {
    prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1", userId: "u-1" }));
    await service.unlinkProject("c-1", "p-1", "org-1");
    expect(prisma.projectContact.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "c-1", projectId: "p-1", project: { organizationId: "org-1" } },
    });
  });

  it("unlinkProject skips the client check for a contact without a portal user", async () => {
    prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1", userId: null }));
    await service.unlinkProject("c-1", "p-1", "org-1");
    expect(prisma.projectClient.findFirst).not.toHaveBeenCalled();
    expect(prisma.projectContact.deleteMany).toHaveBeenCalled();
  });

  it("linkProject returns quietly when a concurrent link wins (P2002)", async () => {
    prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
    prisma.project.findFirst.mockImplementation(() => Promise.resolve({ id: "p-1", name: "Site" }));
    prisma.projectContact.create.mockImplementationOnce(() => Promise.reject({ code: "P2002" }));
    await service.linkProject("c-1", "p-1", "org-1");
    expect(prisma.contactEvent.create).not.toHaveBeenCalled();
  });

  it("controllers are owner/admin only at class level", () => {
    expect(Reflect.getMetadata(ROLES_KEY, ContactsController)).toEqual(["owner", "admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, CompaniesController)).toEqual(["owner", "admin"]);
  });

  describe("follow-ups", () => {
    const NOW = new Date("2026-10-20T15:30:00Z");
    const lastUpdate = (): { data: Record<string, unknown> } =>
      prisma.contact.update.mock.calls[0][0] as { data: Record<string, unknown> };

    it("done on repeating moves the previous date forward by the interval, keeping its time", async () => {
      // Local midnight in New York (EDT) for Oct 20.
      prisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve({ id: "c-1", followUpEveryDays: 30, followUpAt: new Date("2026-10-20T04:00:00Z") }),
      );
      await service.completeFollowUp("c-1", "org-1", NOW);
      expect(lastUpdate().data.followUpAt).toEqual(new Date("2026-11-19T04:00:00Z"));
      expect(lastUpdate().data.followUpEveryDays).toBe(30);
      expect(lastUpdate().data.followUpNotifiedAt).toBeNull();
    });

    it("done on a date-only (noon UTC) follow-up keeps it at noon UTC on the next date", async () => {
      prisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve({ id: "c-1", followUpEveryDays: 30, followUpAt: new Date("2026-10-20T12:00:00.000Z") }),
      );
      await service.completeFollowUp("c-1", "org-1", NOW);
      expect(lastUpdate().data.followUpAt).toEqual(new Date("2026-11-19T12:00:00.000Z"));
    });

    it("done on an overdue repeating follow-up skips ahead until it is after now", async () => {
      prisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve({ id: "c-1", followUpEveryDays: 14, followUpAt: new Date("2026-09-01T04:00:00Z") }),
      );
      await service.completeFollowUp("c-1", "org-1", NOW);
      // Sep 1 + 14 = Sep 15, Sep 29, Oct 13, Oct 27 (first after Oct 20 15:30Z).
      expect(lastUpdate().data.followUpAt).toEqual(new Date("2026-10-27T04:00:00Z"));
    });

    it("done on a repeating follow-up with no date falls back to noon UTC today + interval", async () => {
      prisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve({ id: "c-1", followUpEveryDays: 30, followUpAt: null }),
      );
      await service.completeFollowUp("c-1", "org-1", NOW);
      expect(lastUpdate().data.followUpAt).toEqual(new Date("2026-11-19T12:00:00.000Z"));
    });

    it("done on one-off clears", async () => {
      prisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve({ id: "c-1", followUpEveryDays: null }),
      );
      await service.completeFollowUp("c-1", "org-1", NOW);
      expect(lastUpdate().data.followUpAt).toBeNull();
      expect(lastUpdate().data.followUpEveryDays).toBeNull();
    });

    it("snooze moves to noon UTC of today + days and resets notified", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
      await service.snoozeFollowUp("c-1", 3, "org-1", NOW);
      expect(lastUpdate().data.followUpAt).toEqual(new Date("2026-10-23T12:00:00.000Z"));
      expect(lastUpdate().data.followUpNotifiedAt).toBeNull();
    });

    it("set records the current user as owner and resets notified", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
      await service.setFollowUp("c-1", { followUpAt: "2026-11-01T00:00:00Z", everyDays: 14 }, "org-1", "u-1");
      expect(lastUpdate().data).toMatchObject({
        followUpOwnerId: "u-1",
        followUpEveryDays: 14,
        followUpNotifiedAt: null,
      });
    });

    it("set stores a plain date at noon UTC and keeps a full ISO timestamp as sent", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
      await service.setFollowUp("c-1", { followUpAt: "2026-11-01" }, "org-1", "u-1");
      expect(lastUpdate().data.followUpAt).toEqual(new Date("2026-11-01T12:00:00.000Z"));
      prisma.contact.update.mockClear();
      await service.setFollowUp("c-1", { followUpAt: "2026-11-01T05:00:00Z" }, "org-1", "u-1");
      expect(lastUpdate().data.followUpAt).toEqual(new Date("2026-11-01T05:00:00Z"));
    });

    it("SetFollowUpDto accepts a plain date or a full ISO timestamp", async () => {
      for (const followUpAt of ["2026-11-01", "2026-11-01T05:00:00Z"]) {
        expect(await validate(plainToInstance(SetFollowUpDto, { followUpAt }))).toHaveLength(0);
      }
      expect((await validate(plainToInstance(SetFollowUpDto, { followUpAt: "11/01/2026" }))).length).toBeGreaterThan(0);
    });

    it("set with null clears everything; unknown contact is 404", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
      await service.setFollowUp("c-1", { followUpAt: null }, "org-1", "u-1");
      expect(lastUpdate().data).toMatchObject({ followUpAt: null, followUpEveryDays: null, followUpOwnerId: null });
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(null));
      expect(await rejects(service.snoozeFollowUp("x", 1, "org-1"))).toBeInstanceOf(NotFoundException);
    });

    it("DTOs only accept preset repeat and snooze days", async () => {
      expect((await validate(plainToInstance(SnoozeFollowUpDto, { days: 2 }))).length).toBeGreaterThan(0);
      expect((await validate(plainToInstance(SnoozeFollowUpDto, { days: 7 }))).length).toBe(0);
      const badRepeat = plainToInstance(SetFollowUpDto, { followUpAt: "2026-11-01T00:00:00Z", everyDays: 10 });
      expect((await validate(badRepeat)).length).toBeGreaterThan(0);
      const cleared = plainToInstance(SetFollowUpDto, { followUpAt: null, everyDays: null });
      expect((await validate(cleared)).length).toBe(0);
    });
  });

  describe("CSV import/export", () => {
    const mapping = {
      Name: "name",
      Email: "email",
      Company: "company",
      Source: "source",
      Tags: "tags",
      Notes: "notes",
    } as const;

    it("import skips existing email case-insensitively and duplicates within the file", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "x" }));
      const csv = "Name,Email\nAnn,ANN@Example.com\n";
      const res = await service.importCsv({ csv, mapping: { Name: "name", Email: "email" } }, "org-1", "u-1");
      expect(res).toEqual({ created: 0, skipped: [{ row: 2, reason: "Email already exists" }], warnings: [] });
      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", email: "ann@example.com" },
      });

      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(null));
      const dup = "Name,Email\nAnn,a@x.com\nAnn2,A@X.com\n";
      const res2 = await service.importCsv({ csv: dup, mapping: { Name: "name", Email: "email" } }, "org-1", "u-1");
      expect(res2).toEqual({ created: 1, skipped: [{ row: 3, reason: "Email already exists" }], warnings: [] });
    });

    it("import skips rows with no name and keeps going", async () => {
      const csv = "Name,Email\n,a@x.com\nBob,b@x.com\n";
      const res = await service.importCsv({ csv, mapping: { Name: "name", Email: "email" } }, "org-1", "u-1");
      expect(res).toEqual({ created: 1, skipped: [{ row: 2, reason: "Missing name" }], warnings: [] });
      expect(prisma.contactEvent.create).toHaveBeenCalledTimes(1);
    });

    it("import find-or-creates company, source and tags, and stores notes", async () => {
      const csv = "Name,Email,Company,Source,Tags,Notes\nAnn,a@x.com,Acme,Podcast,vip; hot,Met at expo\n";
      const res = await service.importCsv({ csv, mapping }, "org-1", "u-1");
      expect(res.created).toBe(1);
      expect(prisma.company.create).toHaveBeenCalledTimes(1);
      expect(prisma.leadSource.create).toHaveBeenCalledTimes(1);
      expect(prisma.label.create).toHaveBeenCalledTimes(2);
      expect(prisma.contactLabel.createMany).toHaveBeenCalledWith({
        data: [
          { contactId: "c-1", labelId: "l-vip" },
          { contactId: "c-1", labelId: "l-hot" },
        ],
        skipDuplicates: true,
      });
      expect(prisma.contactNote.create).toHaveBeenCalledWith({
        data: { contactId: "c-1", organizationId: "org-1", authorId: "u-1", content: "Met at expo" },
      });
    });

    it("import truncates the source name to the lead source limit (100)", async () => {
      const csv = `Name,Source\nAnn,${"s".repeat(150)}\n`;
      await service.importCsv({ csv, mapping: { Name: "name", Source: "source" } }, "org-1", "u-1");
      expect(prisma.leadSource.create).toHaveBeenCalledWith({
        data: { organizationId: "org-1", name: "s".repeat(100) },
      });
    });

    it("import parses status case-insensitively, defaulting to lead", async () => {
      const csv = "Name,Status\nA,CLIENT\nB,Past Client\nC,\n";
      await service.importCsv({ csv, mapping: { Name: "name", Status: "status" } }, "org-1", "u-1");
      const statuses = prisma.contact.create.mock.calls.map(
        (c) => (c[0] as { data: { status: string } }).data.status,
      );
      expect(statuses).toEqual(["client", "past_client", "lead"]);
    });

    it("import stores every phone column, the follow-up, the referrer and fills an empty company size", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-bo", name: "Bo" }));
      prisma.contact.create.mockImplementation((a: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "c-1", ...a.data }),
      );
      const csv = [
        "Name,Mobile,Work Phone,Company,Referred by,Follow up,Revenue,Employees",
        "Ann,+1 555 0100,+1 555 0200,Acme,bo@x.com,2026-11-05,1000,12",
      ].join("\n");
      const res = await service.importCsv(
        {
          csv,
          mapping: {
            Name: "name",
            Mobile: "phone",
            "Work Phone": "phone",
            Company: "company",
            "Referred by": "referredBy",
            "Follow up": "followUpAt",
            Revenue: "companyRevenue",
            Employees: "companyEmployees",
          },
        },
        "org-1",
        "u-1",
      );
      expect(res).toEqual({ created: 1, skipped: [], warnings: [] });
      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", email: "bo@x.com" },
        select: { id: true },
      });
      const data = (prisma.contact.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data).toMatchObject({
        referredById: "c-bo",
        phone: "+1 555 0100",
        phones: [
          { label: "Mobile", number: "+1 555 0100" },
          { label: "Work", number: "+1 555 0200" },
        ],
      });
      expect(prisma.contact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            followUpAt: new Date("2026-11-05T12:00:00.000Z"),
            followUpOwnerId: "u-1",
          }),
        }),
      );
      expect(prisma.company.updateMany).toHaveBeenCalledWith({
        where: { id: "co-new", organizationId: "org-1", annualRevenue: null },
        data: { annualRevenue: 1000 },
      });
      expect(prisma.company.updateMany).toHaveBeenCalledWith({
        where: { id: "co-new", organizationId: "org-1", employeeCount: null },
        data: { employeeCount: 12 },
      });
    });

    it("import saves each extra on its own: a failed tag save warns but the follow-up and company size still land", async () => {
      prisma.contact.create.mockImplementation((a: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "c-1", ...a.data }),
      );
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
      prisma.label.findFirst.mockImplementation(() => Promise.reject(new Error("db down")));
      const csv = "Name,Company,Tags,Follow up,Employees\nAnn,Acme,vip,2099-01-02,12\n";
      const res = await service.importCsv(
        {
          csv,
          mapping: { Name: "name", Company: "company", Tags: "tags", "Follow up": "followUpAt", Employees: "companyEmployees" },
        },
        "org-1",
        "u-1",
      );
      expect(res.created).toBe(1);
      expect(res.warnings).toEqual([{ row: 2, reason: "Tags couldn't be saved" }]);
      expect(prisma.contact.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ followUpAt: new Date("2099-01-02T12:00:00.000Z") }) }),
      );
      expect(prisma.company.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { employeeCount: 12 } }),
      );
      prisma.label.findFirst.mockImplementation(() => Promise.resolve(null));
    });

    it("import keeps a past follow-up as overdue without sending a reminder for it", async () => {
      prisma.contact.create.mockImplementation((a: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "c-1", ...a.data }),
      );
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
      const csv = "Name,Follow up\nAnn,2020-01-02\n";
      await service.importCsv({ csv, mapping: { Name: "name", "Follow up": "followUpAt" } }, "org-1", "u-1");
      expect(prisma.contact.updateMany).toHaveBeenCalledWith({
        where: { id: "c-1", organizationId: "org-1" },
        data: { followUpNotifiedAt: expect.any(Date) },
      });
    });

    it("an unexpected failure on one row doesn't make a later row with the same email a duplicate", async () => {
      let calls = 0;
      prisma.contact.create.mockImplementation((a: { data: Record<string, unknown> }) => {
        calls++;
        return calls === 1 ? Promise.reject(new Error("boom")) : Promise.resolve({ id: "c-2", ...a.data });
      });
      const csv = "Name,Email\nAnn,a@x.com\nAnn again,a@x.com\nAnn third,A@x.com\n";
      const res = await service.importCsv({ csv, mapping: { Name: "name", Email: "email" } }, "org-1", "u-1");
      expect(res.created).toBe(1);
      expect(res.skipped).toEqual([
        { row: 2, reason: "Invalid row" },
        { row: 4, reason: "Email already exists" },
      ]);
      prisma.contact.create.mockImplementation((a: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "c-1", ...a.data }),
      );
    });

    it("check skips a repeated email in the file, like the import", async () => {
      const csv = "Name,Email\nAnn,a@x.com\nAnn2,A@X.com\n";
      const res = await service.checkImport({ csv, mapping: { Name: "name", Email: "email" } }, "org-1");
      expect(res.toCreate).toBe(1);
      expect(res.skipped).toEqual([{ row: 3, reason: "Email already exists" }]);
    });

    it("import leaves out a referrer it can't find or that matches several contacts", async () => {
      prisma.contact.findMany.mockImplementation((args: unknown) => {
        const name = (args as { where: { name?: { equals: string } } }).where.name?.equals;
        return Promise.resolve(name === "Sam" ? [{ id: "s1" }, { id: "s2" }] : []);
      });
      const csv = "Name,Referred by\nAnn,Nobody\nBo,Sam\n";
      const res = await service.importCsv(
        { csv, mapping: { Name: "name", "Referred by": "referredBy" } },
        "org-1",
        "u-1",
      );
      expect(res.created).toBe(2);
      expect(res.warnings).toEqual([
        { row: 2, reason: 'Referred by "Nobody" matches no contact; left out' },
        { row: 3, reason: 'Referred by "Sam" matches several contacts; left out' },
      ]);
      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", name: { equals: "Sam", mode: "insensitive" } },
        select: { id: true },
        take: 2,
      });
      prisma.contact.findMany.mockImplementation(() => Promise.resolve([]));
    });

    it("check previews the import without writing, including existing emails and unknown referrers", async () => {
      prisma.contact.findMany.mockImplementation((args: unknown) => {
        const where = (args as { where: { email?: unknown; name?: unknown } }).where;
        if (where.email) return Promise.resolve([{ email: "taken@x.com" }]);
        if (where.name) return Promise.resolve([{ name: "Known Person" }]);
        return Promise.resolve([]);
      });
      const csv = [
        "First Name,Last Name,Email,Mobile,Company,Referred by,Tags",
        "Ann,Lee,ann@x.com,+1 555,Acme,known person,vip; hot",
        "Bo,,taken@x.com,,,,",
        ",,c@x.com,,,,",
        "Di,,d@x.com,,,Ann Lee,",
        "Ed,,e@x.com,,,Stranger,",
      ].join("\n");
      const res = await service.checkImport(
        {
          csv,
          mapping: {
            "First Name": "firstName",
            "Last Name": "lastName",
            Email: "email",
            Mobile: "phone",
            Company: "company",
            "Referred by": "referredBy",
            Tags: "tags",
          },
        },
        "org-1",
      );
      expect(prisma.contact.create).not.toHaveBeenCalled();
      expect(res.total).toBe(5);
      expect(res.toCreate).toBe(3);
      expect(res.skipped).toEqual([
        { row: 3, reason: "Email already exists" },
        { row: 4, reason: "Missing name" },
      ]);
      // "Ann Lee" is created earlier in the same file, so Di's referrer resolves.
      expect(res.warnings).toEqual([{ row: 6, reason: 'Referred by "Stranger" matches no contact; left out' }]);
      expect(res.sample[0]).toEqual({
        row: 2,
        name: "Ann Lee",
        email: "ann@x.com",
        company: "Acme",
        phones: [{ label: "Mobile", number: "+1 555" }],
        status: "lead",
        rating: null,
        tags: ["vip", "hot"],
        followUpAt: null,
        followUpEveryDays: null,
        referredBy: "known person",
        companyRevenue: null,
        companyEmployees: null,
      });
      expect(res.sample.map((s) => s.row)).toEqual([2, 5, 6]);
      prisma.contact.findMany.mockImplementation(() => Promise.resolve([]));
    });

    it("import rejects more than 5,000 rows", async () => {
      const csv = "Name\n" + Array.from({ length: 5001 }, (_, i) => `n${i}`).join("\n");
      const e = await rejects(service.importCsv({ csv, mapping: { Name: "name" } }, "org-1", "u-1"));
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as Error).message).toBe("CSV has more than 5,000 rows");
    });

    it("preview returns headers, first 5 rows and total", () => {
      const csv = "A,B\n" + Array.from({ length: 7 }, (_, i) => `${i},x`).join("\n");
      const res = service.previewCsv(csv);
      expect(res.headers).toEqual(["A", "B"]);
      expect(res.rows).toHaveLength(5);
      expect(res.total).toBe(7);
    });

    it("export neutralises formula cells and includes paid dollars", async () => {
      prisma.contact.findMany.mockImplementation(() =>
        Promise.resolve([
          {
            id: "c-1",
            name: '=HYPERLINK("x")',
            firstName: "Ann",
            lastName: "Lee",
            jobTitle: "CTO",
            department: "Eng",
            email: "a@x.com",
            phone: "+1 555",
            phones: [
              { label: "Mobile", number: "+1 555" },
              { label: "Work", number: "+1 777" },
            ],
            socialLinks: ["https://linkedin.com/in/ann", "https://x.com/ann"],
            rating: "warm",
            website: null,
            address: null,
            description: "Bakery",
            userId: "u-1",
            status: "lead",
            followUpAt: new Date("2026-11-01T00:00:00Z"),
            followUpEveryDays: 30,
            company: { name: "Acme", annualRevenue: 500000, employeeCount: 12 },
            leadSource: { name: "Web" },
            referredBy: { name: "Bo", email: "bo@x.com" },
            labels: [{ label: { name: "vip" } }, { label: { name: "hot" } }],
          },
        ]),
      );
      revenue.paidTotals.mockImplementation(() => Promise.resolve(new Map([["c-1", 123456]])));
      const csv = await service.exportCsv("org-1", {});
      const [header, line] = csv.split("\r\n");
      expect(header).toBe(
        "Name,First name,Last name,Email,Phone,All phones,Company,Job title,Department,Website,Address,Status,Rating,Source,Tags,Social links,Next follow-up,Follow-up repeats (days),Paid all time,About,Referred by,Company annual revenue,Company employees,Portal access",
      );
      expect(line.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
      // A leading "+" is neutralised like any formula character.
      expect(line).toContain(",Ann,Lee,a@x.com,'+1 555,Mobile: +1 555; Work: +1 777,Acme,CTO,Eng,");
      expect(line).toContain(
        ",Lead,Warm,Web,vip; hot,https://linkedin.com/in/ann https://x.com/ann,2026-11-01,30,1234.56,Bakery,bo@x.com,500000,12,Yes",
      );
    });

    it("our own export imports back with labelled phones, referrer, follow-up repeat and company size", async () => {
      prisma.contact.findMany.mockImplementation(() =>
        Promise.resolve([
          {
            id: "c-1",
            name: "Ann Lee",
            firstName: "Ann",
            lastName: "Lee",
            email: "ann@x.com",
            phone: "+1 555",
            phones: [
              { label: "Mobile", number: "+1 555" },
              { label: "Work", number: "+1 777" },
            ],
            socialLinks: [],
            status: "client",
            followUpAt: new Date("2030-01-02T12:00:00Z"),
            followUpEveryDays: 30,
            company: { name: "Acme", annualRevenue: 1500000, employeeCount: 12 },
            leadSource: null,
            referredBy: { name: "Bo", email: "bo@x.com" },
            labels: [],
          },
        ]),
      );
      const csv = await service.exportCsv("org-1", {});
      const [headers, ...rows] = parseCsv(csv);
      // What the import screen auto-matches for these headers (apps/web/src/lib/contact-fields.ts).
      const mapping: ImportMapping = {
        "First name": "firstName",
        "Last name": "lastName",
        Email: "email",
        Phone: "phone",
        "All phones": "phone",
        Company: "company",
        Status: "status",
        "Next follow-up": "followUpAt",
        "Follow-up repeats (days)": "followUpEveryDays",
        "Referred by": "referredBy",
        "Company annual revenue": "companyRevenue",
        "Company employees": "companyEmployees",
      };
      const [planned] = planImport(headers, rows, mapping);
      if (!("draft" in planned)) throw new Error(planned.skip);
      expect(planned.warnings).toEqual([]);
      expect(planned.draft.contact).toMatchObject({
        firstName: "Ann",
        lastName: "Lee",
        email: "ann@x.com",
        status: "client",
        companyName: "Acme",
        phones: [
          { label: "Mobile", number: "+1 555" },
          { label: "Work", number: "+1 777" },
        ],
      });
      expect(planned.draft).toMatchObject({
        referredBy: "bo@x.com",
        followUpAt: "2030-01-02",
        followUpEveryDays: 30,
        company: { annualRevenue: 1500000, employeeCount: 12 },
      });
      prisma.contact.findMany.mockImplementation(() => Promise.resolve([]));
    });

    it("export follows the list's sort", async () => {
      const base = { phones: [], socialLinks: [], labels: [], company: null, leadSource: null, referredBy: null };
      prisma.contact.findMany.mockImplementation(() =>
        Promise.resolve([
          { ...base, id: "a", name: "Ann", status: "lead", followUpAt: null },
          { ...base, id: "b", name: "Bo", status: "lead", followUpAt: null },
        ]),
      );
      revenue.paidTotals.mockImplementation(() => Promise.resolve(new Map([["b", 500]])));
      const csv = await service.exportCsv("org-1", { sort: "paid" });
      const names = csv.split("\r\n").slice(1).filter(Boolean).map((l) => l.split(",")[0]);
      expect(names).toEqual(["Bo", "Ann"]);
      revenue.paidTotals.mockImplementation(() => Promise.resolve(new Map<string, number>()));
      prisma.contact.findMany.mockImplementation(() => Promise.resolve([]));
    });

    it("import joins first + last names and accepts a row with only a first name", async () => {
      const csv = "First Name,Last Name\nAnn,Lee\nCher,\n,Nobody\n";
      const res = await service.importCsv(
        { csv, mapping: { "First Name": "firstName", "Last Name": "lastName" } },
        "org-1",
        "u-1",
      );
      expect(res).toEqual({ created: 2, skipped: [{ row: 4, reason: "Missing name" }], warnings: [] });
      const rows = prisma.contact.create.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
      expect(rows[0]).toMatchObject({ name: "Ann Lee", firstName: "Ann", lastName: "Lee" });
      expect(rows[1]).toMatchObject({ name: "Cher", firstName: "Cher", lastName: null });
    });

    it("import splits social links from every mapped column and stores title, department, rating", async () => {
      const csv = [
        "Name,Title,Department,Rating,LinkedIn,Twitter",
        "Ann,CTO,Eng,HOT,https://linkedin.com/in/ann; https://a.dev,https://x.com/ann",
      ].join("\n");
      await service.importCsv(
        {
          csv,
          mapping: {
            Name: "name",
            Title: "jobTitle",
            Department: "department",
            Rating: "rating",
            LinkedIn: "socialLinks",
            Twitter: "socialLinks",
          },
        },
        "org-1",
        "u-1",
      );
      expect((prisma.contact.create.mock.calls[0][0] as { data: Record<string, unknown> }).data).toMatchObject({
        jobTitle: "CTO",
        department: "Eng",
        rating: "hot",
        socialLinks: ["https://linkedin.com/in/ann", "https://a.dev", "https://x.com/ann"],
      });
    });

    it("import skips a row with an invalid rating, but never one over a social link", async () => {
      const csv = "Name,Rating,Social\nA,lukewarm,\nB,,notaurl\nC,cold,https://c.dev\n";
      const res = await service.importCsv(
        { csv, mapping: { Name: "name", Rating: "rating", Social: "socialLinks" } },
        "org-1",
        "u-1",
      );
      expect(res).toEqual({
        created: 2,
        skipped: [{ row: 2, reason: "Invalid rating" }],
        warnings: [{ row: 3, reason: `Social link "notaurl" isn't a web address; left out` }],
      });
      const links = prisma.contact.create.mock.calls.map(
        (c) => (c[0] as { data: { socialLinks: string[] } }).data.socialLinks,
      );
      expect(links).toEqual([[], ["https://c.dev"]]);
    });

    it("import of a Zoho-style export keeps rows with Twitter handles and bare domains", async () => {
      const csv = "First Name,Last Name,Twitter,LinkedIn\nAnn,Lee,@acme,linkedin.com/in/ann\nBo,,bo_d,\n";
      const res = await service.importCsv(
        {
          csv,
          mapping: {
            "First Name": "firstName",
            "Last Name": "lastName",
            Twitter: "socialLinks",
            LinkedIn: "socialLinks",
          },
        },
        "org-1",
        "u-1",
      );
      expect(res).toEqual({ created: 2, skipped: [], warnings: [] });
      const links = prisma.contact.create.mock.calls.map(
        (c) => (c[0] as { data: { socialLinks: string[] } }).data.socialLinks,
      );
      expect(links).toEqual([["https://x.com/acme", "https://linkedin.com/in/ann"], ["https://x.com/bo_d"]]);
    });

    it("import skips rows with an invalid email and truncates long fields", async () => {
      const long = "x".repeat(600);
      const csv = `Name,Email,Address\nAnn,not-an-email,\n${"n".repeat(250)},ok@x.com,${long}\n`;
      const res = await service.importCsv(
        { csv, mapping: { Name: "name", Email: "email", Address: "address" } },
        "org-1",
        "u-1",
      );
      expect(res).toEqual({ created: 1, skipped: [{ row: 2, reason: "Invalid email" }], warnings: [] });
      const data = (prisma.contact.create.mock.calls[0][0] as {
        data: { name: string; address: string };
      }).data;
      expect(data.name).toHaveLength(200);
      expect(data.address).toHaveLength(500);
    });

    it("import ignores prototype-named headers", async () => {
      const csv = "constructor,Name\nzzz,Ann\n";
      const res = await service.importCsv({ csv, mapping: { Name: "name" } }, "org-1", "u-1");
      expect(res.created).toBe(1);
    });

    it("export passes filters through to the where clause", async () => {
      prisma.contact.findMany.mockImplementation(() => Promise.resolve([]));
      await service.exportCsv("org-1", { status: "client", labelId: "l-1", search: " ann " });
      const arg = prisma.contact.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(arg.where).toMatchObject({
        organizationId: "org-1",
        status: "client",
        labels: { some: { labelId: "l-1" } },
      });
      expect(arg.where.OR).toBeDefined();
    });

    describe("controller upload handling", () => {
      const calls: unknown[] = [];
      const fake = {
        previewCsv: (t: string) => ({ t }),
        importCsv: (...a: unknown[]) => calls.push(a),
        checkImport: (...a: unknown[]) => calls.push(["check", ...a]),
      };
      const ctrl = new ContactsController(fake as unknown as ContactsService);
      const csvFile = { originalname: "a.CSV", buffer: Buffer.from("Name\nAnn\n") };

      it("rejects a missing file or non-.csv extension", () => {
        expect(() => ctrl.previewImport(undefined)).toThrow("No file provided");
        expect(() => ctrl.previewImport({ ...csvFile, originalname: "a.txt" })).toThrow(
          "Only .csv files are supported",
        );
        expect(() => ctrl.importCsv(undefined, '{"Name":"name"}', "org-1", "u-1")).toThrow(
          "No file provided",
        );
      });

      it("rejects an invalid mapping with 400", () => {
        for (const bad of [undefined, "nope", "[]", "null", '{"Name":"bogus"}', '{"Name":1}']) {
          expect(() => ctrl.importCsv(csvFile, bad, "org-1", "u-1")).toThrow("Invalid mapping");
        }
      });

      it("passes the csv text and parsed mapping to the service", () => {
        ctrl.importCsv(csvFile, '{"Name":"name"}', "org-1", "u-1");
        expect(calls[0]).toEqual([{ csv: "Name\nAnn\n", mapping: { Name: "name" } }, "org-1", "u-1"]);
      });

      it("check validates the mapping and passes the same input to the dry run", () => {
        expect(() => ctrl.checkImport(csvFile, "nope", "org-1")).toThrow("Invalid mapping");
        ctrl.checkImport(csvFile, '{"Name":"name"}', "org-1");
        expect(calls.at(-1)).toEqual(["check", { csv: "Name\nAnn\n", mapping: { Name: "name" } }, "org-1"]);
      });
    });

    it("declares export/import routes before :id", () => {
      const names = Object.getOwnPropertyNames(ContactsController.prototype);
      expect(names.indexOf("exportCsv")).toBeLessThan(names.indexOf("findOne"));
      expect(names.indexOf("importCsv")).toBeLessThan(names.indexOf("findOne"));
      expect(names.indexOf("checkImport")).toBeLessThan(names.indexOf("findOne"));
    });
  });
});
