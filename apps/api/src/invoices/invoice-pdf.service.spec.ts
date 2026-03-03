import { describe, test, expect, beforeEach, mock } from "bun:test";
import { InvoicePdfService } from "./invoice-pdf.service";
import { NotFoundException } from "@nestjs/common";
import { PassThrough, Writable } from "stream";
import type { PrismaService } from "../prisma/prisma.service";

// ---------------------------------------------------------------------------
// PDFDocument mock — avoids real PDF generation in unit tests.
// The mock returns a PassThrough stream that behaves like the real doc.
// ---------------------------------------------------------------------------
mock.module("pdfkit", () => {
  // A minimal stand-in that provides the methods InvoicePdfService calls.
  const MockPDFDocument = class {
    _stream: PassThrough;
    page: { height: number; margins: { top: number; bottom: number } };

    constructor(_opts?: Record<string, unknown>) {
      this._stream = new PassThrough();
      this.page = { height: 842, margins: { top: 50, bottom: 50 } };
    }

    pipe(dest: Writable) {
      // Emit a small amount of data so readable side is non-empty.
      dest.write(Buffer.from("%PDF-1.4 mock"));
      dest.end();
      return dest;
    }

    fontSize(_n: number) { return this; }
    fillColor(_c: string) { return this; }
    text(_t: string, _x?: number, _y?: number, _opts?: Record<string, unknown>) { return this; }
    font(_f: string) { return this; }
    moveTo(_x: number, _y: number) { return this; }
    lineTo(_x: number, _y: number) { return this; }
    strokeColor(_c: string) { return this; }
    lineWidth(_w: number) { return this; }
    stroke() { return this; }
    addPage() { return this; }
    end() { this._stream.end(); }
  };

  return { default: MockPDFDocument };
});

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------
function makeBasePrisma() {
  return {
    invoice: {
      findFirst: mock(() => Promise.resolve(null)),
    },
    organization: {
      findUnique: mock(() =>
        Promise.resolve({ id: "org-1", name: "Acme Corp" }),
      ),
    },
    branding: {
      findUnique: mock(() =>
        Promise.resolve({ primaryColor: "#006b68" }),
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Shared invoice fixture
// ---------------------------------------------------------------------------
function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    invoiceNumber: "INV-0001",
    status: "sent",
    createdAt: new Date("2025-01-15"),
    dueDate: new Date("2025-02-15"),
    notes: null,
    organizationId: "org-1",
    project: { name: "Website Redesign" },
    lineItems: [
      { id: "li-1", description: "Design work", quantity: 2, unitPrice: 5000 },
      { id: "li-2", description: "Development", quantity: 10, unitPrice: 10000 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("InvoicePdfService", () => {
  let service: InvoicePdfService;
  let prisma: ReturnType<typeof makeBasePrisma>;

  beforeEach(() => {
    prisma = makeBasePrisma();
    service = new InvoicePdfService(prisma as unknown as PrismaService);
  });

  // --- Not-found guard ---

  test("generate throws NotFoundException when invoice does not exist", async () => {
    prisma.invoice.findFirst.mockImplementation(() => Promise.resolve(null));

    try {
      await service.generate("nonexistent", "org-1");
      expect(true).toBe(false); // must not reach
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundException);
    }
  });

  test("generate scopes invoice lookup to the given orgId", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice()),
    );

    await service.generate("inv-1", "org-1");

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "inv-1", organizationId: "org-1" }),
      }),
    );
  });

  // --- Return shape ---

  test("generate returns a PassThrough stream and a filename", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice()),
    );

    const result = await service.generate("inv-1", "org-1");

    expect(result).toHaveProperty("stream");
    expect(result).toHaveProperty("filename");
    expect(result.stream).toBeInstanceOf(PassThrough);
  });

  test("filename uses the invoice number with a .pdf extension", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice({ invoiceNumber: "INV-0042" })),
    );

    const { filename } = await service.generate("inv-1", "org-1");

    expect(filename).toBe("INV-0042.pdf");
  });

  // --- Branding fallback ---

  test("uses default primary color when branding record does not exist", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice()),
    );
    // No branding on file
    prisma.branding.findUnique.mockImplementation(() => Promise.resolve(null));

    // Should not throw — service falls back to "#2563eb"
    const result = await service.generate("inv-1", "org-1");
    expect(result.filename).toBe("INV-0001.pdf");
  });

  // --- Org name fallback ---

  test("uses 'Organization' fallback when org record does not exist", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice()),
    );
    prisma.organization.findUnique.mockImplementation(() =>
      Promise.resolve(null),
    );

    // Should not throw
    const result = await service.generate("inv-1", "org-1");
    expect(result.filename).toBe("INV-0001.pdf");
  });

  // --- Invoice without optional fields ---

  test("generate succeeds for an invoice without a dueDate", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice({ dueDate: null })),
    );

    const result = await service.generate("inv-1", "org-1");

    expect(result.filename).toBe("INV-0001.pdf");
    expect(result.stream).toBeInstanceOf(PassThrough);
  });

  test("generate succeeds for an invoice without a linked project", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice({ project: null })),
    );

    const result = await service.generate("inv-1", "org-1");

    expect(result.filename).toBe("INV-0001.pdf");
  });

  test("generate succeeds for an invoice without notes", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice({ notes: null })),
    );

    const result = await service.generate("inv-1", "org-1");

    expect(result.filename).toBe("INV-0001.pdf");
  });

  test("generate includes notes section when notes are present", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice({ notes: "Net 30 payment terms" })),
    );

    // The test just verifies no error is thrown and the return shape is correct.
    // The actual PDF content is verified by the real pdfkit (integration level).
    const result = await service.generate("inv-1", "org-1");

    expect(result.filename).toBe("INV-0001.pdf");
  });

  // --- Line-item total calculation ---

  test("generate succeeds for an invoice with an empty line-items array", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice({ lineItems: [] })),
    );

    const result = await service.generate("inv-1", "org-1");

    expect(result.filename).toBe("INV-0001.pdf");
  });

  test("generate succeeds for an invoice with a single line item", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(
        makeInvoice({
          lineItems: [
            { id: "li-1", description: "Consulting", quantity: 1, unitPrice: 20000 },
          ],
        }),
      ),
    );

    const result = await service.generate("inv-1", "org-1");

    expect(result.filename).toBe("INV-0001.pdf");
  });

  // --- Different invoice statuses ---

  test("generate works for a draft invoice", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice({ status: "draft" })),
    );

    const result = await service.generate("inv-1", "org-1");

    expect(result.filename).toBe("INV-0001.pdf");
  });

  test("generate works for a paid invoice", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice({ status: "paid" })),
    );

    const result = await service.generate("inv-1", "org-1");

    expect(result.filename).toBe("INV-0001.pdf");
  });

  test("generate works for an overdue invoice", async () => {
    prisma.invoice.findFirst.mockImplementation(() =>
      Promise.resolve(makeInvoice({ status: "overdue" })),
    );

    const result = await service.generate("inv-1", "org-1");

    expect(result.filename).toBe("INV-0001.pdf");
  });
});
