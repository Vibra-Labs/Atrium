import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export const INTERNAL_KINDS = ["update", "file", "task", "document"] as const;
export type InternalKind = (typeof INTERNAL_KINDS)[number];

export interface InternalItems {
  updates: { id: string; content: string; createdAt: Date; file: { id: string; filename: string } | null }[];
  files: { id: string; filename: string; type: string; createdAt: Date }[];
  tasks: { id: string; title: string; status: string; type: string; createdAt: Date }[];
  documents: { id: string; title: string; type: string; status: string; createdAt: Date }[];
}

/**
 * Items made before a potential contract was won. Staff see them in the Internal tab and can
 * share them with the client one at a time.
 */
@Injectable()
export class InternalItemsService {
  constructor(private prisma: PrismaService) {}

  async list(projectId: string, orgId: string): Promise<InternalItems> {
    const where = { projectId, organizationId: orgId, internal: true };
    const newest = { createdAt: "desc" as const };
    const [updates, files, tasks, documents] = await Promise.all([
      this.prisma.projectUpdate.findMany({
        where,
        orderBy: newest,
        select: { id: true, content: true, createdAt: true, file: { select: { id: true, filename: true } } },
      }),
      // Files attached to an update or a document travel with it, so they aren't listed on their own.
      this.prisma.file.findMany({
        where: {
          ...where,
          updates: { none: {} },
          documents: { none: {} },
          signedDocuments: { none: {} },
          documentVersions: { none: {} },
        },
        orderBy: newest,
        select: { id: true, filename: true, type: true, createdAt: true },
      }),
      this.prisma.task.findMany({
        where,
        orderBy: newest,
        select: { id: true, title: true, status: true, type: true, createdAt: true },
      }),
      this.prisma.document.findMany({
        where,
        orderBy: newest,
        select: { id: true, title: true, type: true, status: true, createdAt: true },
      }),
    ]);
    return { updates, files, tasks, documents };
  }

  /** Makes one internal item visible to the client. Sharing doesn't override a document's draft status. */
  async share(projectId: string, kind: InternalKind, id: string, orgId: string): Promise<void> {
    const where = { id, projectId, organizationId: orgId };
    const data = { internal: false };
    if (kind === "update") {
      const update = await this.prisma.projectUpdate.findFirst({ where, select: { fileId: true } });
      if (!update) throw new NotFoundException("Update not found");
      await this.prisma.$transaction([
        this.prisma.projectUpdate.update({ where: { id }, data }),
        ...(update.fileId ? [this.prisma.file.update({ where: { id: update.fileId }, data })] : []),
      ]);
      return;
    }
    if (kind === "document") {
      const doc = await this.prisma.document.findFirst({
        where,
        select: { fileId: true, signedFileId: true, versions: { select: { fileId: true } } },
      });
      if (!doc) throw new NotFoundException("Document not found");
      const fileIds: string[] = [doc.fileId, ...(doc.signedFileId ? [doc.signedFileId] : []), ...doc.versions.map((v) => v.fileId)];
      await this.prisma.$transaction([
        this.prisma.document.update({ where: { id }, data }),
        this.prisma.file.updateMany({ where: { id: { in: fileIds } }, data }),
      ]);
      return;
    }
    const result =
      kind === "file"
        ? await this.prisma.file.updateMany({ where, data })
        : await this.prisma.task.updateMany({ where, data });
    if (result.count === 0) throw new NotFoundException(kind === "file" ? "File not found" : "Task not found");
  }
}
