import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProjectDto, UpdateProjectDto, DuplicateProjectDto } from "./projects.dto";
import { paginationArgs, paginatedResponse } from "../common";

interface ProjectWhereInput {
  organizationId?: string;
  archivedAt?: null | Date;
  name?: { contains: string; mode: "default" | "insensitive" };
  status?: string;
  clients?: { some: { userId: string } };
  labels?: { some: { labelId: { in: string[] } } };
}

interface ProjectUpdateInput {
  startDate?: Date | null;
  endDate?: Date | null;
}

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    organizationId: string,
    query: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      archived?: string;
      labels?: string;
    },
  ) {
    const { page = 1, limit = 20, search, status, archived, labels } = query;
    const where: ProjectWhereInput = { organizationId };

    if (archived !== "true") {
      where.archivedAt = null;
    }

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }
    if (status) {
      where.status = status;
    }
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
          clients: { select: { userId: true } },
          labels: { include: { label: true } },
        },
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.project.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  async findOne(id: string, organizationId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, organizationId },
      include: {
        files: true,
        clients: { select: { userId: true } },
        labels: { include: { label: true } },
      },
    });
    if (!project) throw new NotFoundException("Project not found");

    return project;
  }

  async findOneByClient(
    id: string,
    clientUserId: string,
    organizationId: string,
  ) {
    const project = await this.prisma.project.findFirst({
      where: {
        id,
        organizationId,
        archivedAt: null,
        clients: { some: { userId: clientUserId } },
      },
      include: { files: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }

  async findByClient(
    clientUserId: string,
    organizationId: string,
    query: { page?: number; limit?: number; search?: string },
  ) {
    const { page = 1, limit = 20, search } = query;
    const where: ProjectWhereInput = {
      organizationId,
      archivedAt: null,
      clients: { some: { userId: clientUserId } },
    };

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const [data, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.project.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  async create(data: CreateProjectDto, organizationId: string) {
    const { clientUserIds, startDate, endDate, ...rest } = data;

    if (clientUserIds?.length) {
      const validMembers = await this.prisma.member.count({
        where: { organizationId, userId: { in: clientUserIds } },
      });
      if (validMembers !== clientUserIds.length) {
        throw new BadRequestException("One or more client user IDs are not members of this organization");
      }
    }

    return this.prisma.project.create({
      data: {
        ...rest,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        organizationId,
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
  }

  async update(id: string, data: UpdateProjectDto, organizationId: string) {
    const existing = await this.prisma.project.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException("Project not found");
    if (existing.archivedAt) {
      throw new BadRequestException("Cannot update an archived project");
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

      const [, project] = await this.prisma.$transaction([
        this.prisma.projectClient.deleteMany({ where: { projectId: id } }),
        this.prisma.project.update({
          where: { id, organizationId },
          data: {
            ...rest,
            ...dateFields,
            clients: {
              create: clientUserIds.map((userId) => ({ userId })),
            },
          },
          include: { clients: { select: { userId: true } } },
        }),
      ]);
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
        tasks: {
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

    return this.prisma.$transaction(async (tx) => {
      const newProject = await tx.project.create({
        data: {
          name: dto.name,
          description: source.description,
          status: source.status,
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
        for (const task of source.tasks) {
          const newTask = await tx.task.create({
            data: {
              title: task.title,
              description: task.description,
              dueDate: task.dueDate,
              status: "open",
              closedAt: null,
              requestedById: task.requestedById,
              assigneeId: task.assigneeId,
              order: task.order,
              type: task.type,
              question: task.question,
              projectId: newProject.id,
              organizationId,
            },
          });

          if (task.options.length) {
            await tx.decisionOption.createMany({
              data: task.options.map((o) => ({
                taskId: newTask.id,
                label: o.label,
                order: o.order,
              })),
            });
          }

          if (task.labels.length) {
            await tx.taskLabel.createMany({
              data: task.labels.map((l) => ({
                taskId: newTask.id,
                labelId: l.labelId,
              })),
            });
          }
        }
      }

      return tx.project.findUnique({
        where: { id: newProject.id },
        include: { clients: { select: { userId: true } } },
      });
    });
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
    const [total, inProgress, completed] = await Promise.all([
      this.prisma.project.count({
        where: { organizationId, archivedAt: null },
      }),
      this.prisma.project.count({
        where: { organizationId, archivedAt: null, status: "in_progress" },
      }),
      this.prisma.project.count({
        where: { organizationId, archivedAt: null, status: "completed" },
      }),
    ]);
    return { total, inProgress, completed };
  }

  async exportAll(organizationId: string) {
    return this.prisma.project.findMany({
      where: { organizationId },
      include: { clients: { select: { userId: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async archive(id: string, organizationId: string) {
    const result = await this.prisma.project.updateMany({
      where: { id, organizationId },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException("Project not found");
  }

  async unarchive(id: string, organizationId: string) {
    const result = await this.prisma.project.updateMany({
      where: { id, organizationId },
      data: { archivedAt: null },
    });
    if (result.count === 0) throw new NotFoundException("Project not found");
  }
}
