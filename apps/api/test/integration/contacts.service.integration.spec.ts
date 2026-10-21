import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { assertDisposableDatabase } from "./guard";
import { PrismaClient } from "@atrium/database";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ContactsService } from "../../src/contacts/contacts.service";
import { ContactRevenueService } from "../../src/contacts/contact-revenue.service";

let prisma: PrismaService;
let contacts: ContactsService;
let orgId: string;

beforeAll(async () => {
  assertDisposableDatabase();
  const mod = await Test.createTestingModule({
    providers: [ContactsService, ContactRevenueService, PrismaService],
  }).compile();
  prisma = mod.get(PrismaService);
  contacts = mod.get(ContactsService);
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  orgId = (await prisma.organization.create({ data: { id: `cf-org-${s}`, name: `cf-${s}`, slug: `cf-${s}` } })).id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch((e: unknown) => console.error(e));
  await prisma?.$disconnect();
});

describe("ContactsService contact fields (Postgres)", () => {
  it("round-trips phones, social links and names through create and update", async () => {
    const created = await contacts.create(
      {
        firstName: "Ann",
        lastName: "Lee",
        jobTitle: "CTO",
        department: "Engineering",
        phones: [
          { label: "Mobile", number: "+1 555" },
          { label: "Work", number: "+1 777" },
        ],
        socialLinks: ["https://linkedin.com/in/ann", "https://x.com/ann"],
        rating: "hot",
      },
      orgId,
    );

    const found = await contacts.findOne(created.id, orgId);
    expect(found).toMatchObject({
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
      socialLinks: ["https://linkedin.com/in/ann", "https://x.com/ann"],
      rating: "hot",
    });

    await contacts.update(created.id, { phone: "+1 999", lastName: null, rating: null }, orgId);
    const updated = await contacts.findOne(created.id, orgId);
    expect(updated).toMatchObject({
      name: "Ann",
      lastName: null,
      rating: null,
      phone: "+1 999",
      phones: [
        { label: "Mobile", number: "+1 999" },
        { label: "Work", number: "+1 777" },
      ],
    });

    await contacts.update(created.id, { phones: [], socialLinks: [] }, orgId);
    const cleared = await contacts.findOne(created.id, orgId);
    expect(cleared).toMatchObject({ phone: null, phones: [], socialLinks: [] });

    const listed = await contacts.findAll(orgId, { rating: "hot" });
    expect(listed.data).toHaveLength(0);
  });

  it("a contact created with a name only gets first/last and empty Json lists", async () => {
    const created = await contacts.create({ name: "Bo Diddley" }, orgId);
    const row = await prisma.contact.findUniqueOrThrow({ where: { id: created.id } });
    expect([row.firstName, row.lastName]).toEqual(["Bo", "Diddley"]);
    expect(row.phones).toEqual([]);
    expect(row.socialLinks).toEqual([]);
  });

  it("CSV import: several phones, referrer from earlier in the file, follow-up and company size", async () => {
    const s = Date.now();
    const user = await prisma.user.create({ data: { id: `imp-u-${s}`, name: "Owner", email: `imp-${s}@x.com` } });
    const company = `ImportCo ${s}`;
    const csv = [
      "First Name,Last Name,Email,Mobile,Work Phone,Company,Referred by,Follow up,Revenue,Employees",
      `Rea,Ferrer,rea-${s}@x.com,+1 555 0100,,${company},,,"$1,000",`,
      `Ann,Lee,ann-${s}@x.com,+1 555 0200,+1 555 0300,${company},rea-${s}@x.com,11/5/2026,"$9,999",12`,
    ].join("\n");
    const mapping = {
      "First Name": "firstName",
      "Last Name": "lastName",
      Email: "email",
      Mobile: "phone",
      "Work Phone": "phone",
      Company: "company",
      "Referred by": "referredBy",
      "Follow up": "followUpAt",
      Revenue: "companyRevenue",
      Employees: "companyEmployees",
    } as const;

    const check = await contacts.checkImport({ csv, mapping }, orgId);
    expect(check).toMatchObject({ total: 2, toCreate: 2, skipped: [], warnings: [] });
    expect(await prisma.contact.count({ where: { organizationId: orgId, email: `ann-${s}@x.com` } })).toBe(0);

    const res = await contacts.importCsv({ csv, mapping }, orgId, user.id);
    expect(res).toEqual({ created: 2, skipped: [], warnings: [] });
    const rea = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgId, email: `rea-${s}@x.com` } });
    const ann = await prisma.contact.findFirstOrThrow({
      where: { organizationId: orgId, email: `ann-${s}@x.com` },
      include: { company: true },
    });
    expect(ann.phones).toEqual([
      { label: "Mobile", number: "+1 555 0200" },
      { label: "Work", number: "+1 555 0300" },
    ]);
    expect(ann.referredById).toBe(rea.id);
    expect(ann.followUpAt?.toISOString()).toBe("2026-11-05T12:00:00.000Z");
    expect(ann.followUpOwnerId).toBe(user.id);
    // The first row set revenue; a later row only fills what is still empty.
    expect([ann.company?.annualRevenue, ann.company?.employeeCount]).toEqual([1000, 12]);

    // A name referrer in any case, from the workspace or from earlier in the same file.
    await contacts.create({ firstName: "Known", lastName: `Person${s}` }, orgId);
    const byName = [
      "Name,Referred by",
      `New One ${s},known PERSON${s}`,
      `New Two ${s},new one ${s}`,
    ].join("\n");
    const nameMapping = { Name: "name", "Referred by": "referredBy" } as const;
    const nameCheck = await contacts.checkImport({ csv: byName, mapping: nameMapping }, orgId);
    expect(nameCheck.warnings).toEqual([]);
    const nameRes = await contacts.importCsv({ csv: byName, mapping: nameMapping }, orgId, user.id);
    expect(nameRes).toEqual({ created: 2, skipped: [], warnings: [] });
    const two = await prisma.contact.findFirstOrThrow({
      where: { organizationId: orgId, name: `New Two ${s}` },
      include: { referredBy: true },
    });
    expect(two.referredBy?.name).toBe(`New One ${s}`);

    // Re-checking the same file now finds both emails taken.
    const again = await contacts.checkImport({ csv, mapping }, orgId);
    expect(again.toCreate).toBe(0);
    await prisma.user.delete({ where: { id: user.id } }).catch((e: unknown) => console.error(e));
  });

  it("CSV import of 1,000 rows writes in batches: same results, a bounded number of queries", async () => {
    const counted = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    let queries = 0;
    counted.$on("query", () => {
      queries++;
    });
    const service = new ContactsService(
      counted as unknown as PrismaService,
      new ContactRevenueService(counted as unknown as PrismaService),
    );
    const s = Date.now();
    const user = await prisma.user.create({ data: { id: `bulk-u-${s}`, name: "Owner", email: `bulk-${s}@x.com` } });
    // An existing contact (its email is in the file) and an existing company in another case.
    await prisma.contact.create({ data: { organizationId: orgId, name: `Existing ${s}`, email: `p7-${s}@x.com` } });
    const existingCo = await prisma.company.create({
      data: { organizationId: orgId, name: `BULK CO 0 ${s}`, annualRevenue: 5 },
    });

    const lines = ["First Name,Last Name,Email,Company,Tags,Notes,Referred by,Follow up,Repeat,Revenue"];
    for (let i = 0; i < 1000; i++) {
      const company = i % 3 ? `Bulk Co ${i % 10} ${s}` : `bulk co ${i % 10} ${s}`;
      const tags = `T${i % 5}-${s}; vip-${s}; VIP-${s}`;
      // Each row names the previous one, in another case, as its referrer.
      const ref = i > 0 ? `p${i - 1} LAST${s}` : "";
      const followUp = i % 2 ? "2020-01-02" : "2099-03-04";
      lines.push(`P${i},Last${s},p${i}-${s}@x.com,${company},${tags},note ${i},${ref},${followUp},${i % 2 ? "" : "14"},${100 + i}`);
    }
    // In-file duplicates: same emails as earlier rows, other case.
    for (let i = 0; i < 50; i++) lines.push(`Dup${i},X,P${i}-${s}@X.com,,,,,,,`);
    const mapping = {
      "First Name": "firstName",
      "Last Name": "lastName",
      Email: "email",
      Company: "company",
      Tags: "tags",
      Notes: "notes",
      "Referred by": "referredBy",
      "Follow up": "followUpAt",
      Repeat: "followUpEveryDays",
      Revenue: "companyRevenue",
    } as const;

    const started = Date.now();
    const res = await service.importCsv({ csv: lines.join("\n"), mapping }, orgId, user.id);
    const elapsed = Date.now() - started;
    await counted.$disconnect();

    // Row 9 (p7) collides with the existing contact; rows 1002..1051 repeat earlier emails, except
    // the one repeating p7, which was never written by this import but exists already.
    expect(res.created).toBe(999);
    expect(res.skipped).toHaveLength(51);
    expect(res.skipped.every((r) => r.reason === "Email already exists")).toBe(true);
    expect(res.skipped[0]).toEqual({ row: 9, reason: "Email already exists" });
    // p8 names p7, who isn't imported, but the existing p7 contact is named "Existing", so: none.
    expect(res.warnings).toEqual([{ row: 10, reason: `Referred by "p7 LAST${s}" matches no contact; left out` }]);
    expect(queries).toBeLessThanOrEqual(40);
    expect(elapsed).toBeLessThan(10_000);

    const imported = { organizationId: orgId, lastName: `Last${s}` };
    expect(await prisma.contact.count({ where: imported })).toBe(999);
    expect(await prisma.contactEvent.count({ where: { contact: imported, type: "contact_created" } })).toBe(999);
    expect(await prisma.contactNote.count({ where: { contact: imported, authorId: user.id } })).toBe(999);
    // Two tags per row (vip / VIP are one), six labels in all.
    expect(await prisma.contactLabel.count({ where: { contact: imported } })).toBe(1998);
    expect(await prisma.label.count({ where: { organizationId: orgId, name: { endsWith: `${s}` } } })).toBe(6);
    // Ten companies, matched case-insensitively; the existing one kept its revenue.
    expect(await prisma.company.count({ where: { organizationId: orgId, name: { endsWith: `${s}` } } })).toBe(10);
    const co0 = await prisma.company.findUniqueOrThrow({ where: { id: existingCo.id } });
    expect(co0.annualRevenue).toBe(5);
    const co3 = await prisma.company.findFirstOrThrow({
      where: { organizationId: orgId, name: { equals: `bulk co 3 ${s}`, mode: "insensitive" } },
    });
    // Named as first seen in the file (row 5, "bulk co 3").
    expect(co3.name).toBe(`bulk co 3 ${s}`);
    expect(co3.annualRevenue).toBe(103);

    const p5 = await prisma.contact.findFirstOrThrow({
      where: { organizationId: orgId, email: `p5-${s}@x.com` },
      include: { referredBy: true, company: true, labels: { include: { label: true } } },
    });
    expect(p5.referredBy?.email).toBe(`p4-${s}@x.com`);
    expect(p5.company?.name).toBe(`Bulk Co 5 ${s}`);
    expect(p5.labels.map((l) => l.label.name).sort()).toEqual([`T0-${s}`, `vip-${s}`]);
    expect(p5.followUpAt?.toISOString()).toBe("2020-01-02T12:00:00.000Z");
    expect(p5.followUpNotifiedAt).not.toBeNull();
    expect(p5.followUpOwnerId).toBe(user.id);
    const p4 = await prisma.contact.findFirstOrThrow({ where: { organizationId: orgId, email: `p4-${s}@x.com` } });
    expect(p4.followUpAt?.toISOString()).toBe("2099-03-04T12:00:00.000Z");
    expect(p4.followUpEveryDays).toBe(14);
    expect(p4.followUpNotifiedAt).toBeNull();
    await prisma.user.delete({ where: { id: user.id } }).catch((e: unknown) => console.error(e));
  }, 60_000);
});
