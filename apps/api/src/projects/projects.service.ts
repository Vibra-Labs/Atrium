import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import * as Sentry from "@sentry/nestjs";
import { DEFAULT_STATUSES, PROJECT_STATUSES } from "@atrium/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProjectDto, UpdateProjectDto, DuplicateProjectDto } from "./projects.dto";
import { ContactSyncService } from "../contact-sync/contact-sync.service";
import { lockProjectClients } from "../contact-sync/project-links";
import { paginationArgs, paginatedResponse, SIGNED_PROJECT } from "../common";

interface ProjectWhereInput {
  organizationId?: string;
  pursuit?: { is: { outcome: string } | null };
  OR?: ProjectWhereInput[];
  archivedAt?: null | Date;
  name?: { contains: string; mode: "default" | "insensitive" };
  status?: string | { not: string };
  clients?: { some: { userId: string } };
  labels?: { some: { labelId: { in: string[] } } };
}

interface ProjectUpdateInput {
  startDate?: Date | null;
  endDate?: Date | null;
}

// Files that belong to a document (or one of its versions) are listed under
// Documents, not as plain project files.
const STANDALONE_FILES = {
  documents: { none: {} },
  signedDocuments: { none: {} },
  documentVersions: { none: {} },
};

/** Leaves open potential contracts out of counts of active work. */
const NOT_OPEN_PURSUIT = { NOT: { pursuit: { is: { outcome: "open" } } } };

/** Checkbox-task progress for one project. */
type TaskProgress = { total: number; done: number; lastAt: Date | null };

@Injectable()
export class ProjectsService implements OnApplicationBootstrap {
  private readonly logger: Logger = new Logger(ProjectsService.name);

  constructor(
    private prisma: PrismaService,
    private contactSync: ContactSyncService,
  ) {}

  private async syncClients(
    projectId: string,
    organizationId: string,
    userIds: string[],
  ): Promise<void> {
    if (!userIds.length) return;
    try {
      await this.contactSync.linkProjectClients(projectId, organizationId, userIds);
    } catch (err) {
      Sentry.captureException(err);
      this.logger.error("Failed to link project contacts", err);
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.backfillDefaultStatuses();
    } catch (err) {
      this.logger.error("Failed to backfill default project statuses", err);
    }
  }

  /** Gives existing workspaces any default statuses added since they were created. */
  async backfillDefaultStatuses(): Promise<void> {
    const orgs: { id: string }[] = await this.prisma.organization.findMany({ select: { id: true } });
    if (orgs.length === 0) return;
    await this.prisma.projectStatus.createMany({
      data: orgs.flatMap((org) => DEFAULT_STATUSES.map((s) => ({ ...s, organizationId: org.id }))),
      skipDuplicates: true,
    });
  }

