import "reflect-metadata";
import { describe, expect, it, mock, beforeEach } from "bun:test";
import { ConflictException, NotFoundException, BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { ContactsService } from "./contacts.service";
import { ContactsController } from "./contacts.controller";
import { CompaniesController } from "./companies.controller";
import type { ContactRevenueService } from "./contact-revenue.service";
import { ROLES_KEY } from "../common";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { UpdateContactDto, SetFollowUpDto, SnoozeFollowUpDto } from "./contacts.dto";

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

    it("done on repeating moves date by interval from start of today", async () => {
      prisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve({ id: "c-1", followUpEveryDays: 30 }),
      );
      await service.completeFollowUp("c-1", "org-1", NOW);
      expect(lastUpdate().data.followUpAt).toEqual(new Date("2026-11-19T00:00:00Z"));
      expect(lastUpdate().data.followUpEveryDays).toBe(30);
      expect(lastUpdate().data.followUpNotifiedAt).toBeNull();
    });

    it("done on one-off clears", async () => {
      prisma.contact.findFirst.mockImplementation(() =>
        Promise.resolve({ id: "c-1", followUpEveryDays: null }),
      );
      await service.completeFollowUp("c-1", "org-1", NOW);
      expect(lastUpdate().data.followUpAt).toBeNull();
      expect(lastUpdate().data.followUpEveryDays).toBeNull();
    });

    it("snooze resets notified", async () => {
      prisma.contact.findFirst.mockImplementation(() => Promise.resolve({ id: "c-1" }));
      await service.snoozeFollowUp("c-1", 3, "org-1", NOW);
      expect(lastUpdate().data.followUpAt).toEqual(new Date("2026-10-23T15:30:00Z"));
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
      expect(res).toEqual({ created: 0, skipped: [{ row: 2, reason: "Email already exists" }] });
      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { organizationId: "org-1", email: "ann@example.com" },
      });

      prisma.contact.findFirst.mockImplementation(() => Promise.resolve(null));
      const dup = "Name,Email\nAnn,a@x.com\nAnn2,A@X.com\n";
      const res2 = await service.importCsv({ csv: dup, mapping: { Name: "name", Email: "email" } }, "org-1", "u-1");
      expect(res2).toEqual({ created: 1, skipped: [{ row: 3, reason: "Email already exists" }] });
    });

    it("import skips rows with no name and keeps going", async () => {
      const csv = "Name,Email\n,a@x.com\nBob,b@x.com\n";
      const res = await service.importCsv({ csv, mapping: { Name: "name", Email: "email" } }, "org-1", "u-1");
      expect(res).toEqual({ created: 1, skipped: [{ row: 2, reason: "Missing name" }] });
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

    it("import parses status case-insensitively, defaulting to lead", async () => {
      const csv = "Name,Status\nA,CLIENT\nB,Past Client\nC,\n";
      await service.importCsv({ csv, mapping: { Name: "name", Status: "status" } }, "org-1", "u-1");
      const statuses = prisma.contact.create.mock.calls.map(
        (c) => (c[0] as { data: { status: string } }).data.status,
      );
      expect(statuses).toEqual(["client", "past_client", "lead"]);
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
            email: "a@x.com",
            phone: null,
            website: null,
            address: null,
            status: "lead",
            followUpAt: new Date("2026-11-01T00:00:00Z"),
            company: { name: "Acme" },
            leadSource: { name: "Web" },
            labels: [{ label: { name: "vip" } }, { label: { name: "hot" } }],
          },
        ]),
      );
      revenue.paidTotals.mockImplementation(() => Promise.resolve(new Map([["c-1", 123456]])));
      const csv = await service.exportCsv("org-1", {});
      const [header, line] = csv.split("\r\n");
      expect(header).toBe(
        "Name,Email,Phone,Company,Website,Address,Status,Source,Tags,Next follow-up,Paid all time",
      );
      expect(line.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
      expect(line).toContain(",Lead,Web,vip; hot,2026-11-01,1234.56");
    });

    it("import skips rows with an invalid email and truncates long fields", async () => {
      const long = "x".repeat(600);
      const csv = `Name,Email,Address\nAnn,not-an-email,\n${"n".repeat(250)},ok@x.com,${long}\n`;
      const res = await service.importCsv(
        { csv, mapping: { Name: "name", Email: "email", Address: "address" } },
        "org-1",
        "u-1",
      );
      expect(res).toEqual({ created: 1, skipped: [{ row: 2, reason: "Invalid email" }] });
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
    });

    it("declares export/import routes before :id", () => {
      const names = Object.getOwnPropertyNames(ContactsController.prototype);
      expect(names.indexOf("exportCsv")).toBeLessThan(names.indexOf("findOne"));
      expect(names.indexOf("importCsv")).toBeLessThan(names.indexOf("findOne"));
    });
  });
});
