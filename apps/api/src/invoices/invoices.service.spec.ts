import { afterAll, afterEach, beforeAll, describe, test, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { InvoicesService } from "./invoices.service";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { FilesService } from "../files/files.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import type { CreateInvoiceDto } from "./invoices.dto";
import type { ConfigService } from "@nestjs/config";
import type { SettingsService } from "../settings/settings.service";
import type { StorageProvider } from "../files/storage/storage.interface";

// --- Mock helpers ---

interface PrismaArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

const mockNotifications = {
  notifyInvoiceSent: mock(() => {}),
};

const mockInvoiceFileStorage = {
  upload: mock(() => Promise.resolve()),
  download: mock(() => Promise.reject(new Error("download not used"))),
  getSignedUrl: mock(() => Promise.reject(new Error("signed URL not used"))),
  delete: mock(() => Promise.resolve()),
};

const mockInvoiceSettings = {
  getEffectiveMaxFileSize: mock(() => Promise.resolve(50)),
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

describe("InvoicesService.recordExternalInvoice", () => {
  let integrationService: InvoicesService;
  let filesService: FilesService;
  let realPrisma: PrismaService;
  let createdOrgIds: string[] = [];
  let createdUserIds: string[] = [];
  let createdFileIds: string[] = [];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        InvoicesService,
        PrismaService,
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    integrationService = mod.get(InvoicesService);
    realPrisma = mod.get(PrismaService);
    filesService = new FilesService(
      realPrisma,
      {} as ConfigService,
      mockInvoiceSettings as unknown as SettingsService,
      mockInvoiceFileStorage as unknown as StorageProvider,
    );
  });

  beforeEach(() => {
    createdOrgIds = [];
    createdUserIds = [];
    createdFileIds = [];
  });

  afterEach(async () => {
    if (createdOrgIds.length > 0) {
      await realPrisma.invoice.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
    }
    if (createdFileIds.length > 0) {
      await realPrisma.file.deleteMany({ where: { id: { in: createdFileIds } } });
    }
    if (createdOrgIds.length > 0) {
      await realPrisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    }
    if (createdUserIds.length > 0) {
      await realPrisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  afterAll(async () => {
    await realPrisma.$disconnect();
  });

  async function createFixture(label = "record") {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const org = await realPrisma.organization.create({
      data: { id: `${label}-org-${stamp}`, name: `${label} org ${stamp}`, slug: `${label}-${stamp}` },
    });
    const otherOrg = await realPrisma.organization.create({
      data: { id: `${label}-other-org-${stamp}`, name: `${label} other org ${stamp}`, slug: `${label}-other-${stamp}` },
    });
    createdOrgIds.push(org.id, otherOrg.id);

    const user = await realPrisma.user.create({
      data: { id: `${label}-user-${stamp}`, name: "Invoice Test User", email: `${label}-${stamp}@example.com` },
    });
    createdUserIds.push(user.id);

    const project = await realPrisma.project.create({
      data: { name: `${label} project`, slug: `${label}-project-${stamp}`, organizationId: org.id },
    });
    const otherProject = await realPrisma.project.create({
      data: { name: `${label} other project`, slug: `${label}-other-project-${stamp}`, organizationId: otherOrg.id },
    });
    const billingClient = await realPrisma.billingClient.create({
      data: { name: `${label} client ${stamp}`, slug: `${label}-client-${stamp}`, organizationId: org.id },
    });
    const otherBillingClient = await realPrisma.billingClient.create({
      data: { name: `${label} other client ${stamp}`, slug: `${label}-other-client-${stamp}`, organizationId: otherOrg.id },
    });

    const startedAt = new Date("2026-05-31T12:00:00.000Z");
    const endedAt = new Date("2026-05-31T13:00:00.000Z");

    return {
      org,
      otherOrg,
      user,
      project,
      otherProject,
      billingClient,
      otherBillingClient,
      startedAt,
      endedAt,
    };
  }

  async function createTimeEntry(args: {
    orgId: string;
    projectId: string;
    userId: string;
    description: string;
    invoiceLineItemId?: string | null;
  }) {
    return realPrisma.timeEntry.create({
      data: {
        organizationId: args.orgId,
        projectId: args.projectId,
        userId: args.userId,
        description: args.description,
        startedAt: new Date("2026-05-31T12:00:00.000Z"),
        endedAt: new Date("2026-05-31T13:00:00.000Z"),
        durationSec: 3600,
        billable: true,
        hourlyRateCents: 15000,
        invoiceLineItemId: args.invoiceLineItemId,
      },
    });
  }

  test("record/upload with billingClientId and no projectId succeeds and stores file billingClientId", async () => {
    const fx = await createFixture("record-upload-client");
    const entry = await createTimeEntry({
      orgId: fx.org.id,
      projectId: fx.project.id,
      userId: fx.user.id,
      description: "Billing-client upload entry",
    });

    const uploadedFile = await filesService.upload(
      {
        originalname: "digits-invoice.pdf",
        buffer: Buffer.from("pdf"),
        mimetype: "application/pdf",
        size: 3,
      },
      { billingClientId: fx.billingClient.id },
      fx.org.id,
      fx.user.id,
    );
    createdFileIds.push(uploadedFile.id);

    const invoice = await integrationService.recordExternalInvoice({
      billingClientId: fx.billingClient.id,
      externalReference: "DIG-UPLOAD-CLIENT",
      amount: 17500,
      timeEntryIds: [entry.id],
    }, fx.org.id, uploadedFile.id);

    const reloadedFile = await realPrisma.file.findUniqueOrThrow({ where: { id: uploadedFile.id } });

    expect(invoice.type).toBe("uploaded");
    expect(invoice.projectId).toBeNull();
    expect(invoice.billingClientId).toBe(fx.billingClient.id);
    expect(invoice.uploadedFileId).toBe(uploadedFile.id);
    expect(reloadedFile.projectId).toBeNull();
    expect(reloadedFile.billingClientId).toBe(fx.billingClient.id);
  });

  test("record/upload rejects when neither projectId nor billingClientId is provided", async () => {
    const fx = await createFixture("record-upload-neither");
    const entry = await createTimeEntry({
      orgId: fx.org.id,
      projectId: fx.project.id,
      userId: fx.user.id,
      description: "Neither scope entry",
    });

    await expect(integrationService.recordExternalInvoice({
      externalReference: "DIG-NO-SCOPE",
      amount: 10000,
      timeEntryIds: [entry.id],
    } as Parameters<InvoicesService["recordExternalInvoice"]>[0], fx.org.id)).rejects.toBeInstanceOf(BadRequestException);

    expect(await realPrisma.invoice.count({
      where: { organizationId: fx.org.id, externalReference: "DIG-NO-SCOPE" },
    })).toBe(0);
  });

  test("existing projectId-only upload path still creates a project-attributed file", async () => {
    const fx = await createFixture("record-upload-project");

    const uploadedFile = await filesService.upload(
      {
        originalname: "project-doc.pdf",
        buffer: Buffer.from("pdf"),
        mimetype: "application/pdf",
        size: 3,
      },
      fx.project.id,
      fx.org.id,
      fx.user.id,
    );
    createdFileIds.push(uploadedFile.id);

    const reloadedFile = await realPrisma.file.findUniqueOrThrow({ where: { id: uploadedFile.id } });
    expect(reloadedFile.projectId).toBe(fx.project.id);
    expect(reloadedFile.billingClientId).toBeNull();
  });

  test("records an external Digits invoice with no file and marks selected time entries billed", async () => {
    const fx = await createFixture("record-ok");
    const firstEntry = await createTimeEntry({
      orgId: fx.org.id,
      projectId: fx.project.id,
      userId: fx.user.id,
      description: "Discovery",
    });
    const secondEntry = await createTimeEntry({
      orgId: fx.org.id,
      projectId: fx.project.id,
      userId: fx.user.id,
      description: "Build",
    });

    const invoice = await integrationService.recordExternalInvoice({
      billingClientId: fx.billingClient.id,
      externalReference: "DIG-1001",
      amount: 27500,
      timeEntryIds: [firstEntry.id, secondEntry.id],
      notes: "Recorded from Digits",
    }, fx.org.id);

    expect(invoice.type).toBe("external");
    expect(invoice.status).toBe("draft");
    expect(invoice.amount).toBe(27500);
    expect(invoice.externalReference).toBe("DIG-1001");
    expect(invoice.billingClientId).toBe(fx.billingClient.id);
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.lineItems[0].unitPrice).toBe(27500);

    const entries = await realPrisma.timeEntry.findMany({
      where: { id: { in: [firstEntry.id, secondEntry.id] } },
      orderBy: { id: "asc" },
    });
    expect(entries.every((entry) => entry.invoiceLineItemId === invoice.lineItems[0].id)).toBe(true);
  });

  test("hard-rejects an already billed time entry and rolls back invoice creation plus entry updates", async () => {
    const fx = await createFixture("record-billed");
    const priorInvoice = await realPrisma.invoice.create({
      data: { invoiceNumber: "INV-9000", organizationId: fx.org.id, status: "draft" },
    });
    const priorLineItem = await realPrisma.invoiceLineItem.create({
      data: { invoiceId: priorInvoice.id, description: "Already billed", quantity: 1, unitPrice: 1000 },
    });
    const unbilledEntry = await createTimeEntry({
      orgId: fx.org.id,
      projectId: fx.project.id,
      userId: fx.user.id,
      description: "Should remain unbilled",
    });
    const billedEntry = await createTimeEntry({
      orgId: fx.org.id,
      projectId: fx.project.id,
      userId: fx.user.id,
      description: "Already billed",
      invoiceLineItemId: priorLineItem.id,
    });
    const beforeInvoiceCount = await realPrisma.invoice.count({
      where: { organizationId: fx.org.id, externalReference: "DIG-ROLLBACK" },
    });

    await expect(integrationService.recordExternalInvoice({
      billingClientId: fx.billingClient.id,
      externalReference: "DIG-ROLLBACK",
      amount: 12500,
      timeEntryIds: [unbilledEntry.id, billedEntry.id],
    }, fx.org.id)).rejects.toBeInstanceOf(BadRequestException);

    const afterInvoiceCount = await realPrisma.invoice.count({
      where: { organizationId: fx.org.id, externalReference: "DIG-ROLLBACK" },
    });
    const reloaded = await realPrisma.timeEntry.findMany({
      where: { id: { in: [unbilledEntry.id, billedEntry.id] } },
    });
    const reloadedById = new Map(reloaded.map((entry) => [entry.id, entry]));

    expect(beforeInvoiceCount).toBe(0);
    expect(afterInvoiceCount).toBe(0);
    expect(reloadedById.get(unbilledEntry.id)?.invoiceLineItemId).toBeNull();
    expect(reloadedById.get(billedEntry.id)?.invoiceLineItemId).toBe(priorLineItem.id);
  });

  test("rejects time entries from another organization or not found", async () => {
    const fx = await createFixture("record-missing");
    const ownEntry = await createTimeEntry({
      orgId: fx.org.id,
      projectId: fx.project.id,
      userId: fx.user.id,
      description: "Own org entry",
    });
    const otherOrgEntry = await createTimeEntry({
      orgId: fx.otherOrg.id,
      projectId: fx.otherProject.id,
      userId: fx.user.id,
      description: "Other org entry",
    });

    await expect(integrationService.recordExternalInvoice({
      billingClientId: fx.billingClient.id,
      externalReference: "DIG-MISSING",
      amount: 10000,
      timeEntryIds: [ownEntry.id, otherOrgEntry.id, "missing-time-entry-id"],
    }, fx.org.id)).rejects.toBeInstanceOf(BadRequestException);

    expect(await realPrisma.invoice.count({
      where: { organizationId: fx.org.id, externalReference: "DIG-MISSING" },
    })).toBe(0);
    const ownReloaded = await realPrisma.timeEntry.findUnique({ where: { id: ownEntry.id } });
    expect(ownReloaded?.invoiceLineItemId).toBeNull();
  });

  test("rejects a billing client from another organization", async () => {
    const fx = await createFixture("record-client-scope");
    const entry = await createTimeEntry({
      orgId: fx.org.id,
      projectId: fx.project.id,
      userId: fx.user.id,
      description: "Own org entry",
    });

    await expect(integrationService.recordExternalInvoice({
      billingClientId: fx.otherBillingClient.id,
      externalReference: "DIG-OTHER-CLIENT",
      amount: 10000,
      timeEntryIds: [entry.id],
    }, fx.org.id)).rejects.toBeInstanceOf(ForbiddenException);

    expect(await realPrisma.invoice.count({
      where: { organizationId: fx.org.id, externalReference: "DIG-OTHER-CLIENT" },
    })).toBe(0);
    const reloaded = await realPrisma.timeEntry.findUnique({ where: { id: entry.id } });
    expect(reloaded?.invoiceLineItemId).toBeNull();
  });
});