  async findAll(
    organizationId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      archived?: string;
      labels?: string;
      pursuit?: "only" | "exclude";
    },
  ) {
    const { page = 1, limit = 20, search, status, archived, labels, pursuit } = query;
    const where: ProjectWhereInput = { organizationId };

    // Archived and cancelled projects are "inactive": hidden unless asked for.
    if (archived !== "true") {
      where.archivedAt = null;
      where.status = { not: PROJECT_STATUSES.CANCELLED };
    }

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }
    if (status) {
      where.status = status;
    }
    if (pursuit === "only") where.pursuit = { is: { outcome: "open" } };
    if (pursuit === "exclude") where.OR = SIGNED_PROJECT.OR;
    if (labels) {
      const labelIds = labels.split(",").filter(Boolean);
      if (labelIds.length > 0) {
        where.labels = { some: { labelId: { in: labelIds } } };
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: {
          clients: {
            select: {
              userId: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
          labels: { include: { label: true } },
          pursuit: { include: { company: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.project.count({ where }),
    ]);

    const taskStats = await this.taskProgress(data.map((p) => p.id), organizationId);
    const rows = data.map((p) => {
      const stats = taskStats.get(p.id);
      return { ...p, taskCount: stats?.total ?? 0, completedTaskCount: stats?.done ?? 0 };
    });
    return paginatedResponse(rows, total, page, limit);
  }

  /**
   * Task progress per project, in one query. Counts checkbox tasks only: an open
   * vote is waiting on the client, not agency work. Cancelled tasks are dropped
   * so they don't cap the bar.
   */
  private async taskProgress(
    projectIds: string[],
    organizationId: string,
  ): Promise<Map<string, TaskProgress>> {
    const taskStats = new Map<string, TaskProgress>();
    if (projectIds.length === 0) return taskStats;

    const taskGroups = await this.prisma.task.groupBy({
      by: ["projectId", "status"],
      where: {
        projectId: { in: projectIds },
        organizationId,
        type: "checkbox",
        internal: false,
        status: { not: "cancelled" },
      },
      _count: { _all: true },
      _max: { updatedAt: true },
    });

    for (const g of taskGroups) {
      const stats = taskStats.get(g.projectId) ?? { total: 0, done: 0, lastAt: null };
      stats.total += g._count._all;
      if (g.status === "done") stats.done += g._count._all;
      if (g._max.updatedAt && (!stats.lastAt || g._max.updatedAt > stats.lastAt)) {
        stats.lastAt = g._max.updatedAt;
      }
      taskStats.set(g.projectId, stats);
    }
    return taskStats;
  }

  async findOne(id: string, organizationId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, organizationId },
      include: {
        files: { where: { ...STANDALONE_FILES, internal: false } },
        clients: { select: { userId: true } },
        labels: { include: { label: true } },
        pursuit: {
          include: {
            company: { select: { id: true, name: true } },
            events: { orderBy: { createdAt: "desc" }, take: 50 },
          },
        },
        contacts: {
          where: { endedAt: null },
          select: {
            contact: {
              select: { id: true, firstName: true, lastName: true, email: true, userId: true, status: true },
            },
          },
        },
      },
    });
    if (!project) throw new NotFoundException("Project not found");

    return project;
  }

  async findOneByClient(
    id: string,
    clientUserId: string,
    organizationId: string,
    isPrivileged = false,
  ) {
    // Clients never see an open or lost potential contract.
    const clientFilter = isPrivileged
      ? {}
      : { clients: { some: { userId: clientUserId } }, ...SIGNED_PROJECT };

    // The project lead is shown by name only, never with the owner's email.
    const [project, org] = await Promise.all([
      this.prisma.project.findFirst({
        where: {
          id,
          organizationId,
          archivedAt: null,
          ...clientFilter,
        },
        include: {
          files: { where: { ...STANDALONE_FILES, internal: false }, orderBy: { createdAt: "desc" } },
          // Counted server-side so the portal banner isn't limited to the task page it has loaded.
          _count: {
            select: {
              tasks: {
                where: {
                  type: "decision",
                  internal: false,
                  closedAt: null,
                  status: { notIn: ["done", "cancelled"] },
                  votes: { none: { userId: clientUserId } },
                },
              },
            },
          },
        },
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          name: true,
          members: {
            where: { role: "owner" },
            select: { user: { select: { id: true, name: true } } },
            take: 1,
          },
        },
      }),
    ]);
    if (!project) throw new NotFoundException("Project not found");
    const { _count, ...rest } = project;
    return { ...rest, organization: org ?? undefined, openVotes: _count?.tasks ?? 0 };
  }

  async findByClient(
    clientUserId: string,
    organizationId: string,
    query: { page?: number; limit?: number; search?: string },
    isPrivileged = false,
  ) {
    const { page = 1, limit = 20, search } = query;
    // Clients never see an open or lost potential contract.
    const clientFilter = isPrivileged
      ? {}
      : { clients: { some: { userId: clientUserId } }, ...SIGNED_PROJECT };

    const where: ProjectWhereInput = {
      organizationId,
      archivedAt: null,
      ...clientFilter,
    };

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const [data, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: {
          _count: { select: { documents: { where: { requiresApproval: true, status: "pending", internal: false } } } },
          // Latest progress update and file, for "last updated". Document files
          // are left out so a draft upload doesn't read as client-visible activity.
          updates: { where: { internal: false }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
          files: {
            where: { ...STANDALONE_FILES, internal: false },
            select: { createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.project.count({ where }),
    ]);

    const taskStats = await this.taskProgress(data.map((p) => p.id), organizationId);

    const rows = data.map(({ _count, updates, files, ...p }) => {
      const stats = taskStats.get(p.id);
      // Child records don't touch project.updatedAt, so take whichever moved last.
      const candidates: (Date | null | undefined)[] = [stats?.lastAt, updates[0]?.createdAt, files[0]?.createdAt];
      const lastActivityAt = candidates.reduce<Date>(
        (latest, d) => (d && d > latest ? d : latest),
        p.updatedAt,
      );
      return {
        ...p,
        pendingApprovals: _count.documents,
        taskCount: stats?.total ?? 0,
        completedTaskCount: stats?.done ?? 0,
        lastActivityAt,
      };
    });
    return paginatedResponse(rows, total, page, limit);
  }

  async create(data: CreateProjectDto, organizationId: string) {
    const { clientUserIds, startDate, endDate, potential, ...rest } = data;
    if (potential && clientUserIds?.length) {
      throw new BadRequestException("Mark it won to give portal access");
    }

    if (clientUserIds?.length) {
      const validMembers = await this.prisma.member.count({
        where: { organizationId, userId: { in: clientUserIds } },
      });
      if (validMembers !== clientUserIds.length) {
        throw new BadRequestException("One or more client user IDs are not members of this organization");
      }
    }

    const created = await this.prisma.project.create({
      data: {
        ...rest,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        organizationId,
        ...(potential
          ? {
              pursuit: {
                create: { organizationId, events: { create: { text: "Created as a potential contract" } } },
              },
            }
          : {}),
        ...(clientUserIds?.length
          ? {
              clients: {
                create: clientUserIds.map((userId) => ({ userId })),
              },
            }
          : {}),
      },
      include: { clients: { select: { userId: true } } },
    });
    await this.syncClients(created.id, organizationId, clientUserIds ?? []);
    return created;
  }

  async update(id: string, data: UpdateProjectDto, organizationId: string) {
    const existing = await this.prisma.project.findFirst({
      where: { id, organizationId },
      include: { pursuit: { select: { outcome: true } } },
    });
    if (!existing) throw new NotFoundException("Project not found");
    if (existing.archivedAt) {
      throw new BadRequestException("Cannot update an archived project");
    }
    if (data.clientUserIds?.length && existing.pursuit && existing.pursuit.outcome !== "won") {
      throw new BadRequestException("Mark it won to give portal access");
    }

    const { clientUserIds, startDate, endDate, ...rest } = data;
    const dateFields: ProjectUpdateInput = {};
    if (startDate !== undefined) dateFields.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) dateFields.endDate = endDate ? new Date(endDate) : null;

    if (rest.status) {
      const validStatus = await this.prisma.projectStatus.findFirst({
        where: { slug: rest.status, organizationId },
      });
      if (!validStatus) {
        throw new BadRequestException(`Invalid status: ${rest.status}`);
      }
    }

    if (clientUserIds !== undefined) {
      if (clientUserIds.length) {
        const validMembers = await this.prisma.member.count({
          where: { organizationId, userId: { in: clientUserIds } },
        });
        if (validMembers !== clientUserIds.length) {
          throw new BadRequestException("One or more client user IDs are not members of this organization");
        }
      }

      const project = await this.prisma.$transaction(async (tx) => {
        // Locked so a concurrent edit can't change the clients between reading and replacing them.
        const previous: string[] = await lockProjectClients(tx, id);
        const removed: string[] = previous.filter((u) => !clientUserIds.includes(u));

        await tx.projectClient.deleteMany({ where: { projectId: id } });
        const updated = await tx.project.update({
          where: { id, organizationId },
          data: {
            ...rest,
            ...dateFields,
            clients: {
              create: clientUserIds.map((userId) => ({ userId })),
            },
          },
          include: { clients: { select: { userId: true } } },
        });
        await this.contactSync.endProjectClients(id, organizationId, removed, tx);
        return updated;
      });
      await this.syncClients(id, organizationId, clientUserIds);
      return project;
    }

    const result = await this.prisma.project.updateMany({
      where: { id, organizationId },
      data: { ...rest, ...dateFields },
    });
    if (result.count === 0) throw new NotFoundException("Project not found");
    return this.prisma.project.findUnique({
      where: { id },
      include: { clients: { select: { userId: true } } },
    });
  }

  async duplicate(
    id: string,
    dto: DuplicateProjectDto,
    organizationId: string,
  ) {
    const source = await this.prisma.project.findFirst({
      where: { id, organizationId },
      include: {
        clients: { select: { userId: true } },
        labels: { select: { labelId: true } },
        pursuit: { select: { outcome: true } },
        // Internal tasks (from before a potential contract was won) aren't copied into client-visible work.
        tasks: {
          where: { internal: false },
          include: {
            options: { select: { label: true, order: true } },
            labels: { select: { labelId: true } },
          },
        },
      },
    });
    if (!source) throw new NotFoundException("Project not found");

    const includeTasks = dto.includeTasks ?? true;
    const includeClients = dto.includeClients ?? false;
    if (includeClients && source.pursuit && source.pursuit.outcome !== "won") {
      throw new BadRequestException("A potential contract has no portal clients to copy");
    }

    const duplicated = await this.prisma.$transaction(async (tx) => {
      // Duplicate = fresh copy semantics:
      // - project status uses the schema default (not_started), not the source's
      // - startDate/endDate are copied but future/past relevance is the user's call
      const newProject = await tx.project.create({
        data: {
          name: dto.name,
          description: source.description,
          startDate: source.startDate,
          endDate: source.endDate,
          organizationId,
        },
      });

      if (source.labels.length) {
        await tx.projectLabel.createMany({
          data: source.labels.map((l) => ({
            projectId: newProject.id,
            labelId: l.labelId,
          })),
        });
      }

      if (includeClients && source.clients.length) {
        await tx.projectClient.createMany({
          data: source.clients.map((c) => ({
            projectId: newProject.id,
            userId: c.userId,
          })),
        });
      }

      if (includeTasks && source.tasks.length) {
        // Template-clone semantics: shape is copied, state is not.
        // Status is reset, dueDate is dropped (source dates don't apply to new work),
        // and assignees/requesters are cleared so the new project starts unowned.
        // Ids are generated up front so tasks, options and labels are bulk inserts.
        const copies = source.tasks.map((task) => ({ task, id: randomUUID() }));
        await tx.task.createMany({
          data: copies.map(({ task, id }) => ({
            id,
            title: task.title,
            description: task.description,
            dueDate: null,
            status: "open",
            closedAt: null,
            requestedById: null,
            assigneeId: null,
            order: task.order,
            type: task.type,
            question: task.question,
            projectId: newProject.id,
            organizationId,
          })),
        });
        const options = copies.flatMap(({ task, id }) =>
          task.options.map((o) => ({ taskId: id, label: o.label, order: o.order })),
        );
        if (options.length) await tx.decisionOption.createMany({ data: options });
        const labels = copies.flatMap(({ task, id }) =>
          task.labels.map((l) => ({ taskId: id, labelId: l.labelId })),
        );
        if (labels.length) await tx.taskLabel.createMany({ data: labels });
      }

      return tx.project.findUnique({
        where: { id: newProject.id },
        include: { clients: { select: { userId: true } } },
      });
    }, {
      // Headroom over Prisma's 5s default for very large templates.
      timeout: 15000,
    });

    if (duplicated && includeClients) {
      await this.syncClients(
        duplicated.id,
        organizationId,
        source.clients.map((c) => c.userId),
      );
    }
    return duplicated;
  }

  async remove(id: string, organizationId: string) {
    const result = await this.prisma.project.deleteMany({
      where: { id, organizationId },
    });
    if (result.count === 0) throw new NotFoundException("Project not found");
  }

  async getStatuses(organizationId: string) {
    return this.prisma.projectStatus.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });
  }

  async getStats(organizationId: string) {
    const [total, inProgress, inReview, completed, waitingReviews, waitingSignatures] = await Promise.all([
      this.prisma.project.count({
        where: { organizationId, archivedAt: null, status: { not: PROJECT_STATUSES.CANCELLED }, ...NOT_OPEN_PURSUIT },
      }),
      this.prisma.project.count({
        where: { organizationId, archivedAt: null, status: "in_progress", ...NOT_OPEN_PURSUIT },
      }),
      this.prisma.project.count({
        where: { organizationId, archivedAt: null, status: "in_review", ...NOT_OPEN_PURSUIT },
      }),
      this.prisma.project.count({
        where: { organizationId, archivedAt: null, status: "completed", ...NOT_OPEN_PURSUIT },
      }),
      this.prisma.document.count({
        where: {
          project: { organizationId, archivedAt: null, ...NOT_OPEN_PURSUIT },
          internal: false,
          type: "deliverable",
          status: "pending",
        },
      }),
      // Deliverables are counted above, so a deliverable that also needs a signature isn't counted twice.
      this.prisma.document.count({
        where: {
          project: { organizationId, archivedAt: null, ...NOT_OPEN_PURSUIT },
          internal: false,
          type: { not: "deliverable" },
          requiresSignature: true,
          status: "pending",
        },
      }),
    ]);
    return {
      total,
      inProgress,
      inReview,
      completed,
      waitingOnClients: waitingReviews + waitingSignatures,
      waitingReviews,
      waitingSignatures,
    };
  }

  async exportAll(organizationId: string) {
    return this.prisma.project.findMany({
      where: { organizationId },
      include: { clients: { select: { userId: true } }, pursuit: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Gives a newly joined client the won projects they were invited to from the Won dialog.
   * Rows for projects that aren't won (yet) are left in place.
   */
  async grantPendingAccess(organizationId: string, userId: string, email: string): Promise<number> {
    const rows = await this.prisma.pendingProjectAccess.findMany({
      where: {
        organizationId,
        email: { equals: email.toLowerCase(), mode: "insensitive" },
        project: { pursuit: { is: { outcome: "won" } } },
      },
      select: { id: true, projectId: true },
    });
    for (const row of rows) {
      await this.prisma.projectClient.createMany({ data: [{ projectId: row.projectId, userId }], skipDuplicates: true });
      await this.syncClients(row.projectId, organizationId, [userId]);
      await this.prisma.pendingProjectAccess.delete({ where: { id: row.id } });
    }
    return rows.length;
  }

  async archive(id: string, organizationId: string) {
    const result = await this.prisma.project.updateMany({
      where: { id, organizationId },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException("Project not found");
  }

  async unarchive(id: string, organizationId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, organizationId },
      select: { pursuit: { select: { outcome: true } } },
    });
    if (!project) throw new NotFoundException("Project not found");
    // A lost deal comes back through Reopen, which also clears its lost state.
    if (project.pursuit?.outcome === "lost") {
      throw new BadRequestException("This potential contract was lost. Reopen it instead");
    }
    const result = await this.prisma.project.updateMany({
      where: { id, organizationId },
      data: { archivedAt: null },
    });
    if (result.count === 0) throw new NotFoundException("Project not found");
  }
}
