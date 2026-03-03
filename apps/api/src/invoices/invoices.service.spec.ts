import { describe, test, expect, beforeEach, mock } from "bun:test";
import { InvoicesService } from "./invoices.service";
import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { CreateInvoiceDto } from "./invoices.dto";

// --- Mock helpers ---

interface PrismaArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

const mockNotifications = {
  notifyInvoiceSent: mock(() => {}),
};

function makeBasePrisma() {
  return {
    invoice: {
      findFirst: mock(() => Promise.resolve(null)),
      findMany: mock(() => Promise.resolve([])),
      count: mock(() => Promise.resolve(0)),
      create: mock((args: PrismaArgs) =>
        Promise.resolve({ id: "inv-1", ...args.data }),
      ),
      update: mock((args: PrismaArgs) =>
        Promise.resolve({ id: args.where?.id, ...args.data, lineItems: [] }),
      ),
      delete: mock(() => Promise.resolve()),
      groupBy: mock(() => Promise.resolve([])),
    },
    invoiceLineItem: {
      deleteMany: mock(() => Promise.resolve({ count: 0 })),
    },
    project: {
      findFirst: mock(() =>
        Promise.resolve({ id: "proj-1", organizationId: "org-1" }),
      ),
    },
    projectClient: {
      findMany: mock(() => Promise.resolve([])),
      findFirst: mock(() => Promise.resolve(null)),
    },
    $transaction: mock((fn: (tx: Record<string, unknown>) => unknown) => {
      // Provide a minimal tx that proxies to the outer mock
      return fn({
        invoice: {
          findFirst: mock(() => Promise.resolve(null)),
          create: mock((args: PrismaArgs) =>
            Promise.resolve({ id: "inv-1", ...args.data, lineItems: [] }),
          ),
          update: mock((args: PrismaArgs) =>
            Promise.resolve({
              id: args.where?.id,
              ...args.data,
              lineItems: [],
            }),
          ),
        },
        invoiceLineItem: {
          deleteMany: mock(() => Promise.resolve({ count: 0 })),
        },
      });
    }),
    $queryRaw: mock(() => Promise.resolve([])),
  };
}

