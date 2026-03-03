import { describe, test, expect, beforeEach, mock } from "bun:test";
import { InvoiceOverdueTask } from "./invoice-overdue.task";
import type { PrismaService } from "../prisma/prisma.service";

interface UpdateManyArgs {
  where: { status: string; dueDate: { lt: Date } };
  data: { status: string };
}

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------
function makeBasePrisma() {
  return {
    invoice: {
      updateMany: mock(() => Promise.resolve({ count: 0 })),
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("InvoiceOverdueTask", () => {
  let task: InvoiceOverdueTask;
  let prisma: ReturnType<typeof makeBasePrisma>;

  beforeEach(() => {
    prisma = makeBasePrisma();
    task = new InvoiceOverdueTask(prisma as unknown as PrismaService);
  });

  // --- Query correctness ---

  test("markOverdueInvoices queries only invoices with status 'sent'", async () => {
    await task.markOverdueInvoices();

    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "sent" }),
      }),
    );
  });

  test("markOverdueInvoices filters by dueDate less than the current time", async () => {
    const before = new Date();

    await task.markOverdueInvoices();

    const after = new Date();

    const callArgs = prisma.invoice.updateMany.mock.calls[0][0] as UpdateManyArgs;
    const dueDateFilter = callArgs.where.dueDate.lt as Date;

    // The timestamp passed to Prisma must fall within the test window
    expect(dueDateFilter.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(dueDateFilter.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("markOverdueInvoices updates matching invoices to status 'overdue'", async () => {
    await task.markOverdueInvoices();

    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "overdue" },
      }),
    );
  });

  test("markOverdueInvoices is called exactly once per invocation", async () => {
    await task.markOverdueInvoices();

    expect(prisma.invoice.updateMany).toHaveBeenCalledTimes(1);
  });

  // --- Return value / side-effect isolation ---

  test("markOverdueInvoices does not throw when no invoices are overdue (count = 0)", async () => {
    prisma.invoice.updateMany.mockImplementation(() =>
      Promise.resolve({ count: 0 }),
    );

    await expect(task.markOverdueInvoices()).resolves.toBeUndefined();
  });

  test("markOverdueInvoices does not throw when multiple invoices are updated", async () => {
    prisma.invoice.updateMany.mockImplementation(() =>
      Promise.resolve({ count: 5 }),
    );

    await expect(task.markOverdueInvoices()).resolves.toBeUndefined();
  });

  // --- Idempotence ---

  test("running markOverdueInvoices twice issues two separate updateMany calls", async () => {
    prisma.invoice.updateMany
      .mockImplementationOnce(() => Promise.resolve({ count: 3 }))
      .mockImplementationOnce(() => Promise.resolve({ count: 0 }));

    await task.markOverdueInvoices();
    await task.markOverdueInvoices();

    expect(prisma.invoice.updateMany).toHaveBeenCalledTimes(2);
  });

  // --- Error propagation ---

  test("markOverdueInvoices propagates database errors", async () => {
    const dbError = new Error("DB connection lost");
    prisma.invoice.updateMany.mockImplementation(() => Promise.reject(dbError));

    try {
      await task.markOverdueInvoices();
      expect(true).toBe(false); // must not reach
    } catch (e) {
      expect(e).toBe(dbError);
    }
  });

  // --- Query shape completeness ---

  test("markOverdueInvoices sends a single updateMany with all required fields", async () => {
    await task.markOverdueInvoices();

    const callArgs = prisma.invoice.updateMany.mock.calls[0][0] as UpdateManyArgs;

    // The where clause must include both the status filter and the dueDate filter
    expect(callArgs.where).toHaveProperty("status", "sent");
    expect(callArgs.where).toHaveProperty("dueDate");
    expect(callArgs.where.dueDate).toHaveProperty("lt");

    // The update payload must set status to overdue
    expect(callArgs.data).toHaveProperty("status", "overdue");
  });

  test("markOverdueInvoices does not update invoices in 'draft' status", async () => {
    await task.markOverdueInvoices();

    const callArgs = prisma.invoice.updateMany.mock.calls[0][0] as UpdateManyArgs;

    // Confirm the where clause only targets 'sent' — not a broader set
    expect(callArgs.where.status).toBe("sent");
    expect(callArgs.where.status).not.toBe("draft");
    expect(callArgs.where.status).not.toBe("paid");
    expect(callArgs.where.status).not.toBe("overdue");
  });

  test("markOverdueInvoices does not update already-overdue invoices", async () => {
    // Already-overdue invoices are excluded because the where clause
    // requires status === 'sent'. This test verifies that constraint is present.
    await task.markOverdueInvoices();

    const callArgs = prisma.invoice.updateMany.mock.calls[0][0] as UpdateManyArgs;
    expect(callArgs.where.status).toBe("sent");
  });
});
