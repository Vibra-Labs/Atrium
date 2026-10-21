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
});
