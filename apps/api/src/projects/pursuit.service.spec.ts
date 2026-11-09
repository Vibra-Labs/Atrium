import { describe, expect, it, mock, beforeEach } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { PursuitService } from "./pursuit.service";
import type { PrismaService } from "../prisma/prisma.service";

interface Args {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

type PursuitRow = { projectId: string; outcome: string; stage: string; project: { name: string; archivedAt: Date | null } };
type ContactRow = { id: string; firstName: string; lastName: string | null; email: string | null; userId: string | null };

let pursuit: PursuitRow | null;
let contact: ContactRow | null;
let member: { userId: string } | null;

const updateManyMock = (): ReturnType<typeof mock> => mock((_args: Args) => Promise.resolve({ count: 1 }));

const prisma = {
  projectPursuit: {
    findFirst: mock(() => Promise.resolve(pursuit)),
    update: mock((args: Args) => Promise.resolve({ ...pursuit, ...args.data })),
    updateMany: updateManyMock(),
  },
  projectPursuitEvent: { create: mock(() => Promise.resolve({})) },
  company: { findFirst: mock(() => Promise.resolve({ id: "co1", name: "Harbor County" })) },
  projectStatus: {
    findFirst: mock((args: Args) => Promise.resolve({ slug: (args.where as { slug: string }).slug })),
  },
  member: { findFirst: mock(() => Promise.resolve(member)) },
  contact: {
    findFirst: mock(() => Promise.resolve(contact)),
    update: mock(() => Promise.resolve({})),
  },
  project: {
    update: mock((args: Args) => Promise.resolve({ id: "p1", ...args.data })),
    findFirst: mock(() => Promise.resolve({ id: "p1", name: "County RFP" })),
  },
  projectUpdate: { updateMany: updateManyMock() },
  file: { updateMany: updateManyMock() },
  task: { updateMany: updateManyMock() },
  document: { updateMany: updateManyMock() },
  activityLog: { updateMany: updateManyMock() },
  comment: { updateMany: updateManyMock() },
  projectClient: { createMany: mock(() => Promise.resolve({ count: 1 })) },
  pendingProjectAccess: { upsert: mock(() => Promise.resolve({})) },
  $transaction: mock((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
};

const contactSync = { linkProjectClients: mock(() => Promise.resolve()) };
const contacts = { linkProject: mock(() => Promise.resolve()) };

function allMocks(): ReturnType<typeof mock>[] {
  return [
    ...Object.values(prisma).flatMap((m) => (typeof m === "function" ? [m] : Object.values(m))),
    contactSync.linkProjectClients,
    contacts.linkProject,
  ] as ReturnType<typeof mock>[];
}

describe("PursuitService", () => {
  let service: PursuitService;

  beforeEach(() => {
    pursuit = { projectId: "p1", outcome: "open", stage: "found", project: { name: "County RFP", archivedAt: null } };
    contact = { id: "c1", firstName: "Lee", lastName: "Park", email: "lee@example.com", userId: null };
    member = null;
    allMocks().forEach((m) => m.mockClear());
    service = new PursuitService(prisma as unknown as PrismaService, contactSync as never, contacts as never);
  });

  const win = (giveAccess: boolean, status: string = "in_progress") =>
    service.win("p1", { contactId: "c1", status, giveAccess }, "org-1");

  it("win marks every existing item internal", async () => {
    await win(false);
    for (const model of [prisma.projectUpdate, prisma.file, prisma.task, prisma.document, prisma.activityLog]) {
      expect(model.updateMany).toHaveBeenCalledWith({ where: { projectId: "p1" }, data: { internal: true } });
    }
  });

  it("win marks comments on the project's updates and tasks internal", async () => {
    await win(false);
    expect(prisma.comment.updateMany).toHaveBeenCalledWith({
      where: { OR: [{ update: { projectId: "p1" } }, { task: { projectId: "p1" } }] },
      data: { internal: true },
    });
  });

  it("win makes the contact a client and moves the project to the chosen status", async () => {
    await win(false);
    expect(contacts.linkProject).toHaveBeenCalledWith("c1", "p1", "org-1");
    expect(prisma.contact.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { status: "client" } });
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { status: "in_progress" } });
  });

  it("win without a contact still moves the project and keeps earlier items internal", async () => {
    const result = await service.win("p1", { status: "in_progress", giveAccess: false }, "org-1");
    expect(result).toEqual({ projectId: "p1", inviteEmail: null });
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { status: "in_progress" } });
    expect(prisma.file.updateMany).toHaveBeenCalledWith({ where: { projectId: "p1" }, data: { internal: true } });
    expect(prisma.contact.findFirst).not.toHaveBeenCalled();
    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(contacts.linkProject).not.toHaveBeenCalled();
  });

  it("win with giveAccess but no contact is rejected before changing anything", async () => {
    await expect(service.win("p1", { status: "in_progress", giveAccess: true }, "org-1")).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.projectPursuit.updateMany).not.toHaveBeenCalled();
  });

  it("win rejects a pursuit that is not open", async () => {
    pursuit!.outcome = "won";
    await expect(win(false)).rejects.toThrow(BadRequestException);
    expect(prisma.file.updateMany).not.toHaveBeenCalled();
  });

  it("win rejects a second win that loses the race", async () => {
    prisma.projectPursuit.updateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));
    await expect(win(false)).rejects.toThrow(BadRequestException);
  });

  it("win rejects cancelled and completed statuses", async () => {
    await expect(win(false, "cancelled")).rejects.toThrow(BadRequestException);
    await expect(win(false, "completed")).rejects.toThrow(BadRequestException);
  });

  it("win without giveAccess gives no portal access", async () => {
    contact!.userId = "u1";
    const result = await win(false);
    expect(prisma.projectClient.createMany).not.toHaveBeenCalled();
    expect(result.inviteEmail).toBeNull();
  });

  it("win with giveAccess uses an existing portal login with the contact's email", async () => {
    member = { userId: "u9" };
    const result = await win(true);
    expect(prisma.projectClient.createMany).toHaveBeenCalledWith({
      data: [{ projectId: "p1", userId: "u9" }],
      skipDuplicates: true,
    });
    expect(prisma.pendingProjectAccess.upsert).not.toHaveBeenCalled();
    expect(result.inviteEmail).toBeNull();
  });

  it("win doesn't link the contact when another request claimed the win first", async () => {
    prisma.projectPursuit.updateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));
    await expect(win(false)).rejects.toThrow(BadRequestException);
    expect(contacts.linkProject).not.toHaveBeenCalled();
  });

  it("win with giveAccess and a contact login creates ProjectClient", async () => {
    contact!.userId = "u1";
    const result = await win(true);
    expect(prisma.projectClient.createMany).toHaveBeenCalledWith({
      data: [{ projectId: "p1", userId: "u1" }],
      skipDuplicates: true,
    });
    expect(contactSync.linkProjectClients).toHaveBeenCalledWith("p1", "org-1", ["u1"]);
    expect(result.inviteEmail).toBeNull();
  });

  it("win with giveAccess and no login stores pending access and returns the invite email", async () => {
    const result = await win(true);
    expect(prisma.pendingProjectAccess.upsert).toHaveBeenCalled();
    expect(prisma.projectClient.createMany).not.toHaveBeenCalled();
    expect(result.inviteEmail).toBe("lee@example.com");
  });

  it("win with giveAccess and no email throws before changing anything", async () => {
    contact!.email = null;
    await expect(win(true)).rejects.toThrow(BadRequestException);
    expect(prisma.projectPursuit.updateMany).not.toHaveBeenCalled();
  });

  it("lose archives and never sets cancelled", async () => {
    await service.lose("p1", { reason: "Price" }, "org-1");
    const data = (prisma.project.update.mock.calls[0] as [Args])[0].data!;
    expect(data.archivedAt).toBeInstanceOf(Date);
    expect(data.status).toBeUndefined();
    expect(prisma.projectPursuit.updateMany).toHaveBeenCalledWith({
      where: { projectId: "p1", outcome: "open" },
      data: { outcome: "lost", lostReason: "Price" },
    });
  });

  it("lose rejects a won pursuit", async () => {
    pursuit!.outcome = "won";
    await expect(service.lose("p1", {}, "org-1")).rejects.toThrow(BadRequestException);
  });

  it("reopen unarchives and resets to found", async () => {
    pursuit!.outcome = "lost";
    await service.reopen("p1", "org-1");
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { archivedAt: null } });
    expect(prisma.projectPursuit.updateMany).toHaveBeenCalledWith({
      where: { projectId: "p1", outcome: "lost" },
      data: { outcome: "open", stage: "found", lostReason: null },
    });
  });

  it("lose does nothing when a concurrent win claimed it first", async () => {
    prisma.projectPursuit.updateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));
    await expect(service.lose("p1", {}, "org-1")).rejects.toThrow(BadRequestException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("reopen does nothing when the pursuit stopped being lost", async () => {
    pursuit!.outcome = "lost";
    prisma.projectPursuit.updateMany.mockImplementationOnce(() => Promise.resolve({ count: 0 }));
    await expect(service.reopen("p1", "org-1")).rejects.toThrow(BadRequestException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("reopen only works on a lost pursuit", async () => {
    await expect(service.reopen("p1", "org-1")).rejects.toThrow(BadRequestException);
  });

  it("update logs a stage change", async () => {
    await service.update("p1", { stage: "proposal_sent" }, "org-1");
    expect(prisma.projectPursuitEvent.create).toHaveBeenCalledWith({
      data: { projectId: "p1", text: "Moved to Proposal sent" },
    });
  });

  it("update on a won pursuit can still change the value", async () => {
    pursuit!.outcome = "won";
    await service.update("p1", { valueCents: 100 }, "org-1");
    expect(prisma.projectPursuit.update).toHaveBeenCalled();
  });

  it("update on an archived won pursuit is read-only", async () => {
    pursuit!.outcome = "won";
    pursuit!.project.archivedAt = new Date();
    await expect(service.update("p1", { valueCents: 100 }, "org-1")).rejects.toThrow(BadRequestException);
  });

  it("update on a won pursuit doesn't tell you to reopen it", async () => {
    pursuit!.outcome = "won";
    await expect(service.update("p1", { nextStep: "Call" }, "org-1")).rejects.toThrow("Only the value can change on a won contract");
  });

  it("win rejects an archived project", async () => {
    pursuit!.project.archivedAt = new Date();
    await expect(win(false)).rejects.toThrow(BadRequestException);
    expect(contacts.linkProject).not.toHaveBeenCalled();
  });

  it("update logs a company change", async () => {
    await service.update("p1", { companyId: "co1" }, "org-1");
    expect(prisma.projectPursuitEvent.create).toHaveBeenCalledWith({
      data: { projectId: "p1", text: "Company set to Harbor County" },
    });
  });

  it("update logs clearing the company", async () => {
    (pursuit as PursuitRow & { companyId: string }).companyId = "co1";
    await service.update("p1", { companyId: null } as never, "org-1");
    expect(prisma.projectPursuitEvent.create).toHaveBeenCalledWith({ data: { projectId: "p1", text: "Company cleared" } });
  });

  it("update rejects a closed pursuit", async () => {
    pursuit!.outcome = "lost";
    await expect(service.update("p1", { valueCents: 100 }, "org-1")).rejects.toThrow(BadRequestException);
  });
});