describe("InvoicesService", () => {
  let service: InvoicesService;
  let prisma: ReturnType<typeof makeBasePrisma>;

  const orgId = "org-1";

  const baseLineItem = { description: "Design work", quantity: 1, unitPrice: 5000 };
  const createDto: CreateInvoiceDto = {
    lineItems: [baseLineItem],
    dueDate: undefined,
    notes: undefined,
    projectId: "proj-1",
  };

  beforeEach(() => {
    prisma = makeBasePrisma();
    service = new InvoicesService(prisma as unknown as PrismaService, mockNotifications as unknown as NotificationsService);
  });

  // --- Invoice number format ---

  test("first invoice gets number INV-0001", async () => {
    let capturedInvoiceNumber = "";

    prisma.$transaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => unknown) => {
      const tx = {
        invoice: {
          findFirst: mock(() => Promise.resolve(null)),
          create: mock((args: PrismaArgs) => {
            capturedInvoiceNumber = args.data?.invoiceNumber as string;
            return Promise.resolve({ id: "inv-1", ...args.data, lineItems: [] });
          }),
        },
      };
      return fn(tx);
    });

    await service.create(createDto, orgId);

    expect(capturedInvoiceNumber).toBe("INV-0001");
  });

  test("invoice number pads to 4 digits (INV-0042 for the 42nd invoice)", async () => {
    let capturedInvoiceNumber = "";

    prisma.$transaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => unknown) => {
      const tx = {
        invoice: {
          findFirst: mock(() =>
            Promise.resolve({ invoiceNumber: "INV-0041" }),
          ),
          create: mock((args: PrismaArgs) => {
            capturedInvoiceNumber = args.data?.invoiceNumber as string;
            return Promise.resolve({ id: "inv-42", ...args.data, lineItems: [] });
          }),
        },
      };
      return fn(tx);
    });

    await service.create(createDto, orgId);

    expect(capturedInvoiceNumber).toBe("INV-0042");
  });

  test("invoice number exceeds 4 digits correctly (INV-10000 for the 10000th)", async () => {
    let capturedInvoiceNumber = "";

    prisma.$transaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => unknown) => {
      const tx = {
        invoice: {
          findFirst: mock(() =>
            Promise.resolve({ invoiceNumber: "INV-9999" }),
          ),
          create: mock((args: PrismaArgs) => {
            capturedInvoiceNumber = args.data?.invoiceNumber as string;
            return Promise.resolve({ id: "inv-big", ...args.data, lineItems: [] });
          }),
        },
      };
      return fn(tx);
    });

    await service.create(createDto, orgId);

    expect(capturedInvoiceNumber).toBe("INV-10000");
  });

  // --- Race condition retry ---

  test("retries on P2002 conflict and succeeds on second attempt", async () => {
    let callCount = 0;

    prisma.$transaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => unknown) => {
      callCount += 1;
      if (callCount === 1) {
        const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        throw err;
      }
      // Second attempt succeeds
      const tx = {
        invoice: {
          findFirst: mock(() => Promise.resolve(null)),
          create: mock((args: PrismaArgs) =>
            Promise.resolve({ id: "inv-retry", ...args.data, lineItems: [] }),
          ),
        },
      };
      return fn(tx);
    });

    const result = await service.create(createDto, orgId);

    expect(callCount).toBe(2);
    expect(result).toBeDefined();
  });

  test("does not retry on non-P2002 errors", async () => {
    let callCount = 0;

    prisma.$transaction.mockImplementation(async () => {
      callCount += 1;
      const err = Object.assign(new Error("Some other error"), { code: "P2000" });
      throw err;
    });

    try {
      await service.create(createDto, orgId);
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect((err as { code: string }).code).toBe("P2000");
      expect(callCount).toBe(1);
    }
  });

  test("gives up after 3 P2002 retries and re-throws", async () => {
    prisma.$transaction.mockImplementation(async () => {
      const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      throw err;
    });

    try {
      await service.create(createDto, orgId);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as { code: string }).code).toBe("P2002");
    }
  });

  // --- getStats uses groupBy + $queryRaw (not findMany) ---

  test("getStats calls groupBy and $queryRaw — not findMany", async () => {
    prisma.invoice.groupBy.mockImplementation(() =>
      Promise.resolve([
        { status: "draft", _count: 2 },
        { status: "paid", _count: 1 },
      ]),
    );
    prisma.$queryRaw.mockImplementation(() =>
      Promise.resolve([
        { status: "draft", total: BigInt(10000) },
        { status: "paid", total: BigInt(5000) },
      ]),
    );

    const stats = await service.getStats(orgId);

    expect(prisma.invoice.groupBy).toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
    // findMany must NOT have been called
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    expect(stats.totalInvoices).toBe(3);
  });

  test("getStats computes totalAmount, paidAmount, and outstandingAmount correctly", async () => {
    prisma.invoice.groupBy.mockImplementation(() =>
      Promise.resolve([
        { status: "sent", _count: 1 },
        { status: "paid", _count: 1 },
      ]),
    );
    prisma.$queryRaw.mockImplementation(() =>
      Promise.resolve([
        { status: "sent", total: BigInt(20000) },
        { status: "paid", total: BigInt(8000) },
      ]),
    );

    const stats = await service.getStats(orgId);

    expect(stats.totalAmount).toBe(28000);
    expect(stats.paidAmount).toBe(8000);
    expect(stats.outstandingAmount).toBe(20000);
  });

  test("getStats returns zeroes when there are no invoices", async () => {
    prisma.invoice.groupBy.mockImplementation(() => Promise.resolve([]));
    prisma.$queryRaw.mockImplementation(() => Promise.resolve([]));

    const stats = await service.getStats(orgId);

    expect(stats.totalInvoices).toBe(0);
    expect(stats.totalAmount).toBe(0);
    expect(stats.paidAmount).toBe(0);
    expect(stats.outstandingAmount).toBe(0);
  });

  // --- findOne ---

  test("findOne throws NotFoundException when invoice does not exist", async () => {
    prisma.invoice.findFirst.mockImplementation(() => Promise.resolve(null));

    try {
      await service.findOne("nonexistent", orgId);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundException);
    }
  });

  // --- update triggers notification when status becomes sent ---

  test("update triggers notifyInvoiceSent when invoice transitions to sent", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve({ id: "inv-1", status: "draft", organizationId: orgId }),
    );
    prisma.invoice.update.mockImplementation(() =>
      Promise.resolve({ id: "inv-1", status: "sent", lineItems: [] }),
    );

    await service.update("inv-1", { status: "sent" }, orgId);

    expect(mockNotifications.notifyInvoiceSent).toHaveBeenCalledWith("inv-1");
  });
});
