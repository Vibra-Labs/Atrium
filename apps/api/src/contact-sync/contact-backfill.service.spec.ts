import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { PrismaService } from "../prisma/prisma.service";
import type { ContactSyncService } from "./contact-sync.service";
import { CONTACTS_BACKFILL_VERSION, ContactBackfillService } from "./contact-backfill.service";

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
          // Made from an invitation: keeps no first name until the person joins.
          { id: "c-9", name: "inv@x.com", email: "inv@x.com", updatedAt },
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
    expect(prisma.contact.update).toHaveBeenCalledTimes(2);
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

  it("copying a client profile puts its description in About, not in a note", async () => {
    const noteCreate = mock(() => Promise.resolve({}));
    const txUpdate = mock((_args: { data: Record<string, unknown> }) => Promise.resolve({}));
    const withProfile = {
      ...prisma,
      clientProfile: {
        findUnique: mock(() => Promise.resolve({ phone: null, company: null, description: " Likes email " })),
      },
      $transaction: mock((fn: (tx: unknown) => Promise<void>) =>
        fn({
          contact: { update: txUpdate },
          contactNote: { count: mock(() => Promise.resolve(0)), create: noteCreate },
          member: { findFirst: mock(() => Promise.resolve({ userId: "owner" })) },
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
    expect(noteCreate).not.toHaveBeenCalled();
  });
});

describe("ContactBackfillService.backfillInvitees", () => {
  const now = new Date("2026-10-21T00:00:00Z");

  function build(marker: Date | null, failEmail?: string) {
    const ensureForInvitee = mock((_o: string, email: string) =>
      email === failEmail ? Promise.reject(new Error("db down")) : Promise.resolve({ id: "c" }),
    );
    const prismaMock = {
      organization: {
        findUnique: mock(() => Promise.resolve({ inviteesBackfilledAt: marker })),
        update: mock((_a: unknown) => Promise.resolve({})),
      },
      invitation: {
        findMany: mock((_args: unknown) =>
          Promise.resolve([
            { id: "i-1", email: "Ann@X.com" },
            { id: "i-2", email: "bad@x.com" },
            { id: "i-3", email: "cy@x.com" },
          ]),
        ),
      },
    };
    const svc = new ContactBackfillService(
      prismaMock as unknown as PrismaService,
      { ensureForInvitee } as unknown as ContactSyncService,
    );
    return { svc, prismaMock, ensureForInvitee };
  }

  it("runs once: open (unexpired) client invitations only, then sets the marker", async () => {
    const { svc, prismaMock, ensureForInvitee } = build(null);
    await svc.backfillInvitees("org-1", now);
    expect(prismaMock.invitation.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", role: "member", status: "pending", expiresAt: { gt: now } },
      select: { id: true, email: true },
    });
    expect(ensureForInvitee.mock.calls.map((c) => c[1])).toEqual(["Ann@X.com", "bad@x.com", "cy@x.com"]);
    expect(prismaMock.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { inviteesBackfilledAt: now },
    });
  });

  it("does nothing once the marker is set", async () => {
    const { svc, prismaMock, ensureForInvitee } = build(new Date());
    await svc.backfillInvitees("org-1", now);
    expect(prismaMock.invitation.findMany).not.toHaveBeenCalled();
    expect(ensureForInvitee).not.toHaveBeenCalled();
  });

  it("logs a failing invitation, carries on, and leaves the marker unset so it retries", async () => {
    const { svc, prismaMock, ensureForInvitee } = build(null, "bad@x.com");
    await svc.backfillInvitees("org-1", now);
    expect(ensureForInvitee).toHaveBeenCalledTimes(3);
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
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

describe("ContactBackfillService.run", () => {
  type Steps = Record<string, unknown>;
  function build(orgs: { id: string }[], failStep?: string) {
    const db = {
      organization: {
        findMany: mock((_a: unknown) => Promise.resolve(orgs)),
        update: mock((_a: unknown) => Promise.resolve({})),
      },
    };
    const svc = new ContactBackfillService(db as unknown as PrismaService, {} as ContactSyncService);
    const steps = ["backfillOrgSteps"];
    const calls: string[] = [];
    for (const name of steps) {
      (svc as unknown as Steps)[name] = mock(async (orgId: string) => {
        calls.push(`${name}:${orgId}`);
        if (failStep) throw new Error("boom");
      });
    }
    return { svc, db, calls };
  }

  it("only visits workspaces below the current backfill version, and stamps the version when the pass succeeds", async () => {
    const { svc, db, calls } = build([{ id: "org-1" }]);
    await svc.run();
    expect(CONTACTS_BACKFILL_VERSION).toBe(1);
    expect(db.organization.findMany.mock.calls[0][0]).toEqual({
      where: { contactsBackfillVersion: { lt: CONTACTS_BACKFILL_VERSION } },
      select: { id: true },
    });
    expect(calls).toEqual(["backfillOrgSteps:org-1"]);
    expect(db.organization.update.mock.calls[0][0]).toEqual({
      where: { id: "org-1" },
      data: { contactsBackfillVersion: CONTACTS_BACKFILL_VERSION },
    });
  });

  it("leaves the version unchanged when a step throws, so the next boot retries", async () => {
    const { svc, db } = build([{ id: "org-1" }], "backfillOrgSteps");
    await svc.run();
    expect(db.organization.update).not.toHaveBeenCalled();
  });

  it("leaves the version unchanged when a single row failed", async () => {
    const { svc, db } = build([{ id: "org-1" }]);
    (svc as unknown as Steps).backfillOrgSteps = mock(async () => {
      (svc as unknown as { logFailure: (m: string, e: unknown) => void }).logFailure("row failed", new Error("x"));
    });
    await svc.run();
    expect(db.organization.update).not.toHaveBeenCalled();
  });
});
