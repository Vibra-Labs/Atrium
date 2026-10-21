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
});
