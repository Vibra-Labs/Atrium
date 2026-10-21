import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { PrismaService } from "../prisma/prisma.service";
import type { ContactSyncService } from "./contact-sync.service";
import { ContactBackfillService } from "./contact-backfill.service";

const updatedAt = new Date("2026-01-01T00:00:00Z");
const prisma = {
  contact: {
    findMany: mock((_args: { where: Record<string, unknown> }) => Promise.resolve([] as unknown[])),
    update: mock(() => Promise.resolve({})),
  },
};

describe("ContactBackfillService.backfillContactFields", () => {
  let service: ContactBackfillService;

  beforeEach(() => {
    prisma.contact.findMany.mockReset();
    prisma.contact.update.mockReset();
    prisma.contact.update.mockImplementation(() => Promise.resolve({}));
    service = new ContactBackfillService(prisma as unknown as PrismaService, {} as ContactSyncService);
  });

  it("splits names of contacts without a first name, keeping updatedAt", async () => {
    prisma.contact.findMany
      .mockImplementationOnce(() =>
        Promise.resolve([
          { id: "c-1", name: "Ann Marie Lee", updatedAt },
          { id: "c-2", name: "Cher", updatedAt },
        ]),
      )
      .mockImplementationOnce(() => Promise.resolve([]));

    await service.backfillContactFields("org-1");

    expect(prisma.contact.findMany.mock.calls[0][0].where).toEqual({ organizationId: "org-1", firstName: null });
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: { firstName: "Ann", lastName: "Marie Lee", updatedAt },
    });
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: "c-2" },
      data: { firstName: "Cher", lastName: null, updatedAt },
    });
  });

  it("seeds phones from the legacy phone column only where phones is empty", async () => {
    prisma.contact.findMany
      .mockImplementationOnce(() => Promise.resolve([]))
      .mockImplementationOnce(() => Promise.resolve([{ id: "c-3", phone: " 555 ", updatedAt }]));

    await service.backfillContactFields("org-1");

    expect(prisma.contact.findMany.mock.calls[1][0].where).toMatchObject({
      organizationId: "org-1",
      phones: { equals: [] },
    });
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: "c-3" },
      data: { phones: [{ label: "Phone", number: "555" }], updatedAt },
    });
  });

  it("copying a client profile writes phones with the phone, independent of step order", async () => {
    const txUpdate = mock((_args: { data: Record<string, unknown> }) => Promise.resolve({}));
    const withProfile = {
      ...prisma,
      clientProfile: {
        findUnique: mock(() => Promise.resolve({ phone: " 555 ", company: null, description: null })),
      },
      $transaction: mock((fn: (tx: unknown) => Promise<void>) => fn({ contact: { update: txUpdate } })),
    };
    const svc = new ContactBackfillService(withProfile as unknown as PrismaService, {} as ContactSyncService);
    const copyProfile = (
      svc as unknown as { copyProfile: (o: string, u: string, c: unknown) => Promise<void> }
    ).copyProfile.bind(svc);

    await copyProfile("org-1", "u-1", {
      id: "c-1",
      phone: null,
      phones: [],
      address: null,
      website: null,
      companyId: null,
      profileImportedAt: null,
    });

    expect(txUpdate.mock.calls[0][0].data).toMatchObject({
      phone: "555",
      phones: [{ label: "Phone", number: "555" }],
    });
  });

  it("a failing row is logged and the rest continue", async () => {
    prisma.contact.findMany
      .mockImplementationOnce(() =>
        Promise.resolve([
          { id: "c-1", name: "Ann Lee", updatedAt },
          { id: "c-2", name: "Bo Diddley", updatedAt },
        ]),
      )
      .mockImplementationOnce(() => Promise.resolve([]));
    prisma.contact.update.mockImplementationOnce(() => Promise.reject(new Error("db down")));

    await service.backfillContactFields("org-1");

    expect(prisma.contact.update).toHaveBeenCalledTimes(2);
  });

  it("copying a client profile also copies its description into About", async () => {
    const txUpdate = mock((_args: { data: Record<string, unknown> }) => Promise.resolve({}));
    const withProfile = {
      ...prisma,
      clientProfile: {
        findUnique: mock(() => Promise.resolve({ phone: null, company: null, description: " Likes email " })),
      },
      $transaction: mock((fn: (tx: unknown) => Promise<void>) =>
        fn({
          contact: { update: txUpdate },
          contactNote: { count: mock(() => Promise.resolve(1)) },
        }),
      ),
    };
    const svc = new ContactBackfillService(withProfile as unknown as PrismaService, {} as ContactSyncService);
    const copyProfile = (
      svc as unknown as { copyProfile: (o: string, u: string, c: unknown) => Promise<void> }
    ).copyProfile.bind(svc);

    await copyProfile("org-1", "u-1", {
      id: "c-1",
      phone: null,
      phones: [],
      address: null,
      website: null,
      description: null,
      companyId: null,
      profileImportedAt: null,
    });

    expect(txUpdate.mock.calls[0][0].data).toMatchObject({ description: "Likes email" });
  });
});

describe("ContactBackfillService.backfillInvitees", () => {
  it("finds or creates a contact for every pending portal invitation, logging failures", async () => {
    const ensureForInvitee = mock((_o: string, email: string) =>
      email === "bad@x.com" ? Promise.reject(new Error("db down")) : Promise.resolve({ id: "c" }),
    );
    const findMany = mock((_args: unknown) =>
      Promise.resolve([
        { id: "i-1", email: "Ann@X.com" },
        { id: "i-2", email: "bad@x.com" },
        { id: "i-3", email: "cy@x.com" },
      ]),
    );
    const svc = new ContactBackfillService(
      { invitation: { findMany } } as unknown as PrismaService,
      { ensureForInvitee } as unknown as ContactSyncService,
    );

    await svc.backfillInvitees("org-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", role: "member", status: "pending" },
      select: { id: true, email: true },
    });
    expect(ensureForInvitee.mock.calls.map((c) => c[1])).toEqual(["Ann@X.com", "bad@x.com", "cy@x.com"]);
  });
});

describe("ContactBackfillService.backfillDescriptions", () => {
  it("copies a profile description only into imported contacts whose About is still null", async () => {
    const contactFindMany = mock((_args: { where: Record<string, unknown> }) =>
      Promise.resolve([{ id: "c-1", userId: "u-1", updatedAt }]),
    );
    const update = mock((_args: unknown) => Promise.resolve({}));
    const svc = new ContactBackfillService(
      {
        clientProfile: {
          findMany: mock(() =>
            Promise.resolve([
              { userId: "u-1", description: " About Ann " },
              { userId: "u-2", description: "   " },
            ]),
          ),
        },
        contact: { findMany: contactFindMany, update },
      } as unknown as PrismaService,
      {} as ContactSyncService,
    );

    await svc.backfillDescriptions("org-1");

    expect(contactFindMany.mock.calls[0][0].where).toEqual({
      organizationId: "org-1",
      userId: { in: ["u-1"] },
      profileImportedAt: { not: null },
      description: null,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: { description: "About Ann", updatedAt },
    });
  });

  it("skips the contact query when no profile has a description", async () => {
    const contactFindMany = mock(() => Promise.resolve([]));
    const svc = new ContactBackfillService(
      {
        clientProfile: { findMany: mock(() => Promise.resolve([])) },
        contact: { findMany: contactFindMany },
      } as unknown as PrismaService,
      {} as ContactSyncService,
    );
    await svc.backfillDescriptions("org-1");
    expect(contactFindMany).not.toHaveBeenCalled();
  });
});
