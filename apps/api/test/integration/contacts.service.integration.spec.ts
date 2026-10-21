import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { assertDisposableDatabase } from "./guard";
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
});
