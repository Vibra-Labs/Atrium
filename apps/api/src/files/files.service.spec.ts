import { describe, expect, it, mock, beforeEach } from "bun:test";
import { FilesService } from "./files.service";
import {
  NotFoundException,
  ForbiddenException,
  PayloadTooLargeException,
  BadRequestException,
} from "@nestjs/common";
import { Readable } from "stream";
import type { PrismaService } from "../prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";
import type { StorageProvider } from "./storage/storage.provider";
import type { SettingsService } from "../settings/settings.service";

interface PrismaArgs {
  data?: Record<string, unknown>;
}

interface MockFile {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const mockStorage = {
  upload: mock(() => Promise.resolve()),
  download: mock(() =>
    Promise.resolve({
      body: Readable.from(Buffer.from("data")),
      contentType: "text/plain",
    }),
  ),
  getSignedUrl: mock(() => Promise.resolve("https://example.com/signed")),
  delete: mock(() => Promise.resolve()),
};

const mockPrisma = {
  project: {
    findFirst: mock(() =>
      Promise.resolve({ id: "proj-1", organizationId: "org-1" }),
    ),
  },
  file: {
    create: mock((args: PrismaArgs) =>
      Promise.resolve({ id: "file-1", ...args.data }),
    ),
    findMany: mock(() => Promise.resolve([])),
    findFirst: mock(() => Promise.resolve(null)),
    delete: mock(() => Promise.resolve()),
    deleteMany: mock(() => Promise.resolve({ count: 1 })),
    count: mock(() => Promise.resolve(0)),
  },
  projectClient: {
    findFirst: mock(() => Promise.resolve(null)),
  },
  $transaction: mock((fn: (prisma: typeof mockPrisma) => unknown) => fn(mockPrisma)),
};

const mockConfig = {
  get: (key: string, fallback?: string) => {
    if (key === "MAX_FILE_SIZE_MB") return "50";
    return fallback;
  },
};

// Default: max size = 50 MB
const mockSettingsService = {
  getEffectiveMaxFileSize: mock(() => Promise.resolve(50)),
};

describe("FilesService", () => {
  let service: FilesService;

  beforeEach(() => {
    service = new FilesService(
      mockPrisma as unknown as PrismaService,
      mockConfig as unknown as ConfigService,
      mockSettingsService as unknown as SettingsService,
      mockStorage as unknown as StorageProvider,
    );
    // Reset the max file size to the default between tests
    mockSettingsService.getEffectiveMaxFileSize.mockImplementation(() =>
      Promise.resolve(50),
    );
  });

  // --- Size validation ---

  it("upload rejects files over size limit with PayloadTooLargeException", async () => {
    const file = {
      originalname: "big.zip",
      buffer: Buffer.alloc(0),
      mimetype: "application/zip",
      size: 100 * 1024 * 1024, // 100 MB — exceeds default 50 MB
    } as MockFile;

    try {
      await service.upload(file, "proj-1", "org-1", "user-1");
      expect(true).toBe(false); // must not reach
    } catch (e) {
      expect(e).toBeInstanceOf(PayloadTooLargeException);
    }
  });

  it("error message from PayloadTooLargeException includes actual size and max size", async () => {
    // Set org max to 10 MB so the message is predictable
    mockSettingsService.getEffectiveMaxFileSize.mockImplementation(() =>
      Promise.resolve(10),
    );

    const file = {
      originalname: "large.zip",
      buffer: Buffer.alloc(0),
      mimetype: "application/zip",
      size: 25 * 1024 * 1024, // 25 MB
    } as MockFile;

    try {
      await service.upload(file, "proj-1", "org-1", "user-1");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(PayloadTooLargeException);
      const err = e as PayloadTooLargeException;
      const response = err.getResponse() as Record<string, unknown>;
      const message = String(response.message ?? response);
      // Both the actual size (25MB) and max (10MB) must appear in the message
      expect(message).toContain("25");
      expect(message).toContain("10");
    }
  });

  it("upload does not throw when file is exactly at the size limit", async () => {
    mockSettingsService.getEffectiveMaxFileSize.mockImplementation(() =>
      Promise.resolve(10),
    );
    mockPrisma.project.findFirst.mockReturnValue(
      Promise.resolve({ id: "proj-1", organizationId: "org-1" }),
    );

    const file = {
      originalname: "exact.pdf",
      buffer: Buffer.alloc(0),
      mimetype: "application/pdf",
      size: 10 * 1024 * 1024, // exactly 10 MB
    } as MockFile;

    // Should NOT throw — exactly at the limit is allowed
    const result = await service.upload(file, "proj-1", "org-1", "user-1");
    expect(result).toBeDefined();
  });

  it("upload rejects blocked file extensions with BadRequestException", async () => {
    const file = {
      originalname: "malware.exe",
      buffer: Buffer.alloc(0),
      mimetype: "application/octet-stream",
      size: 1024,
    } as MockFile;

    try {
      await service.upload(file, "proj-1", "org-1", "user-1");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
    }
  });

  it("upload creates file record", async () => {
    mockPrisma.project.findFirst.mockReturnValue(
      Promise.resolve({ id: "proj-1", organizationId: "org-1" }),
    );

    const file = {
      originalname: "doc.pdf",
      buffer: Buffer.from("pdf content"),
      mimetype: "application/pdf",
      size: 1024,
    } as MockFile;

    const result = await service.upload(file, "proj-1", "org-1", "user-1");
    expect(result.filename).toBe("doc.pdf");
    expect(mockStorage.upload).toHaveBeenCalled();
  });

  // --- Download authorization ---

  it("download throws when file not found", async () => {
    mockPrisma.file.findFirst.mockReturnValue(Promise.resolve(null));

    try {
      await service.download("nonexistent", "org-1", "user-1", "owner");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundException);
    }
  });

  it("download allows owner to access any file", async () => {
    const file = {
      id: "file-1",
      filename: "doc.pdf",
      storageKey: "org/proj/doc.pdf",
      projectId: "proj-1",
      organizationId: "org-1",
    };
    mockPrisma.file.findFirst.mockReturnValue(Promise.resolve(file));

    const result = await service.download("file-1", "org-1", "user-1", "owner");
    expect(result.filename).toBe("doc.pdf");
  });

  it("download allows admin to access any file", async () => {
    const file = {
      id: "file-1",
      filename: "doc.pdf",
      storageKey: "org/proj/doc.pdf",
      projectId: "proj-1",
      organizationId: "org-1",
    };
    mockPrisma.file.findFirst.mockReturnValue(Promise.resolve(file));

    const result = await service.download("file-1", "org-1", "user-1", "admin");
    expect(result.filename).toBe("doc.pdf");
  });

  it("download allows member assigned to project", async () => {
    const file = {
      id: "file-1",
      filename: "doc.pdf",
      storageKey: "org/proj/doc.pdf",
      projectId: "proj-1",
      organizationId: "org-1",
    };
    mockPrisma.file.findFirst.mockReturnValue(Promise.resolve(file));
    mockPrisma.projectClient.findFirst.mockReturnValue(
      Promise.resolve({ id: "pc-1", projectId: "proj-1", userId: "user-1" }),
    );

    const result = await service.download("file-1", "org-1", "user-1", "member");
    expect(result.filename).toBe("doc.pdf");
  });

  it("download rejects member not assigned to project", async () => {
    const file = {
      id: "file-1",
      filename: "doc.pdf",
      storageKey: "org/proj/doc.pdf",
      projectId: "proj-1",
      organizationId: "org-1",
    };
    mockPrisma.file.findFirst.mockReturnValue(Promise.resolve(file));
    mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

    try {
      await service.download("file-1", "org-1", "user-1", "member");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }
  });

  // --- Download URL ---

  it("getDownloadUrl rejects member not assigned to project", async () => {
    const file = {
      id: "file-1",
      filename: "doc.pdf",
      storageKey: "org/proj/doc.pdf",
      projectId: "proj-1",
      organizationId: "org-1",
    };
    mockPrisma.file.findFirst.mockReturnValue(Promise.resolve(file));
    mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

    try {
      await service.getDownloadUrl("file-1", "org-1", "user-1", "member");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }
  });

  it("getDownloadUrl allows admin to access any file", async () => {
    const file = {
      id: "file-1",
      filename: "doc.pdf",
      storageKey: "org/proj/doc.pdf",
      projectId: "proj-1",
      organizationId: "org-1",
    };
    mockPrisma.file.findFirst.mockReturnValue(Promise.resolve(file));

    const result = await service.getDownloadUrl("file-1", "org-1", "user-1", "admin");
    expect(result.url).toBe("/api/files/file-1/download");
  });

  // --- Remove ---

  it("remove deletes from storage and db", async () => {
    const file = {
      id: "file-1",
      storageKey: "org/proj/file.pdf",
      organizationId: "org-1",
    };
    mockPrisma.file.findFirst.mockReturnValue(Promise.resolve(file));
    // $transaction executes the callback synchronously in this mock
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => unknown) => {
      return fn({
        file: {
          findFirst: mock(() => Promise.resolve(file)),
          deleteMany: mock(() => Promise.resolve({ count: 1 })),
        },
      });
    });

    await service.remove("file-1", "org-1");
    expect(mockStorage.delete).toHaveBeenCalled();
  });

  // --- uploadAsClient ---

  describe("uploadAsClient", () => {
    const clientFile = {
      originalname: "report.pdf",
      buffer: Buffer.from("pdf content"),
      mimetype: "application/pdf",
      size: 1024,
    } as MockFile;

    it("throws ForbiddenException when client is not assigned to the project", async () => {
      mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.uploadAsClient(clientFile, "proj-1", "org-1", "user-client");
        expect(true).toBe(false); // must not reach
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect((e as ForbiddenException).message).toBe(
          "You are not assigned to this project",
        );
      }
    });

    it("throws NotFoundException when the project does not exist in the org", async () => {
      // Client is assigned, but the project is missing (or belongs to another org)
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: "proj-1", userId: "user-client" }),
      );
      mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.uploadAsClient(clientFile, "proj-1", "org-1", "user-client");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });

    it("throws NotFoundException when the project is archived", async () => {
      // uploadAsClient queries with archivedAt: null — an archived project is invisible.
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: "proj-1", userId: "user-client" }),
      );
      // Prisma returns null because the archivedAt filter excludes the project
      mockPrisma.project.findFirst.mockReturnValue(Promise.resolve(null));

      try {
        await service.uploadAsClient(clientFile, "proj-1", "org-1", "user-client");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect((e as NotFoundException).message).toBe("Project not found");
      }
    });

    it("verifies the project query enforces archivedAt: null", async () => {
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: "proj-1", userId: "user-client" }),
      );
      mockPrisma.project.findFirst.mockReturnValue(
        Promise.resolve({ id: "proj-1", organizationId: "org-1" }),
      );

      await service.uploadAsClient(clientFile, "proj-1", "org-1", "user-client");

      // Second findFirst call is the project lookup inside uploadAsClient
      const projectFindCalls = mockPrisma.project.findFirst.mock.calls;
      const uploadAsClientCall = projectFindCalls.find(
        (c: unknown[]) => (c[0] as Record<string, Record<string, unknown>> | undefined)?.where?.archivedAt === null,
      );
      expect(uploadAsClientCall).toBeDefined();
    });

    it("verifies the project client assignment lookup uses the correct userId and projectId", async () => {
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: "proj-1", userId: "user-client" }),
      );
      mockPrisma.project.findFirst.mockReturnValue(
        Promise.resolve({ id: "proj-1", organizationId: "org-1" }),
      );

      await service.uploadAsClient(clientFile, "proj-1", "org-1", "user-client");

      expect(mockPrisma.projectClient.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: "proj-1",
            userId: "user-client",
          }),
        }),
      );
    });

    it("successfully uploads a file for an assigned client on an active project", async () => {
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: "proj-1", userId: "user-client" }),
      );
      mockPrisma.project.findFirst.mockReturnValue(
        Promise.resolve({ id: "proj-1", organizationId: "org-1" }),
      );

      const result = await service.uploadAsClient(
        clientFile,
        "proj-1",
        "org-1",
        "user-client",
      );

      expect(result).toBeDefined();
      expect(result.filename).toBe("report.pdf");
      expect(mockStorage.upload).toHaveBeenCalled();
      expect(mockPrisma.file.create).toHaveBeenCalled();
    });

    it("stores the file under the correct organizationId and projectId", async () => {
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: "proj-2", userId: "user-client" }),
      );
      mockPrisma.project.findFirst.mockReturnValue(
        Promise.resolve({ id: "proj-2", organizationId: "org-2" }),
      );

      await service.uploadAsClient(clientFile, "proj-2", "org-2", "user-client");

      const createCall = mockPrisma.file.create.mock.calls.at(-1)![0] as PrismaArgs;
      expect(createCall.data.projectId).toBe("proj-2");
      expect(createCall.data.organizationId).toBe("org-2");
    });

    it("records the uploading client as uploadedById", async () => {
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: "proj-1", userId: "user-client" }),
      );
      mockPrisma.project.findFirst.mockReturnValue(
        Promise.resolve({ id: "proj-1", organizationId: "org-1" }),
      );

      await service.uploadAsClient(clientFile, "proj-1", "org-1", "user-client");

      const createCall = mockPrisma.file.create.mock.calls.at(-1)![0] as PrismaArgs;
      expect(createCall.data.uploadedById).toBe("user-client");
    });

    it("rejects blocked file extensions even for assigned clients", async () => {
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: "proj-1", userId: "user-client" }),
      );
      mockPrisma.project.findFirst.mockReturnValue(
        Promise.resolve({ id: "proj-1", organizationId: "org-1" }),
      );

      const exeFile = {
        originalname: "virus.exe",
        buffer: Buffer.alloc(0),
        mimetype: "application/octet-stream",
        size: 512,
      } as MockFile;

      try {
        await service.uploadAsClient(exeFile, "proj-1", "org-1", "user-client");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
      }
    });

    it("rejects files over the org size limit even for assigned clients", async () => {
      mockSettingsService.getEffectiveMaxFileSize.mockImplementation(() =>
        Promise.resolve(5),
      );
      mockPrisma.projectClient.findFirst.mockReturnValue(
        Promise.resolve({ id: "pc-1", projectId: "proj-1", userId: "user-client" }),
      );
      mockPrisma.project.findFirst.mockReturnValue(
        Promise.resolve({ id: "proj-1", organizationId: "org-1" }),
      );

      const bigFile = {
        originalname: "huge.pdf",
        buffer: Buffer.alloc(0),
        mimetype: "application/pdf",
        size: 20 * 1024 * 1024, // 20 MB > 5 MB limit
      } as MockFile;

      try {
        await service.uploadAsClient(bigFile, "proj-1", "org-1", "user-client");
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(PayloadTooLargeException);
      }
    });
  });
});
