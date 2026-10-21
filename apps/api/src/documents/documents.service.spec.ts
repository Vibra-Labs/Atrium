import { describe, expect, it, mock, beforeEach } from "bun:test";
import { DocumentsService } from "./documents.service";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageProvider } from "../files/storage/storage.interface";
import type { NotificationsService } from "../notifications/notifications.service";
import type { ActivityService } from "../activity/activity.service";
import type { DocumentAuditService } from "./document-audit.service";
import type { PinoLogger } from "nestjs-pino";
import type { BillingService } from "../billing/billing.service";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/** Stands in for the temp file TempFileInterceptor writes for uploadVersion. */
const TEMP_PDF = join(tmpdir(), `atrium-documents-spec-${process.pid}.pdf`);
writeFileSync(TEMP_PDF, "%PDF-fake");

const mockBilling = { hasFeature: mock(() => Promise.resolve(true)) };

// ---------------------------------------------------------------------------
// Minimal shared fixtures
// ---------------------------------------------------------------------------

const ORG = "org-1";
const USER = "user-1";
const ADMIN_USER = "admin-1";
const CLIENT_USER = "client-1";
const DOC_ID = "doc-1";
const PROJECT_ID = "proj-1";
const FILE_ID = "file-1";
const FIELD_ID = "field-1";

/** Build a baseline document object. Override individual fields per test. */
function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    organizationId: ORG,
    projectId: PROJECT_ID,
    fileId: FILE_ID,
    title: "Test Doc",
    type: "contract",
    status: "draft",
    requiresSignature: false,
    requiresApproval: false,
    signingOrderEnabled: false,
    reminderEnabled: false,
    reminderIntervalDays: 3,
    options: null,
    signedFileId: null,
    signedFile: null,
    expiresAt: null,
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    sentAt: null,
    file: { id: FILE_ID, storageKey: "org-1/proj-1/docs/file-1.pdf", filename: "doc.pdf" },
    signatureFields: [],
    responses: [],
    ...overrides,
  };
}

/** Build a signature field object. */
function makeField(overrides: Record<string, unknown> = {}) {
  return {
    id: FIELD_ID,
    documentId: DOC_ID,
    pageNumber: 0,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.05,
    type: "signature",
    label: null,
    required: true,
    signerOrder: 0,
    assignedTo: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockPrisma = {
  project: {
    findFirst: mock(() => Promise.resolve({ id: PROJECT_ID, organizationId: ORG })),
  },
  document: {
    findFirst: mock(() => Promise.resolve(makeDoc())),
    findUnique: mock(() => Promise.resolve(makeDoc())),
    create: mock((args: { data: Record<string, unknown>; include?: unknown }) =>
      Promise.resolve({ id: DOC_ID, ...args.data, signatureFields: [], responses: [], file: {}, signedFile: null }),
    ),
    update: mock((args: { where: Record<string, unknown>; data: Record<string, unknown>; include?: unknown }) =>
      Promise.resolve({ id: args.where.id, ...args.data, signatureFields: [], responses: [], file: {}, signedFile: null }),
    ),
    count: mock(() => Promise.resolve(0)),
    findMany: mock(() => Promise.resolve([])),
  },
  documentResponse: {
    findFirst: mock(() => Promise.resolve(null)),
    findMany: mock(() => Promise.resolve([])),
    create: mock((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "resp-1", ...args.data }),
    ),
    update: mock((args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      Promise.resolve({ id: args.where.id, ...args.data }),
    ),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  documentAuditEvent: {
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: "audit-1" })),
  },
  documentAccessToken: {
    findUnique: mock(() => Promise.resolve(null)),
    findFirst: mock(() => Promise.resolve(null)),
    findMany: mock(() => Promise.resolve([])),
    create: mock((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "token-1", ...args.data }),
    ),
    update: mock((args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
      Promise.resolve({ id: args.where.id, ...args.data }),
    ),
  },
  documentVersion: {
    create: mock((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "ver-1", ...args.data }),
    ),
    findFirst: mock(() => Promise.resolve(null)),
  },
  projectClient: {
    findFirst: mock(() => Promise.resolve(null)),
    count: mock(() => Promise.resolve(1)),
  },
  signatureField: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
    createMany: mock(() => Promise.resolve({ count: 1 })),
  },
  user: {
    findUnique: mock(() => Promise.resolve({ id: CLIENT_USER, name: "Test Client" })),
    findMany: mock(() => Promise.resolve([])),
  },
  file: {
    create: mock((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "signed-file-1", ...args.data }),
    ),
    delete: mock(() => Promise.resolve()),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  // $transaction executes the callback immediately with the same mock prisma object
  $transaction: mock(
    (fnOrArray: unknown) => {
      if (typeof fnOrArray === "function") {
        return (fnOrArray as (tx: typeof mockPrisma) => unknown)(mockPrisma);
      }
      return Promise.all(fnOrArray as Promise<unknown>[]);
    },
  ),
  $queryRawUnsafe: mock(() => Promise.resolve([])),
};

const mockStorage: Partial<StorageProvider> = {
  upload: mock(() => Promise.resolve()),
  delete: mock(() => Promise.resolve()),
};

const mockNotifications = {
  notifyDocumentUploaded: mock(() => undefined),
  notifyDocumentResponded: mock(() => undefined),
  notifyDocumentSigningTurn: mock(() => undefined),
};

const mockActivityService = {
  create: mock(() => Promise.resolve()),
};

const mockAuditService = {
  log: mock(() => undefined),
};

const mockLogger = {
  warn: mock(() => undefined),
  error: mock(() => undefined),
  info: mock(() => undefined),
};

// ---------------------------------------------------------------------------
// Helper: reset all mocks before each test
// ---------------------------------------------------------------------------

