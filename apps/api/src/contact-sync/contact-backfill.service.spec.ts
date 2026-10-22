import { describe, expect, it, mock, beforeEach } from "bun:test";
import type { PrismaService } from "../prisma/prisma.service";
import type { ContactSyncService } from "./contact-sync.service";
import { BACKFILL_LEASE_MS, CONTACTS_BACKFILL_VERSION, ContactBackfillService } from "./contact-backfill.service";

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
      where: { organizationId: "org-1", AND: [{ OR: [{ role: "member" }, { role: null }] }], status: "pending", expiresAt: { gt: now } },
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
  function build(orgs: { id: string }[], failStep?: string, claimed: number = 1) {
    const db = {
      organization: {
        findMany: mock((_a: unknown) => Promise.resolve(orgs)),
        update: mock((_a: unknown) => Promise.resolve({})),
        updateMany: mock((_a: unknown) => Promise.resolve({ count: claimed })),
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

  type OrgUpdate = { where: { id: string; contactsBackfillClaimedAt?: Date }; data: Record<string, unknown> };

  /** When the pass claimed the workspace, and the last write, which releases the claim. */
  function claimAndRelease(db: ReturnType<typeof build>["db"]): { claimedAt: Date; release: OrgUpdate } {
    const calls = db.organization.updateMany.mock.calls as unknown as [OrgUpdate][];
    return { claimedAt: calls[0][0].data.contactsBackfillClaimedAt as Date, release: calls[calls.length - 1][0] };
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
    const { claimedAt, release } = claimAndRelease(db);
    // Only while the claim is still this instance's: one lost to another instance is left alone.
    expect(release).toEqual({
      where: { id: "org-1", contactsBackfillClaimedAt: claimedAt },
      data: { contactsBackfillVersion: CONTACTS_BACKFILL_VERSION, contactsBackfillClaimedAt: null },
    });
  });

  it("claims a workspace before its pass, so instances booting together don't both run it", async () => {
    const { svc, db } = build([{ id: "org-1" }]);
    await svc.run();
    const claim = db.organization.updateMany.mock.calls[0][0] as {
      where: { id: string; contactsBackfillVersion: unknown; OR: unknown[] };
      data: { contactsBackfillClaimedAt: Date };
    };
    expect(claim.where.id).toBe("org-1");
    expect(claim.where.contactsBackfillVersion).toEqual({ lt: CONTACTS_BACKFILL_VERSION });
    expect(claim.where.OR).toHaveLength(2);
    expect(claim.data.contactsBackfillClaimedAt).toBeInstanceOf(Date);
  });

  it("only takes over a claim that hasn't been renewed within the short lease", async () => {
    const { svc, db } = build([{ id: "org-1" }]);
    const before: number = Date.now();
    await svc.run();
    const claim = db.organization.updateMany.mock.calls[0][0] as {
      where: { OR: [unknown, { contactsBackfillClaimedAt: { lt: Date } }] };
    };
    const cutoff: number = claim.where.OR[1].contactsBackfillClaimedAt.lt.getTime();
    expect(BACKFILL_LEASE_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(before - cutoff).toBeGreaterThanOrEqual(BACKFILL_LEASE_MS - 50);
    expect(before - cutoff).toBeLessThanOrEqual(BACKFILL_LEASE_MS + 50);
  });

  it("renews its claim while a pass runs, so a long pass isn't taken over", async () => {
    const { svc, db } = build([{ id: "org-1" }]);
    (svc as unknown as { heartbeatMs: number }).heartbeatMs = 5;
    (svc as unknown as Steps).backfillOrgSteps = mock(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));
    await svc.run();
    const calls = db.organization.updateMany.mock.calls as unknown as [
      { where: { id: string; contactsBackfillClaimedAt?: Date }; data: { contactsBackfillClaimedAt: Date } },
    ][];
    const claimedAt: Date = calls[0][0].data.contactsBackfillClaimedAt;
    const renewals = calls.slice(1, -1);
    expect(renewals.length).toBeGreaterThan(1);
    // Each renewal only extends the claim this instance holds, and moves it forward.
    expect(renewals[0][0].where).toEqual({ id: "org-1", contactsBackfillClaimedAt: claimedAt });
    expect(renewals[1][0].where.contactsBackfillClaimedAt).toEqual(renewals[0][0].data.contactsBackfillClaimedAt);
    // The release names the latest renewal, not the original claim.
    const { release } = claimAndRelease(db);
    expect(release.where.contactsBackfillClaimedAt).toEqual(renewals[renewals.length - 1][0].data.contactsBackfillClaimedAt);
    const writesAtEnd: number = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(db.organization.updateMany.mock.calls.length).toBe(writesAtEnd);
  });

  it("skips a workspace another instance has claimed", async () => {
    const { svc, db, calls } = build([{ id: "org-1" }], undefined, 0);
    await svc.run();
    expect(calls).toEqual([]);
    // Only the failed claim attempt; nothing released.
    expect(db.organization.updateMany).toHaveBeenCalledTimes(1);
  });

  it("leaves the version unchanged and releases the claim when a step throws, so the next boot retries", async () => {
    const { svc, db } = build([{ id: "org-1" }], "backfillOrgSteps");
    await svc.run();
    const { claimedAt, release } = claimAndRelease(db);
    expect(release).toEqual({
      where: { id: "org-1", contactsBackfillClaimedAt: claimedAt },
      data: { contactsBackfillClaimedAt: null },
    });
  });

  it("leaves the version unchanged when a single row failed", async () => {
    const { svc, db } = build([{ id: "org-1" }]);
    (svc as unknown as Steps).backfillOrgSteps = mock(async () => {
      (svc as unknown as { logFailure: (m: string, e: unknown) => void }).logFailure("row failed", new Error("x"));
    });
    await svc.run();
    expect(claimAndRelease(db).release.data).toEqual({ contactsBackfillClaimedAt: null });
  });
});
