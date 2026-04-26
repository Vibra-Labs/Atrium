import { describe, expect, it, mock, beforeEach } from "bun:test";
import { UpdatesService } from "./updates.service";
import {
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { ActivityService } from "../activity/activity.service";
import type { StorageProvider } from "./../files/storage/storage.interface";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = "org-1";
const AUTHOR = "user-author";
const ADMIN = "user-admin";
const OTHER = "user-other";
const PROJECT_ID = "project-1";
const UPDATE_ID = "update-1";

interface PrismaArgs {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

function makeUpdate(overrides: Record<string, unknown> = {}) {
  return {
    id: UPDATE_ID,
    content: "Original content",
    authorId: AUTHOR,
    projectId: PROJECT_ID,
    organizationId: ORG,
    attachmentKey: null,
    attachmentMimeType: null,
    attachmentName: null,
    fileId: null,
    previewPrefs: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

const mockStorage = {
  upload: mock(() => Promise.resolve()),
  download: mock(() => Promise.resolve({ body: null as never, contentType: "" })),
  getSignedUrl: mock(() => Promise.resolve("https://example.com/signed")),
  delete: mock(() => Promise.resolve()),
};

const mockPrisma = {
  projectUpdate: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
    update: mock((args: PrismaArgs) =>
      Promise.resolve({ ...makeUpdate(), ...args.data, id: args.where?.id }),
    ),
  },
  projectClient: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
  },
};

const mockNotifications = {
  notifyProjectUpdate: mock(() => Promise.resolve()),
} as unknown as NotificationsService;

const mockActivity = {} as unknown as ActivityService;

function clearAllMocks() {
  mockPrisma.projectUpdate.findFirst.mockClear();
  mockPrisma.projectUpdate.update.mockClear();
  mockPrisma.projectClient.findFirst.mockClear();
}

describe("UpdatesService.update", () => {
  let service: UpdatesService;

  beforeEach(() => {
    clearAllMocks();
    service = new UpdatesService(
      mockPrisma as unknown as PrismaService,
      mockNotifications,
      mockActivity,
      mockStorage as unknown as StorageProvider,
    );
  });

  it("allows the author to edit their own update", async () => {
    mockPrisma.projectUpdate.findFirst.mockReturnValue(
      Promise.resolve(makeUpdate({ authorId: AUTHOR })),
    );
    // author is a member and IS currently assigned to the project
    mockPrisma.projectClient.findFirst.mockReturnValue(
      Promise.resolve({ id: "pc-1", projectId: PROJECT_ID, userId: AUTHOR }),
    );

    const result = await service.update(
      UPDATE_ID,
      { content: "Updated by author" },
      ORG,
      AUTHOR,
      "member",
    );

    expect(mockPrisma.projectUpdate.update).toHaveBeenCalledWith({
      where: { id: UPDATE_ID },
      data: { content: "Updated by author" },
    });
    expect(result).toBeDefined();
  });

  it("allows an owner to edit another user's update", async () => {
    mockPrisma.projectUpdate.findFirst.mockReturnValue(
      Promise.resolve(makeUpdate({ authorId: OTHER })),
    );

    await service.update(
      UPDATE_ID,
      { content: "Edited by owner" },
      ORG,
      ADMIN,
      "owner",
    );

    expect(mockPrisma.projectUpdate.update).toHaveBeenCalled();
  });

  it("allows an admin to edit another user's update", async () => {
    mockPrisma.projectUpdate.findFirst.mockReturnValue(
      Promise.resolve(makeUpdate({ authorId: OTHER })),
    );

    await service.update(
      UPDATE_ID,
      { content: "Edited by admin" },
      ORG,
      ADMIN,
      "admin",
    );

    expect(mockPrisma.projectUpdate.update).toHaveBeenCalled();
  });

  it("throws ForbiddenException when a member tries to edit someone else's update", async () => {
    mockPrisma.projectUpdate.findFirst.mockReturnValue(
      Promise.resolve(makeUpdate({ authorId: OTHER })),
    );

    try {
      await service.update(
        UPDATE_ID,
        { content: "Hack" },
        ORG,
        AUTHOR,
        "member",
      );
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }

    expect(mockPrisma.projectUpdate.update).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when update does not exist", async () => {
    mockPrisma.projectUpdate.findFirst.mockReturnValue(Promise.resolve(null));

    try {
      await service.update(
        "nonexistent",
        { content: "x" },
        ORG,
        AUTHOR,
        "owner",
      );
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundException);
    }

    expect(mockPrisma.projectUpdate.update).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when author is a client no longer assigned to the project", async () => {
    // Author matches, but assertProjectAccess will deny because the client
    // is no longer in projectClient.
    mockPrisma.projectUpdate.findFirst.mockReturnValue(
      Promise.resolve(makeUpdate({ authorId: AUTHOR })),
    );
    mockPrisma.projectClient.findFirst.mockReturnValue(Promise.resolve(null));

    try {
      await service.update(
        UPDATE_ID,
        { content: "x" },
        ORG,
        AUTHOR,
        "member",
      );
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }

    expect(mockPrisma.projectUpdate.update).not.toHaveBeenCalled();
  });

  it("scopes the update lookup to the requesting org", async () => {
    mockPrisma.projectUpdate.findFirst.mockReturnValue(
      Promise.resolve(makeUpdate({ authorId: AUTHOR })),
    );

    await service.update(
      UPDATE_ID,
      { content: "scoped" },
      ORG,
      AUTHOR,
      "owner",
    );

    expect(mockPrisma.projectUpdate.findFirst).toHaveBeenCalledWith({
      where: { id: UPDATE_ID, organizationId: ORG },
    });
  });
});