function resetMocks() {
  for (const table of Object.values(mockPrisma)) {
    if (table && typeof table === "object") {
      for (const fn of Object.values(table)) {
        if (fn && typeof fn === "function" && "mockClear" in fn) {
          (fn as ReturnType<typeof mock>).mockClear();
        }
      }
    }
  }
  for (const fn of Object.values(mockNotifications)) {
    fn.mockClear();
  }
  mockAuditService.log.mockClear();
  mockActivityService.create.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeService() {
  return new DocumentsService(
    mockPrisma as unknown as PrismaService,
    mockStorage as unknown as StorageProvider,
    mockLogger as unknown as PinoLogger,
    mockNotifications as unknown as NotificationsService,
    mockActivityService as unknown as ActivityService,
    mockAuditService as unknown as DocumentAuditService,
    mockBilling as unknown as BillingService,
  );
}

// ===========================================================================
// Tests
// ===========================================================================

describe("DocumentsService", () => {
  let service: DocumentsService;

  beforeEach(() => {
    resetMocks();
    service = makeService();

    // Sensible defaults — individual tests override as needed
    mockPrisma.project.findFirst.mockReturnValue(
      Promise.resolve({ id: PROJECT_ID, organizationId: ORG }),
    );
    mockPrisma.document.create.mockReturnValue(
      Promise.resolve(makeDoc({ status: "draft" })),
    );
    mockPrisma.document.update.mockReturnValue(
      Promise.resolve(makeDoc()),
    );
    mockPrisma.document.findFirst.mockReturnValue(
      Promise.resolve(makeDoc()),
    );
    mockPrisma.document.findUnique.mockReturnValue(
      Promise.resolve(makeDoc()),
    );
    mockPrisma.documentAuditEvent.create.mockReturnValue(
      Promise.resolve({ id: "audit-1" }),
    );
  });

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------

  describe("create()", () => {
    const dto = {
      projectId: PROJECT_ID,
      type: "contract",
      title: "Service Agreement",
      requiresSignature: false,
      requiresApproval: true,
      signingOrderEnabled: false,
      reminderEnabled: false,
      reminderIntervalDays: 3,
    };

    it("forces approval on and signature off for deliverables, with reminders on by default", async () => {
      await service.create(
        { projectId: PROJECT_ID, type: "deliverable", title: "Homepage v1", requiresSignature: true, requiresApproval: false, note: "  First pass  " },
        FILE_ID, ORG, USER,
      );
      expect(mockPrisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "deliverable",
            requiresApproval: true,
            requiresSignature: false,
            reminderEnabled: true,
            requestNote: "First pass",
          }),
        }),
      );
    });

    it("lets the agency turn deliverable reminders off", async () => {
      await service.create(
        { projectId: PROJECT_ID, type: "deliverable", title: "Logo", reminderEnabled: false },
        FILE_ID, ORG, USER,
      );
      expect(mockPrisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ reminderEnabled: false }) }),
      );
    });

    it("leaves non-deliverable defaults unchanged", async () => {
      await service.create({ projectId: PROJECT_ID, type: "contract", title: "MSA" }, FILE_ID, ORG, USER);
      expect(mockPrisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requiresApproval: false, requiresSignature: false, reminderEnabled: false, requestNote: null }),
        }),
      );
    });

    it("throws NotFoundException when project does not belong to org", async () => {
      mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.create(dto, FILE_ID, ORG, USER);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).message).toBe("Project not found");
      }
    });

    it("creates the document with status=draft", async () => {
      const created = makeDoc({ status: "draft", title: dto.title, type: dto.type });
      mockPrisma.document.create.mockReturnValue(Promise.resolve(created));

      const result = await service.create(dto, FILE_ID, ORG, USER);

      expect(result.status).toBe("draft");
      expect(mockPrisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "draft",
            title: dto.title,
            type: dto.type,
            fileId: FILE_ID,
            projectId: PROJECT_ID,
            organizationId: ORG,
            uploadedById: USER,
          }),
        }),
      );
    });

    it("defaults requiresSignature and requiresApproval to false when omitted", async () => {
      const minimalDto = { projectId: PROJECT_ID, type: "other", title: "Minimal" };
      await service.create(minimalDto, FILE_ID, ORG, USER);

      const createCall = mockPrisma.document.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(createCall.data.requiresSignature).toBe(false);
      expect(createCall.data.requiresApproval).toBe(false);
    });

    it("logs a created audit event", async () => {
      mockPrisma.document.create.mockReturnValue(Promise.resolve(makeDoc()));
      await service.create(dto, FILE_ID, ORG, USER);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        DOC_ID,
        "created",
        expect.objectContaining({ userId: USER }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // send()
  // -------------------------------------------------------------------------

  describe("send()", () => {
    it("refuses to send a signature doc when the plan lacks e-signatures", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft", requiresSignature: true, signatureFields: [{ id: "f1" }] })),
      );
      mockBilling.hasFeature.mockResolvedValueOnce(false);

      await expect(service.send(DOC_ID, ORG, USER)).rejects.toThrow(
        "E-signatures are available on paid plans. Please upgrade to continue.",
      );
      expect(mockBilling.hasFeature).toHaveBeenCalledWith(ORG, "e_signatures");
    });

    it("throws NotFoundException when document not found", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.send(DOC_ID, ORG, USER);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });

    it("throws BadRequestException when document is not in draft status", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "pending", signatureFields: [] })),
      );

      try {
        await service.send(DOC_ID, ORG, USER);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("Only draft documents can be sent");
      }
    });

    it("throws BadRequestException when signature doc has no fields placed", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft", requiresSignature: true, signatureFields: [] })),
      );

      try {
        await service.send(DOC_ID, ORG, USER);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("signature fields");
      }
    });

    it("allows sending a signature doc that has at least one field placed", async () => {
      const field = makeField();
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft", requiresSignature: true, signatureFields: [field] })),
      );
      const updated = makeDoc({ status: "pending" });
      mockPrisma.document.update.mockReturnValue(Promise.resolve(updated));

      const result = await service.send(DOC_ID, ORG, USER);
      expect(result.status).toBe("pending");
    });

    it("transitions draft document to pending", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft", signatureFields: [] })),
      );
      const updated = makeDoc({ status: "pending" });
      mockPrisma.document.update.mockReturnValue(Promise.resolve(updated));

      await service.send(DOC_ID, ORG, USER);

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "pending" }),
        }),
      );
    });

    it("sets expiresAt when expiresInDays is provided", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft", signatureFields: [] })),
      );
      mockPrisma.document.update.mockReturnValue(Promise.resolve(makeDoc({ status: "pending" })));

      const before = Date.now();
      await service.send(DOC_ID, ORG, USER, 7);
      const after = Date.now();

      const updateCall = mockPrisma.document.update.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      const expiresAt = updateCall.data.expiresAt as Date;
      expect(expiresAt).toBeDefined();
      // expiresAt should be approximately 7 days from now
      const diff = expiresAt.getTime() - before;
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(diff).toBeGreaterThan(sevenDaysMs - 1000);
      expect(diff).toBeLessThan(sevenDaysMs + (after - before) + 1000);
    });

    it("does not set expiresAt when expiresInDays is omitted", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft", signatureFields: [] })),
      );
      mockPrisma.document.update.mockReturnValue(Promise.resolve(makeDoc({ status: "pending" })));

      await service.send(DOC_ID, ORG, USER);

      const updateCall = mockPrisma.document.update.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(updateCall.data.expiresAt).toBeUndefined();
    });

    it("fires notifyDocumentUploaded after send", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft", signatureFields: [] })),
      );
      mockPrisma.document.update.mockReturnValue(Promise.resolve(makeDoc({ status: "pending" })));

      await service.send(DOC_ID, ORG, USER);
      expect(mockNotifications.notifyDocumentUploaded).toHaveBeenCalledWith(DOC_ID);
    });
  });

  // -------------------------------------------------------------------------
  // voidDocument()
  // -------------------------------------------------------------------------

  describe("voidDocument()", () => {
    it("throws NotFoundException when document not found", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.voidDocument(DOC_ID, ORG, USER);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });

    it("throws BadRequestException when document is already voided", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "voided" })),
      );

      try {
        await service.voidDocument(DOC_ID, ORG, USER);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain('"voided"');
      }
    });

    it("throws BadRequestException when document is accepted", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "accepted" })),
      );

      try {
        await service.voidDocument(DOC_ID, ORG, USER);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
      }
    });

    it("voids a declined deliverable", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ type: "deliverable", status: "declined" })),
      );
      await service.voidDocument(DOC_ID, ORG, USER);
      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "voided" }) }),
      );
    });

    it("still refuses to void a declined contract", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ type: "contract", status: "declined" })),
      );
      await expect(service.voidDocument(DOC_ID, ORG, USER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("voids a draft document successfully", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft" })),
      );
      const voided = makeDoc({ status: "voided" });
      mockPrisma.document.update.mockReturnValue(Promise.resolve(voided));

      const result = await service.voidDocument(DOC_ID, ORG, USER, "Changed my mind");

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "voided",
            voidedById: USER,
            voidReason: "Changed my mind",
          }),
        }),
      );
      expect(result.status).toBe("voided");
    });

    it("voids a pending document successfully", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "pending" })),
      );
      mockPrisma.document.update.mockReturnValue(Promise.resolve(makeDoc({ status: "voided" })));

      await service.voidDocument(DOC_ID, ORG, USER);

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "voided" }),
        }),
      );
    });

    it("stores null for voidReason when no reason provided", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "pending" })),
      );
      mockPrisma.document.update.mockReturnValue(Promise.resolve(makeDoc({ status: "voided" })));

      await service.voidDocument(DOC_ID, ORG, USER);

      const updateCall = mockPrisma.document.update.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(updateCall.data.voidReason).toBeNull();
    });

    it("logs a voided audit event", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft" })),
      );
      mockPrisma.document.update.mockReturnValue(Promise.resolve(makeDoc({ status: "voided" })));

      await service.voidDocument(DOC_ID, ORG, USER, "Oops");

      expect(mockAuditService.log).toHaveBeenCalledWith(
        DOC_ID,
        "voided",
        expect.objectContaining({ userId: USER }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // respond()
  // -------------------------------------------------------------------------

  describe("respond()", () => {
    function setupRespondableDoc(overrides: Record<string, unknown> = {}) {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(
          makeDoc({ status: "pending", requiresApproval: true, ...overrides }),
        ),
      );
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: PROJECT_ID, userId: CLIENT_USER }),
      );
    }

    it("still blocks changing a decided contract", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(makeDoc({ type: "contract", status: "accepted", requiresApproval: true })));
      await expect(service.respond(DOC_ID, CLIENT_USER, ORG, "declined")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws NotFoundException when document not found", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });

    it.each(["draft", "voided", "expired", "accepted", "declined", "signed"])(
      "blocks respond when document status is '%s'",
      async (status) => {
        mockPrisma.document.findFirst.mockReturnValue(
          Promise.resolve(makeDoc({ status })),
        );

        try {
          await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");
          expect(true).toBe(false);
        } catch (e) {
          expect(e).toBeInstanceOf(BadRequestException);
          expect((e as BadRequestException).message).toContain(`"${status}"`);
        }
      },
    );

    it("throws BadRequestException when document has expired", async () => {
      const pastDate = new Date(Date.now() - 1000);
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "pending", requiresApproval: true, expiresAt: pastDate })),
      );
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: PROJECT_ID, userId: CLIENT_USER }),
      );

      try {
        await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("expired");
      }
    });

    it("throws ForbiddenException when user is not a project client", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "pending", requiresApproval: true })),
      );
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
      }
    });

    it("throws BadRequestException when document does not require approval", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "pending", requiresApproval: false })),
      );
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: PROJECT_ID, userId: CLIENT_USER }),
      );

      try {
        await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("does not require approval");
      }
    });

    it("creates a new response for a first-time responder", async () => {
      setupRespondableDoc();
      mockPrisma.documentResponse.findFirst.mockReturnValue(Promise.resolve(null));
      mockPrisma.documentResponse.create.mockReturnValue(
        Promise.resolve({ id: "resp-1", action: "accepted" }),
      );
      // updateDocumentStatus side-effect
      mockPrisma.document.findUnique.mockReturnValue(
        Promise.resolve(makeDoc({ status: "pending", responses: [], requiresApproval: true })),
      );

      const result = await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");
      expect(mockPrisma.documentResponse.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: "accepted", userId: CLIENT_USER, documentId: DOC_ID }),
        }),
      );
      expect(result).toBeDefined();
    });

    it("updates an existing response when the user has already responded", async () => {
      setupRespondableDoc();
      const existing = { id: "resp-existing", documentId: DOC_ID, userId: CLIENT_USER, fieldId: null };
      mockPrisma.documentResponse.findFirst.mockReturnValue(Promise.resolve(existing));
      mockPrisma.documentResponse.update.mockReturnValue(
        Promise.resolve({ id: "resp-existing", action: "declined" }),
      );
      mockPrisma.document.findUnique.mockReturnValue(
        Promise.resolve(makeDoc({ status: "pending", responses: [], requiresApproval: true })),
      );

      await service.respond(DOC_ID, CLIENT_USER, ORG, "declined", undefined, undefined, "Fees too high");

      expect(mockPrisma.documentResponse.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "resp-existing" },
          data: expect.objectContaining({ action: "declined", reason: "Fees too high" }),
        }),
      );
    });

    it("does not expire a document whose expiresAt is in the future", async () => {
      const futureDate = new Date(Date.now() + 86400000);
      setupRespondableDoc({ expiresAt: futureDate });
      mockPrisma.documentResponse.findFirst.mockReturnValue(Promise.resolve(null));
      mockPrisma.documentResponse.create.mockReturnValue(
        Promise.resolve({ id: "resp-1", action: "accepted" }),
      );
      mockPrisma.document.findUnique.mockReturnValue(
        Promise.resolve(makeDoc({ status: "pending", responses: [], requiresApproval: true })),
      );

      // Should not throw
      await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");
      expect(mockPrisma.documentResponse.create).toHaveBeenCalled();
    });
  });

  describe("respond() — deliverables", () => {
    function setupDeliverable(overrides: Record<string, unknown> = {}) {
      const doc = makeDoc({ type: "deliverable", status: "pending", requiresApproval: true, currentVersion: 2, ...overrides });
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(doc));
      mockPrisma.document.findUnique.mockReturnValue(Promise.resolve(doc));
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve({ id: "pc-1", projectId: PROJECT_ID, userId: CLIENT_USER }));
      mockPrisma.documentResponse.create.mockReturnValue(Promise.resolve({ id: "resp-1", action: "accepted" }));
    }

    it("requires a version for deliverable decisions", async () => {
      setupDeliverable();
      await expect(service.respond(DOC_ID, CLIENT_USER, ORG, "accepted")).rejects.toThrow("version is required");
      expect(mockPrisma.documentResponse.create).not.toHaveBeenCalled();
    });

    it("requires a note when requesting changes", async () => {
      setupDeliverable();
      await expect(service.respond(DOC_ID, CLIENT_USER, ORG, "declined", undefined, undefined, "   ", 2)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("one client's decision sets the status and replaces earlier decisions", async () => {
      setupDeliverable();
      await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted", undefined, undefined, undefined, 2);
      expect(mockPrisma.documentResponse.deleteMany).toHaveBeenCalledWith({ where: { documentId: DOC_ID, fieldId: null } });
      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: DOC_ID }, data: { status: "accepted" } }),
      );
      expect(mockPrisma.projectClient.count).not.toHaveBeenCalled();
    });

    it.each(["accepted", "declined"])("allows changing a decision after '%s'", async (status) => {
      setupDeliverable({ status });
      await service.respond(DOC_ID, CLIENT_USER, ORG, "declined", undefined, undefined, "Bigger logo", 2);
      expect(mockPrisma.document.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "declined" } }));
    });

    it.each(["draft", "voided", "expired"])("still blocks '%s' deliverables", async (status) => {
      setupDeliverable({ status });
      await expect(service.respond(DOC_ID, CLIENT_USER, ORG, "accepted")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("returns 409 when the client decided on an outdated version", async () => {
      setupDeliverable({ currentVersion: 3 });
      await expect(service.respond(DOC_ID, CLIENT_USER, ORG, "accepted", undefined, undefined, undefined, 2)).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.documentResponse.create).not.toHaveBeenCalled();
    });

    it("serializes decisions under the row lock and re-reads the version inside it", async () => {
      // Outer read sees v2, but a v3 upload commits before the lock is taken.
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(makeDoc({ type: "deliverable", status: "pending", requiresApproval: true, currentVersion: 2 })));
      mockPrisma.document.findUnique.mockReturnValue(Promise.resolve(makeDoc({ type: "deliverable", status: "pending", currentVersion: 3 })));
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve({ id: "pc-1" }));
      await expect(service.respond(DOC_ID, CLIENT_USER, ORG, "accepted", undefined, undefined, undefined, 2)).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), DOC_ID);
    });

    it("logs the in-lock version in the audit trail", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(makeDoc({ type: "deliverable", status: "pending", requiresApproval: true, currentVersion: 2 })));
      mockPrisma.document.findUnique.mockReturnValue(Promise.resolve(makeDoc({ type: "deliverable", status: "pending", currentVersion: 2 })));
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve({ id: "pc-1" }));
      mockPrisma.documentResponse.create.mockReturnValue(Promise.resolve({ id: "resp-1", action: "accepted" }));
      await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted", undefined, undefined, undefined, 2);
      expect(mockAuditService.log).toHaveBeenCalledWith(DOC_ID, "accepted", expect.objectContaining({ metadata: { reason: null, version: 2 } }));
    });

    it("keeps the change note in the audit trail", async () => {
      setupDeliverable();
      await service.respond(DOC_ID, CLIENT_USER, ORG, "declined", "1.2.3.4", "ua", "Bigger logo", 2);
      expect(mockAuditService.log).toHaveBeenCalledWith(DOC_ID, "declined", {
        userId: CLIENT_USER, ipAddress: "1.2.3.4", userAgent: "ua", metadata: { reason: "Bigger logo", version: 2 },
      });
    });

    it("notifies the agency once with the deciding client", async () => {
      setupDeliverable();
      await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted", undefined, undefined, undefined, 2);
      expect(mockNotifications.notifyDocumentResponded).toHaveBeenCalledTimes(1);
      expect(mockNotifications.notifyDocumentResponded).toHaveBeenCalledWith(DOC_ID, CLIENT_USER, "accepted");
    });
  });

  // -------------------------------------------------------------------------
  // updateDocumentStatus() — tested via respond() side-effects
  // -------------------------------------------------------------------------

  describe("updateDocumentStatus() (via respond)", () => {
    /** Helper to call respond and have updateDocumentStatus run against a custom doc state. */
    function setupForStatusUpdate(docState: Record<string, unknown>) {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "pending", requiresApproval: true })),
      );
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: PROJECT_ID, userId: CLIENT_USER }),
      );
      mockPrisma.documentResponse.findFirst.mockReturnValue(Promise.resolve(null));
      mockPrisma.documentResponse.create.mockReturnValue(
        Promise.resolve({ id: "resp-new", action: "accepted" }),
      );
      // This is what updateDocumentStatus reads
      mockPrisma.document.findUnique.mockReturnValue(Promise.resolve(makeDoc(docState)));
    }

    it("sets status to declined when any response is declined", async () => {
      setupForStatusUpdate({
        responses: [
          { id: "r1", action: "declined", fieldId: null },
          { id: "r2", action: "accepted", fieldId: null },
        ],
        signatureFields: [],
      });

      await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "declined" }),
        }),
      );
    });

    it("sets status to signed when all signature fields have been signed", async () => {
      const field = makeField({ id: "field-a" });
      setupForStatusUpdate({
        requiresSignature: true,
        signatureFields: [field],
        responses: [{ id: "r1", action: "signed", fieldId: "field-a" }],
      });

      await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "signed" }),
        }),
      );
    });

    it("does not mark as signed when some signature fields remain unsigned", async () => {
      const fieldA = makeField({ id: "field-a" });
      const fieldB = makeField({ id: "field-b" });
      setupForStatusUpdate({
        requiresSignature: true,
        signatureFields: [fieldA, fieldB],
        responses: [{ id: "r1", action: "signed", fieldId: "field-a" }],
      });

      await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");

      // document.update should NOT have been called with status: signed
      const updateCalls = mockPrisma.document.update.mock.calls as Array<
        [{ data: Record<string, unknown> }]
      >;
      const signedCall = updateCalls.find((c) => c[0].data.status === "signed");
      expect(signedCall).toBeUndefined();
    });

    it("sets status to accepted when all project clients have responded positively", async () => {
      setupForStatusUpdate({
        requiresSignature: false,
        signatureFields: [],
        responses: [{ id: "r1", action: "accepted", fieldId: null }],
      });
      mockPrisma.projectClient.count.mockReturnValue(Promise.resolve(1));

      await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "accepted" }),
        }),
      );
    });

    it("does not mark as accepted when fewer clients have responded than are assigned", async () => {
      setupForStatusUpdate({
        requiresSignature: false,
        signatureFields: [],
        responses: [{ id: "r1", action: "accepted", fieldId: null }],
      });
      mockPrisma.projectClient.count.mockReturnValue(Promise.resolve(3));

      await service.respond(DOC_ID, CLIENT_USER, ORG, "accepted");

      const updateCalls = mockPrisma.document.update.mock.calls as Array<
        [{ data: Record<string, unknown> }]
      >;
      const acceptedCall = updateCalls.find((c) => c[0].data.status === "accepted");
      expect(acceptedCall).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // setSignatureFields()
  // -------------------------------------------------------------------------

  describe("setSignatureFields()", () => {
    const sampleFields = [
      { pageNumber: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
    ];

    it("throws NotFoundException when document not found", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.setSignatureFields(DOC_ID, ORG, sampleFields);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });

    it("throws BadRequestException when document is not in draft status", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "pending" })),
      );

      try {
        await service.setSignatureFields(DOC_ID, ORG, sampleFields);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("draft documents");
      }
    });

    it.each(["pending", "voided", "accepted", "declined", "signed"])(
      "blocks editing fields on status '%s'",
      async (status) => {
        mockPrisma.document.findFirst.mockReturnValue(
          Promise.resolve(makeDoc({ status })),
        );

        try {
          await service.setSignatureFields(DOC_ID, ORG, sampleFields);
          expect(true).toBe(false);
        } catch (e) {
          expect(e).toBeInstanceOf(BadRequestException);
        }
      },
    );

    it("deletes existing fields and creates new ones within a transaction", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft" })),
      );
      mockPrisma.document.findUnique.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft", signatureFields: sampleFields })),
      );

      await service.setSignatureFields(DOC_ID, ORG, sampleFields);

      expect(mockPrisma.signatureField.deleteMany).toHaveBeenCalledWith({
        where: { documentId: DOC_ID },
      });
      expect(mockPrisma.signatureField.createMany).toHaveBeenCalled();
    });

    it("skips createMany when fields array is empty (just deletes existing)", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft" })),
      );
      mockPrisma.document.findUnique.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft", signatureFields: [] })),
      );

      await service.setSignatureFields(DOC_ID, ORG, []);

      expect(mockPrisma.signatureField.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.signatureField.createMany).not.toHaveBeenCalled();
    });

    it("defaults field type to 'signature' when not specified", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft" })),
      );
      mockPrisma.document.findUnique.mockReturnValue(
        Promise.resolve(makeDoc({ status: "draft", signatureFields: [] })),
      );

      await service.setSignatureFields(DOC_ID, ORG, [
        { pageNumber: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
      ]);

      const createCall = mockPrisma.signatureField.createMany.mock.calls[0]![0] as {
        data: Array<Record<string, unknown>>;
      };
      expect(createCall.data[0]!.type).toBe("signature");
    });
  });

  // -------------------------------------------------------------------------
  // sign()
  // -------------------------------------------------------------------------

  describe("sign()", () => {
    const signDto = { method: "draw", fieldId: FIELD_ID };

    /** Stand up mocks so that a sign() call can proceed past all guard checks.
     *  Tests override individual mocks to trigger specific failure paths. */
    function setupSignable(docOverrides: Record<string, unknown> = {}) {
      const field = makeField({ id: FIELD_ID });
      const doc = makeDoc({
        status: "pending",
        requiresSignature: true,
        signatureFields: [field],
        file: { id: FILE_ID, storageKey: "key.pdf" },
        signedFileId: null,
        signedFile: null,
        ...docOverrides,
      });

      // $transaction calls the callback with mockPrisma as tx
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(doc));

      // Non-admin client
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: PROJECT_ID, userId: CLIENT_USER }),
      );
      mockPrisma.documentResponse.findFirst.mockReturnValue(Promise.resolve(null));
      mockPrisma.documentResponse.findMany.mockReturnValue(Promise.resolve([]));
    }

    it("throws NotFoundException when document not found in transaction", async () => {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.sign(DOC_ID, CLIENT_USER, ORG, "member", signDto, null);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });

    it("throws BadRequestException when document does not require a signature", async () => {
      setupSignable({ requiresSignature: false });

      try {
        await service.sign(DOC_ID, CLIENT_USER, ORG, "member", signDto, null);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("does not require a signature");
      }
    });

    it.each(["draft", "voided", "expired", "signed"])(
      "blocks signing when document status is '%s'",
      async (status) => {
        setupSignable({ status, requiresSignature: true });

        try {
          await service.sign(DOC_ID, CLIENT_USER, ORG, "member", signDto, null);
          expect(true).toBe(false);
        } catch (e) {
          expect(e).toBeInstanceOf(BadRequestException);
        }
      },
    );

    it("throws BadRequestException when document has expired", async () => {
      setupSignable({ expiresAt: new Date(Date.now() - 1000) });

      try {
        await service.sign(DOC_ID, CLIENT_USER, ORG, "member", signDto, null);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("expired");
      }
    });

    it("throws BadRequestException when fieldId does not exist on the document", async () => {
      setupSignable();

      try {
        await service.sign(DOC_ID, CLIENT_USER, ORG, "member", { method: "draw", fieldId: "nonexistent-field" }, null);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("field not found");
      }
    });

    it("throws ForbiddenException when non-admin user is not a project client", async () => {
      setupSignable();
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.sign(DOC_ID, CLIENT_USER, ORG, "member", signDto, null);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
      }
    });

    it("allows admins to sign without a project client assignment", async () => {
      setupSignable();
      // admin should bypass projectClient check
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));
      // Provide a signature file so we don't hit the "no signature file" error
      // (we stop at PDF manipulation, so we need to prevent the storage.download from running)
      // Instead test that it reaches BadRequestException about file, not ForbiddenException
      const sigFile = {
        buffer: Buffer.from("fake-png"),
        originalname: "sig.png",
        mimetype: "image/png",
        size: 8,
      };

      try {
        await service.sign(DOC_ID, ADMIN_USER, ORG, "admin", signDto, sigFile);
        // May succeed or fail at PDF level — either way no ForbiddenException
      } catch (e) {
        // Should not be a ForbiddenException about project assignment
        if (e instanceof ForbiddenException) {
          // Fail test only if the message is about project assignment
          const msg = (e as ForbiddenException).message;
          expect(msg).not.toContain("Not assigned");
        }
      }
    });

    it("throws BadRequestException when the user has already signed this field", async () => {
      setupSignable();
      mockPrisma.documentResponse.findFirst.mockReturnValue(
        Promise.resolve({ id: "resp-existing", documentId: DOC_ID, userId: CLIENT_USER, fieldId: FIELD_ID }),
      );

      try {
        await service.sign(DOC_ID, CLIENT_USER, ORG, "member", signDto, null);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("already signed");
      }
    });

    it("throws BadRequestException when signing order is enabled and prior fields are not signed", async () => {
      const priorField = makeField({ id: "field-prior", signerOrder: 1 });
      const currentField = makeField({ id: FIELD_ID, signerOrder: 2 });

      setupSignable({
        signingOrderEnabled: true,
        signatureFields: [priorField, currentField],
      });
      mockPrisma.documentResponse.findFirst.mockReturnValue(Promise.resolve(null));
      // No prior signed responses
      mockPrisma.documentResponse.findMany.mockReturnValue(Promise.resolve([]));

      try {
        await service.sign(DOC_ID, CLIENT_USER, ORG, "member", { method: "draw", fieldId: FIELD_ID }, null);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("Previous signers");
      }
    });

    it("allows signing when signing order is enabled and all prior fields are signed", async () => {
      const priorField = makeField({ id: "field-prior", signerOrder: 1 });
      const currentField = makeField({ id: FIELD_ID, signerOrder: 2 });

      setupSignable({
        signingOrderEnabled: true,
        signatureFields: [priorField, currentField],
      });
      mockPrisma.documentResponse.findFirst.mockReturnValue(Promise.resolve(null));
      // Prior field is signed
      mockPrisma.documentResponse.findMany.mockReturnValue(
        Promise.resolve([{ id: "r-prior", action: "signed", fieldId: "field-prior" }]),
      );
      // Provide signature file
      const sigFile = {
        buffer: Buffer.from("fake-png"),
        originalname: "sig.png",
        mimetype: "image/png",
        size: 8,
      };

      try {
        await service.sign(DOC_ID, CLIENT_USER, ORG, "member", { method: "draw", fieldId: FIELD_ID }, sigFile);
        // Passing the guard is the goal — PDF manipulation may fail, that's OK
      } catch (e) {
        // Should not be BadRequestException about signing order
        if (e instanceof BadRequestException) {
          expect((e as BadRequestException).message).not.toContain("Previous signers");
        }
      }
    });

    it("throws ForbiddenException when field is assigned to a different user", async () => {
      const assignedField = makeField({ id: FIELD_ID, assignedTo: "another-user" });
      setupSignable({ signatureFields: [assignedField] });

      try {
        await service.sign(DOC_ID, CLIENT_USER, ORG, "member", signDto, null);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect((e as ForbiddenException).message).toContain("assigned to another signer");
      }
    });

    it("throws BadRequestException when no signature file is provided for a signature field", async () => {
      setupSignable();

      try {
        await service.sign(DOC_ID, CLIENT_USER, ORG, "member", signDto, null);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("No signature file provided");
      }
    });

    it("throws BadRequestException when signature file has a disallowed MIME type", async () => {
      setupSignable();
      const badFile = {
        buffer: Buffer.from("fake-gif"),
        originalname: "sig.gif",
        mimetype: "image/gif",
        size: 8,
      };

      try {
        await service.sign(DOC_ID, CLIENT_USER, ORG, "member", signDto, badFile);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("PNG or JPEG");
      }
    });
  });

  // -------------------------------------------------------------------------
  // generateAccessToken()
  // -------------------------------------------------------------------------

  describe("getViewStream()", () => {
    it("returns the URL for a link deliverable instead of streaming", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({
          type: "deliverable",
          file: { id: FILE_ID, type: "LINK", url: "https://figma.com/file/abc", storageKey: null, filename: "Homepage" },
        })),
      );
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve({ id: "pc-1" }));

      const result = await service.getViewStream(DOC_ID, CLIENT_USER, ORG, "member");

      expect(result).toEqual({ kind: "link", url: "https://figma.com/file/abc" });
      expect(mockAuditService.log).toHaveBeenCalledWith(DOC_ID, "viewed", { userId: CLIENT_USER });
    });
  });

  describe("generateAccessToken()", () => {
    it("throws NotFoundException when document does not belong to org", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.generateAccessToken(DOC_ID, CLIENT_USER, ORG);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).message).toBe("Document not found");
      }
    });

    it("throws BadRequestException when user is not a project client", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(makeDoc()));
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.generateAccessToken(DOC_ID, CLIENT_USER, ORG);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("not a client");
      }
    });

    it("returns a raw token and expiresAt when valid", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(makeDoc()));
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: PROJECT_ID, userId: CLIENT_USER }),
      );
      mockPrisma.documentAccessToken.create.mockReturnValue(
        Promise.resolve({ id: "tok-1", token: "hashed", expiresAt: new Date() }),
      );

      const result = await service.generateAccessToken(DOC_ID, CLIENT_USER, ORG);

      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe("string");
      expect(result.token.length).toBeGreaterThan(0);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("creates access token record scoped to the correct document and user", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(makeDoc()));
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: PROJECT_ID, userId: CLIENT_USER }),
      );
      mockPrisma.documentAccessToken.create.mockReturnValue(
        Promise.resolve({ id: "tok-1" }),
      );

      await service.generateAccessToken(DOC_ID, CLIENT_USER, ORG);

      expect(mockPrisma.documentAccessToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            documentId: DOC_ID,
            userId: CLIENT_USER,
          }),
        }),
      );
    });

    it("stores a hash of the token — not the raw token — in the database", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(makeDoc()));
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: PROJECT_ID, userId: CLIENT_USER }),
      );
      mockPrisma.documentAccessToken.create.mockReturnValue(
        Promise.resolve({ id: "tok-1" }),
      );

      const result = await service.generateAccessToken(DOC_ID, CLIENT_USER, ORG);

      const createCall = mockPrisma.documentAccessToken.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      // The stored token should NOT equal the raw token returned to the caller
      expect(createCall.data.token).not.toBe(result.token);
    });

    it("caps expiresAt to doc.expiresAt when that is sooner than 30 days", async () => {
      const docExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ expiresAt: docExpiry })),
      );
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: PROJECT_ID, userId: CLIENT_USER }),
      );
      mockPrisma.documentAccessToken.create.mockReturnValue(
        Promise.resolve({ id: "tok-1" }),
      );

      const result = await service.generateAccessToken(DOC_ID, CLIENT_USER, ORG);

      // The returned expiresAt must be <= docExpiry (within a few ms of execution time)
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(docExpiry.getTime() + 100);
    });
  });

  // -------------------------------------------------------------------------
  // validateAccessToken()
  // -------------------------------------------------------------------------

  describe("validateAccessToken()", () => {
    const RAW_TOKEN = "a".repeat(64);

    function makeTokenRecord(overrides: Record<string, unknown> = {}) {
      return {
        id: "tok-1",
        token: "hashed",
        userId: CLIENT_USER,
        documentId: DOC_ID,
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
        usedAt: null,
        document: makeDoc({ status: "pending" }),
        ...overrides,
      };
    }

    it("throws NotFoundException when token record is not found", async () => {
      mockPrisma.documentAccessToken.findUnique.mockReturnValue(Promise.resolve(null));

      try {
        await service.validateAccessToken(RAW_TOKEN);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).message).toContain("Invalid or expired link");
      }
    });

    it("throws BadRequestException when token has expired", async () => {
      const expired = makeTokenRecord({ expiresAt: new Date(Date.now() - 1000) });
      mockPrisma.documentAccessToken.findUnique.mockReturnValue(Promise.resolve(expired));

      try {
        await service.validateAccessToken(RAW_TOKEN);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("expired");
      }
    });

    it.each(["voided", "expired", "draft"])(
      "throws BadRequestException when document status is '%s'",
      async (status) => {
        const record = makeTokenRecord({ document: makeDoc({ status }) });
        mockPrisma.documentAccessToken.findUnique.mockReturnValue(Promise.resolve(record));

        try {
          await service.validateAccessToken(RAW_TOKEN);
          expect(true).toBe(false);
        } catch (e) {
          expect(e).toBeInstanceOf(BadRequestException);
          expect((e as BadRequestException).message).toContain("no longer available");
        }
      },
    );

    it("returns document info for a valid token with a pending document", async () => {
      const record = makeTokenRecord();
      mockPrisma.documentAccessToken.findUnique.mockReturnValue(Promise.resolve(record));
      mockPrisma.documentAccessToken.update.mockReturnValue(Promise.resolve(record));

      const result = await service.validateAccessToken(RAW_TOKEN);

      expect(result.userId).toBe(CLIENT_USER);
      expect(result.documentId).toBe(DOC_ID);
      expect(result.document).toBeDefined();
    });

    it("marks the token as used on first access", async () => {
      const record = makeTokenRecord({ usedAt: null });
      mockPrisma.documentAccessToken.findUnique.mockReturnValue(Promise.resolve(record));
      mockPrisma.documentAccessToken.update.mockReturnValue(Promise.resolve(record));

      await service.validateAccessToken(RAW_TOKEN);

      expect(mockPrisma.documentAccessToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "tok-1" },
          data: expect.objectContaining({ usedAt: expect.any(Date) }),
        }),
      );
    });

    it("does not re-mark the token as used when it was already used", async () => {
      const record = makeTokenRecord({ usedAt: new Date(Date.now() - 1000) });
      mockPrisma.documentAccessToken.findUnique.mockReturnValue(Promise.resolve(record));

      await service.validateAccessToken(RAW_TOKEN);

      expect(mockPrisma.documentAccessToken.update).not.toHaveBeenCalled();
    });

    it("accepts signed and accepted document statuses", async () => {
      for (const status of ["signed", "accepted", "pending"]) {
        mockPrisma.documentAccessToken.update.mockClear();
        const record = makeTokenRecord({ document: makeDoc({ status }) });
        mockPrisma.documentAccessToken.findUnique.mockReturnValue(Promise.resolve(record));
        mockPrisma.documentAccessToken.update.mockReturnValue(Promise.resolve(record));

        // Should not throw
        const result = await service.validateAccessToken(RAW_TOKEN);
        expect(result).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // assertDocumentAccess()
  // -------------------------------------------------------------------------

  describe("assertDocumentAccess()", () => {
    it("throws NotFoundException when document does not exist for org", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.assertDocumentAccess(DOC_ID, ORG);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).message).toBe("Document not found");
      }
    });

    it("does not throw when document exists for org", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve({ id: DOC_ID }),
      );

      // Should resolve without throwing
      await service.assertDocumentAccess(DOC_ID, ORG);
      expect(mockPrisma.document.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: DOC_ID, organizationId: ORG },
        }),
      );
    });

    it("queries only the id field (minimal select)", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve({ id: DOC_ID }),
      );

      await service.assertDocumentAccess(DOC_ID, ORG);

      const call = mockPrisma.document.findFirst.mock.calls[0]![0] as {
        select: Record<string, unknown>;
      };
      expect(call.select).toEqual({ id: true });
    });

    it("scopes the lookup to the provided organizationId", async () => {
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve({ id: DOC_ID }),
      );

      await service.assertDocumentAccess(DOC_ID, "org-other");

      expect(mockPrisma.document.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: "org-other" }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // uploadVersion()
  // -------------------------------------------------------------------------

  describe("uploadVersion()", () => {
    const pdfFile = {
      path: TEMP_PDF,
      originalname: "v2.pdf",
      mimetype: "application/pdf",
      size: 9,
    };

    /** Set up mocks for a successful uploadVersion call. Individual tests can
     *  override specific mocks to trigger error paths. */
    function setupUploadVersion(docOverrides: Record<string, unknown> = {}) {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(
          makeDoc({ currentVersion: 1, uploadedById: USER, responses: [], signedFileId: null, signedFile: null, ...docOverrides }),
        ),
      );
      mockPrisma.documentVersion.create.mockReturnValue(
        Promise.resolve({ id: "ver-1", documentId: DOC_ID, version: 1, fileId: FILE_ID }),
      );
      mockPrisma.file.create.mockReturnValue(
        Promise.resolve({ id: "new-file-1", storageKey: "org-1/proj-1/documents/doc-1-v2" }),
      );
      mockPrisma.document.update.mockReturnValue(
        Promise.resolve(makeDoc({ currentVersion: 2, fileId: "new-file-1", signedFileId: null, signatureFields: [], responses: [], file: {} })),
      );
    }

    it("throws NotFoundException if document not found", async () => {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.uploadVersion(DOC_ID, ORG, USER, pdfFile);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).message).toBe("Document not found");
      }
    });

    it("throws BadRequestException for voided documents", async () => {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "voided", currentVersion: 1, uploadedById: USER, responses: [] })),
      );

      try {
        await service.uploadVersion(DOC_ID, ORG, USER, pdfFile);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("voided");
      }
    });

    it("throws BadRequestException for expired documents", async () => {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "expired", currentVersion: 1, uploadedById: USER, responses: [] })),
      );

      try {
        await service.uploadVersion(DOC_ID, ORG, USER, pdfFile);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("expired");
      }
    });

    it("throws BadRequestException for non-PDF file on signature-required documents", async () => {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ requiresSignature: true, currentVersion: 1, uploadedById: USER, responses: [] })),
      );

      const nonPdfFile = { path: TEMP_PDF, originalname: "doc.docx", mimetype: "application/msword", size: 4 };

      try {
        await service.uploadVersion(DOC_ID, ORG, USER, nonPdfFile);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("PDF");
      }
    });

    it("creates a version entry with the current version number", async () => {
      setupUploadVersion();

      await service.uploadVersion(DOC_ID, ORG, USER, pdfFile);

      expect(mockPrisma.documentVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            documentId: DOC_ID,
            fileId: FILE_ID,
            version: 1,
          }),
        }),
      );
    });

    it("increments currentVersion on the document update", async () => {
      setupUploadVersion();

      await service.uploadVersion(DOC_ID, ORG, USER, pdfFile);

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currentVersion: 2 }),
        }),
      );
    });

    it("clears signedFileId on the document update", async () => {
      setupUploadVersion();

      await service.uploadVersion(DOC_ID, ORG, USER, pdfFile);

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ signedFileId: null }),
        }),
      );
    });

    it("deletes responses when document was already sent (status !== 'draft')", async () => {
      setupUploadVersion({ status: "pending" });

      await service.uploadVersion(DOC_ID, ORG, USER, pdfFile);

      expect(mockPrisma.documentResponse.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { documentId: DOC_ID } }),
      );
    });

    it("resets status to 'pending' when document was already sent", async () => {
      setupUploadVersion({ status: "pending" });

      await service.uploadVersion(DOC_ID, ORG, USER, pdfFile);

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "pending" }),
        }),
      );
    });

    it("puts a sent deliverable back in review with the new note, restarts reminders and notifies clients", async () => {
      setupUploadVersion({ type: "deliverable", status: "declined", currentVersion: 1 });
      mockPrisma.document.update.mockReturnValue(
        Promise.resolve(makeDoc({ type: "deliverable", status: "pending", currentVersion: 2, file: {} })),
      );
      await service.uploadVersion(DOC_ID, ORG, USER, pdfFile, "Logo is bigger now");
      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "pending", requestNote: "Logo is bigger now", lastReminderAt: null, sentAt: expect.any(Date) }),
        }),
      );
      expect(mockNotifications.notifyDocumentUploaded).toHaveBeenCalledWith(DOC_ID);
      expect(mockActivityService.create).toHaveBeenCalledWith(expect.objectContaining({ action: "version_uploaded" }));
    });

    it("uploads to storage before opening the transaction, so a slow upload can't time it out", async () => {
      setupUploadVersion();
      const order: string[] = [];
      const upload = mockStorage.upload as ReturnType<typeof mock>;
      upload.mockClear();
      upload.mockImplementation(() => {
        order.push("upload");
        return Promise.resolve();
      });
      mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => unknown) => {
        order.push("transaction");
        return fn(mockPrisma);
      });

      await service.uploadVersion(DOC_ID, ORG, USER, pdfFile);

      expect(order).toEqual(["upload", "transaction"]);
      const storedKey = (upload.mock.calls[0] as unknown[])[0];
      expect(mockPrisma.file.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ storageKey: storedKey }) }),
      );
    });

    it("does not upload anything for a document that can't take a new version", async () => {
      setupUploadVersion({ status: "voided" });
      const upload = mockStorage.upload as ReturnType<typeof mock>;
      upload.mockClear();

      const err = await service.uploadVersion(DOC_ID, ORG, USER, pdfFile).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(upload).not.toHaveBeenCalled();
    });

    it("deletes the uploaded object when the transaction fails", async () => {
      setupUploadVersion();
      const upload = mockStorage.upload as ReturnType<typeof mock>;
      const del = mockStorage.delete as ReturnType<typeof mock>;
      upload.mockClear();
      del.mockClear();
      mockPrisma.documentVersion.create.mockReturnValue(Promise.reject(new Error("db down")));

      const err = await service.uploadVersion(DOC_ID, ORG, USER, pdfFile).catch((e: unknown) => e);

      expect((err as Error).message).toBe("db down");
      const storedKey = (upload.mock.calls[0] as unknown[])[0];
      expect(del).toHaveBeenCalledWith(storedKey);
    });

    it("does not notify or touch requestNote for contracts", async () => {
      setupUploadVersion({ type: "contract", status: "pending" });
      await service.uploadVersion(DOC_ID, ORG, USER, pdfFile);
      const data = (mockPrisma.document.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> }).data;
      expect(data.requestNote).toBeUndefined();
      expect(mockNotifications.notifyDocumentUploaded).not.toHaveBeenCalled();
      expect(mockActivityService.create).not.toHaveBeenCalled();
    });
  });

  describe("linkVersion()", () => {
    function setupLinkDoc(overrides: Record<string, unknown> = {}) {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(makeDoc({
        type: "deliverable", status: "declined", currentVersion: 1,
        file: { id: FILE_ID, type: "LINK", url: "https://staging.example.com", storageKey: null, filename: "Staging" },
        ...overrides,
      })));
      mockPrisma.documentVersion.create.mockReturnValue(Promise.resolve({ id: "ver-1" }));
      mockPrisma.file.create.mockReturnValue(Promise.resolve({ id: "file-2" }));
      mockPrisma.document.update.mockReturnValue(
        Promise.resolve(makeDoc({ type: "deliverable", status: "pending", currentVersion: 2, file: {} })),
      );
    }

    it("snapshots the current link, creates a new LINK file and resets to pending", async () => {
      setupLinkDoc();
      await service.linkVersion(DOC_ID, ORG, USER, "https://staging.example.com/v2", "Fixed nav");
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalled();
      expect(mockPrisma.documentVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ documentId: DOC_ID, fileId: FILE_ID, version: 1 }) }),
      );
      expect(mockPrisma.file.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: "LINK", url: "https://staging.example.com/v2", filename: "Staging" }) }),
      );
      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ fileId: "file-2", currentVersion: 2, status: "pending", requestNote: "Fixed nav" }) }),
      );
      expect(mockNotifications.notifyDocumentUploaded).toHaveBeenCalledWith(DOC_ID);
      expect(mockActivityService.create).toHaveBeenCalledWith(expect.objectContaining({ action: "version_uploaded" }));
    });

    it("refuses non-deliverables", async () => {
      setupLinkDoc({ type: "contract" });
      await expect(service.linkVersion(DOC_ID, ORG, USER, "https://x.com")).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(["voided", "expired"])("refuses %s deliverables", async (status) => {
      setupLinkDoc({ status });
      await expect(service.linkVersion(DOC_ID, ORG, USER, "https://x.com")).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // restoreVersion()
  // -------------------------------------------------------------------------

  describe("restoreVersion()", () => {
    const VERSION_ID = "ver-1";
    const RESTORED_FILE_ID = "restored-file-1";

    function setupRestoreVersion(docOverrides: Record<string, unknown> = {}) {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(
          makeDoc({ currentVersion: 2, uploadedById: USER, responses: [], signedFileId: null, signedFile: null, ...docOverrides }),
        ),
      );
      mockPrisma.documentVersion.findFirst.mockReturnValue(
        Promise.resolve({ id: VERSION_ID, documentId: DOC_ID, version: 1, fileId: RESTORED_FILE_ID }),
      );
      mockPrisma.documentVersion.create.mockReturnValue(
        Promise.resolve({ id: "ver-2", documentId: DOC_ID, version: 2, fileId: FILE_ID }),
      );
      mockPrisma.document.update.mockReturnValue(
        Promise.resolve(makeDoc({ currentVersion: 3, fileId: RESTORED_FILE_ID, signedFileId: null, signatureFields: [], responses: [], file: {} })),
      );
    }

    it("throws NotFoundException if document not found", async () => {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.restoreVersion(DOC_ID, VERSION_ID, ORG, USER);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).message).toBe("Document not found");
      }
    });

    it("throws NotFoundException if version not found", async () => {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ currentVersion: 2, uploadedById: USER, responses: [] })),
      );
      mockPrisma.documentVersion.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.restoreVersion(DOC_ID, "nonexistent-version", ORG, USER);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).message).toBe("Version not found");
      }
    });

    it("throws BadRequestException for voided documents", async () => {
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
      );
      mockPrisma.$queryRawUnsafe.mockReturnValue(Promise.resolve([]));
      mockPrisma.document.findFirst.mockReturnValue(
        Promise.resolve(makeDoc({ status: "voided", currentVersion: 2, uploadedById: USER, responses: [] })),
      );

      try {
        await service.restoreVersion(DOC_ID, VERSION_ID, ORG, USER);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain("voided");
      }
    });

    it("increments currentVersion on restore", async () => {
      setupRestoreVersion();

      await service.restoreVersion(DOC_ID, VERSION_ID, ORG, USER);

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currentVersion: 3 }),
        }),
      );
    });

    it("sets fileId to the restored version's fileId", async () => {
      setupRestoreVersion();

      await service.restoreVersion(DOC_ID, VERSION_ID, ORG, USER);

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ fileId: RESTORED_FILE_ID }),
        }),
      );
    });

    it("clears responses when document was already sent", async () => {
      setupRestoreVersion({ status: "pending" });

      await service.restoreVersion(DOC_ID, VERSION_ID, ORG, USER);

      expect(mockPrisma.documentResponse.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { documentId: DOC_ID } }),
      );
    });

    it("resets status to 'pending' when document was already sent", async () => {
      setupRestoreVersion({ status: "pending" });

      await service.restoreVersion(DOC_ID, VERSION_ID, ORG, USER);

      expect(mockPrisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "pending" }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // revokeAccessToken()
  // -------------------------------------------------------------------------

  describe("revokeAccessToken()", () => {
    const TOKEN_ID = "tok-revoke-1";

    function makeTokenRecord(overrides: Record<string, unknown> = {}) {
      return {
        id: TOKEN_ID,
        documentId: DOC_ID,
        userId: CLIENT_USER,
        token: "hashed-token",
        expiresAt: new Date(Date.now() + 3600000),
        usedAt: null,
        revokedAt: null,
        createdAt: new Date(),
        ...overrides,
      };
    }

    it("throws NotFoundException if token not found", async () => {
      // assertDocumentAccess uses document.findFirst — return the doc so it passes
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve({ id: DOC_ID }));
      mockPrisma.documentAccessToken.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.revokeAccessToken(DOC_ID, TOKEN_ID, ORG);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).message).toBe("Access token not found");
      }
    });

    it("throws BadRequestException if token is already revoked", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve({ id: DOC_ID }));
      mockPrisma.documentAccessToken.findFirst.mockReturnValue(
        Promise.resolve(makeTokenRecord({ revokedAt: new Date(Date.now() - 1000) })),
      );

      try {
        await service.revokeAccessToken(DOC_ID, TOKEN_ID, ORG);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toBe("Token is already revoked");
      }
    });

    it("sets revokedAt timestamp on successful revocation", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve({ id: DOC_ID }));
      mockPrisma.documentAccessToken.findFirst.mockReturnValue(
        Promise.resolve(makeTokenRecord()),
      );
      mockPrisma.documentAccessToken.update.mockReturnValue(
        Promise.resolve(makeTokenRecord({ revokedAt: new Date() })),
      );

      await service.revokeAccessToken(DOC_ID, TOKEN_ID, ORG);

      expect(mockPrisma.documentAccessToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TOKEN_ID },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getAccessTokens()
  // -------------------------------------------------------------------------

  describe("getAccessTokens()", () => {
    function makeTokenRecord(overrides: Record<string, unknown> = {}) {
      return {
        id: "tok-1",
        documentId: DOC_ID,
        userId: CLIENT_USER,
        token: "hashed-token",
        expiresAt: new Date(Date.now() + 3600000),
        usedAt: null,
        revokedAt: null,
        createdAt: new Date(),
        ...overrides,
      };
    }

    it("returns enriched tokens with user info and isActive flag", async () => {
      const token = makeTokenRecord();
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve({ id: DOC_ID }));
      mockPrisma.documentAccessToken.findMany.mockReturnValue(Promise.resolve([token]));
      mockPrisma.user.findMany.mockReturnValue(
        Promise.resolve([{ id: CLIENT_USER, name: "Test Client", email: "client@test.com" }]),
      );

      const result = await service.getAccessTokens(DOC_ID, ORG);

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("tok-1");
      expect(result[0]!.user).toEqual({ id: CLIENT_USER, name: "Test Client", email: "client@test.com" });
      expect(result[0]!.isActive).toBe(true);
    });

    it("marks expired tokens as not active", async () => {
      const expiredToken = makeTokenRecord({ expiresAt: new Date(Date.now() - 1000) });
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve({ id: DOC_ID }));
      mockPrisma.documentAccessToken.findMany.mockReturnValue(Promise.resolve([expiredToken]));
      mockPrisma.user.findMany.mockReturnValue(
        Promise.resolve([{ id: CLIENT_USER, name: "Test Client", email: "client@test.com" }]),
      );

      const result = await service.getAccessTokens(DOC_ID, ORG);

      expect(result[0]!.isActive).toBe(false);
    });

    it("marks revoked tokens as not active", async () => {
      const revokedToken = makeTokenRecord({ revokedAt: new Date(Date.now() - 500) });
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve({ id: DOC_ID }));
      mockPrisma.documentAccessToken.findMany.mockReturnValue(Promise.resolve([revokedToken]));
      mockPrisma.user.findMany.mockReturnValue(
        Promise.resolve([{ id: CLIENT_USER, name: "Test Client", email: "client@test.com" }]),
      );

      const result = await service.getAccessTokens(DOC_ID, ORG);

      expect(result[0]!.isActive).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // generateCertificate()
  // -------------------------------------------------------------------------

  describe("generateCertificate()", () => {
    it("refuses a client who is not assigned to the document's project", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(makeDoc({ status: "signed" })));
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

      await expect(
        service.generateCertificate(DOC_ID, CLIENT_USER, ORG, "member"),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.projectClient.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ projectId: PROJECT_ID, userId: CLIENT_USER }) }),
      );
    });

    it("checks access before revealing whether the document is signed", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(makeDoc({ status: "draft" })));
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

      await expect(
        service.generateCertificate(DOC_ID, CLIENT_USER, ORG, "member"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("lets an assigned client and an admin through to the signed-status check", async () => {
      mockPrisma.document.findFirst.mockReturnValue(Promise.resolve(makeDoc({ status: "draft" })));
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ projectId: PROJECT_ID, userId: CLIENT_USER }),
      );
      await expect(
        service.generateCertificate(DOC_ID, CLIENT_USER, ORG, "member"),
      ).rejects.toBeInstanceOf(BadRequestException);

      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));
      await expect(
        service.generateCertificate(DOC_ID, ADMIN_USER, ORG, "admin"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // trackView()
  // -------------------------------------------------------------------------

  describe("trackView()", () => {
    it("refuses a client who is not assigned to the document's project and logs nothing", async () => {
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

      await expect(
        service.trackView(DOC_ID, CLIENT_USER, ORG, "member"),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });

    it("logs the first view for an assigned client", async () => {
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ projectId: PROJECT_ID, userId: CLIENT_USER }),
      );
      mockPrisma.documentAuditEvent.findFirst.mockReturnValue(Promise.resolve(null));

      await service.trackView(DOC_ID, CLIENT_USER, ORG, "member", "1.2.3.4", "ua");

      expect(mockAuditService.log).toHaveBeenCalledWith(DOC_ID, "viewed", {
        userId: CLIENT_USER, ipAddress: "1.2.3.4", userAgent: "ua",
      });
    });
  });

  describe("findPendingApprovals()", () => {
    it("is org-scoped, excludes archived projects, and lists changes requested first", async () => {
      mockPrisma.document.findMany.mockReturnValue(Promise.resolve([
        { id: "d2", title: "B", type: "deliverable", status: "declined", currentVersion: 2, sentAt: new Date("2026-10-05"), projectId: PROJECT_ID, project: { name: "Site" }, responses: [{ reason: "Bigger", user: { name: "Elena" } }] },
        { id: "d1", title: "A", type: "deliverable", status: "pending", currentVersion: 1, sentAt: new Date("2026-10-01"), projectId: PROJECT_ID, project: { name: "Site" }, responses: [] },
      ]));

      const result = await service.findPendingApprovals(ORG, PROJECT_ID);

      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG, projectId: PROJECT_ID, requiresApproval: true,
          project: { archivedAt: null },
          OR: [
            { type: "deliverable", status: { in: ["pending", "declined"] } },
            { type: { not: "deliverable" }, status: "pending" },
          ],
        }),
        orderBy: [{ status: "asc" }, { sentAt: "asc" }],
      }));
      expect(result.map((r) => r.id)).toEqual(["d2", "d1"]);
      expect(result[0]).toEqual(expect.objectContaining({ version: 2, projectName: "Site", latestReason: "Bigger", decidedBy: "Elena" }));
    });

    it("omits the project filter when none is given", async () => {
      mockPrisma.document.findMany.mockReturnValue(Promise.resolve([]));
      await service.findPendingApprovals(ORG);
      const where = (mockPrisma.document.findMany.mock.calls.at(-1)![0] as { where: Record<string, unknown> }).where;
      expect(where.projectId).toBeUndefined();
    });
  });

  describe("findByProjectForClient() - deliverable decisions", () => {
    it("attaches the deciding client's response to deliverables only", async () => {
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve({ id: "pc-1" }));
      mockPrisma.document.findMany.mockReturnValue(Promise.resolve([
        makeDoc({ id: "d1", type: "deliverable", status: "accepted" }),
        makeDoc({ id: "d2", type: "contract", status: "pending" }),
      ]));
      mockPrisma.document.count.mockReturnValue(Promise.resolve(2));
      mockPrisma.documentResponse.findMany.mockReturnValue(Promise.resolve([
        { documentId: "d1", action: "accepted", reason: null, createdAt: new Date(), user: { name: "Elena" } },
      ]));

      const res = await service.findByProjectForClient(PROJECT_ID, CLIENT_USER, ORG);

      expect(mockPrisma.documentResponse.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { documentId: { in: ["d1"] }, fieldId: null },
      }));
      expect(res.data[0].decision?.user.name).toBe("Elena");
      expect(res.data[1].decision).toBeNull();
    });
  });
});
