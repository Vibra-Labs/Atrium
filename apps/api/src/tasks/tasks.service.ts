import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ActivityService } from "../activity/activity.service";
import { paginationArgs, paginatedResponse } from "../common";
import { CreateTaskDto, CreateClientTaskDto, UpdateTaskDto } from "./tasks.dto";

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private activityService: ActivityService,
    @InjectPinoLogger(TasksService.name) private readonly logger: PinoLogger,
  ) {}

  async create(dto: CreateTaskDto, projectId: string, orgId: string, requestedById?: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
    });
    if (!project) throw new NotFoundException("Project not found");

    const maxOrder = await this.prisma.task.aggregate({
      where: { projectId, organizationId: orgId },
      _max: { order: true },
    });
    const order = (maxOrder._max.order ?? -1) + 1;

    const isDecision = dto.type === "decision";

    if (isDecision) {
      if (!dto.question) throw new BadRequestException("Question is required for decision tasks");
      if (!dto.options || dto.options.length < 2) {
        throw new BadRequestException("Decision tasks require at least 2 options");
      }
    }

    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: "open",
        requestedById: requestedById ?? null,
        order,
        type: isDecision ? "decision" : "checkbox",
        question: isDecision ? dto.question : undefined,
        projectId,
        organizationId: orgId,
        ...(isDecision && dto.options
          ? {
              options: {
                create: dto.options.map((opt, idx) => ({
                  label: opt.label,
                  order: idx,
                })),
              },
            }
          : {}),
      },
      include: {
        options: isDecision ? { orderBy: { order: "asc" as const } } : false,
      },
    });

    this.notifications.notifyTaskCreated(
      projectId,
      dto.title,
      dto.dueDate ? new Date(dto.dueDate) : undefined,
    );

    return task;
  }

  /**
   * Create a task on behalf of a portal client.
   * Validates that the caller is assigned to the project.
   * Only checkbox tasks allowed.
   */
  async createForClient(
    dto: CreateClientTaskDto,
    projectId: string,
    userId: string,
    orgId: string,
  ) {
    const assignment = await this.prisma.projectClient.findFirst({
      where: { projectId, userId, project: { organizationId: orgId } },
      include: { user: { select: { name: true } } },
    });
    if (!assignment) throw new ForbiddenException("Not assigned to this project");

    const maxOrder = await this.prisma.task.aggregate({
      where: { projectId, organizationId: orgId },
      _max: { order: true },
    });
    const order = (maxOrder._max.order ?? -1) + 1;

    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: "open",
        requestedById: userId,
        order,
        type: "checkbox",
        projectId,
        organizationId: orgId,
      },
    });

    this.notifications.notifyClientRequestCreated(
      projectId,
      orgId,
      dto.title,
      assignment.user.name,
    );

    return task;
  }

  async findByProject(
    projectId: string,
    orgId: string,
    page = 1,
    limit = 20,
    status?: string,
  ) {
    const statusFilter =
      status === "active"
        ? { status: { in: ["open", "in_progress"] } }
        : status && status !== "all"
        ? { status }
        : {};
    const where = { projectId, organizationId: orgId, ...statusFilter };
    const [data, total, members] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: {
          options: {
            orderBy: { order: "asc" },
            include: {
              _count: { select: { votes: true } },
            },
          },
          labels: { include: { label: true } },
          _count: { select: { votes: true, comments: true } },
        },
        orderBy: { order: "asc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.task.count({ where }),
      this.prisma.member.findMany({
        where: { organizationId: orgId },
        select: { userId: true },
      }),
    ]);

    const memberUserIds = new Set(members.map((m) => m.userId));

    const enriched = data.map((task) => ({
      ...task,
      isClientRequest: task.requestedById ? !memberUserIds.has(task.requestedById) : false,
    }));

    return paginatedResponse(enriched, total, page, limit);
  }

  async findByProjectForClient(
    projectId: string,
    userId: string,
    orgId: string,
    page = 1,
    limit = 20,
  ) {
    const assignment = await this.prisma.projectClient.findFirst({
      where: { projectId, userId, project: { organizationId: orgId } },
    });
    if (!assignment) {
      throw new ForbiddenException("Not assigned to this project");
    }

    const where = { projectId, organizationId: orgId };
    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: {
          options: {
            orderBy: { order: "asc" },
            include: {
              _count: { select: { votes: true } },
            },
          },
          votes: {
            where: { userId },
            select: { optionId: true },
          },
          _count: { select: { votes: true, comments: true } },
        },
        orderBy: { order: "asc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.task.count({ where }),
    ]);

    const clientCount = await this.prisma.projectClient.count({ where: { projectId } });

    const sanitized = data.map((task) => {
      if (task.type === "decision" && !task.closedAt && task.options) {
        const allVoted = task._count.votes >= clientCount;
        if (!allVoted) {
          return {
            ...task,
            options: task.options.map((opt) => ({
              ...opt,
              _count: { votes: 0 },
            })),
            _count: { votes: 0, comments: task._count.comments },
          };
        }
      }
      return task;
    });

    return paginatedResponse(sanitized, total, page, limit);
  }

  async exportByProject(projectId: string, orgId: string) {
    return this.prisma.task.findMany({
      where: { projectId, organizationId: orgId },
      orderBy: { order: "asc" },
    });
  }

  async vote(taskId: string, optionId: string, userId: string, orgId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId, type: "decision" },
      include: { options: true },
    });
    if (!task) throw new NotFoundException("Decision task not found");
    if (task.closedAt) throw new BadRequestException("Voting is closed");

    const assignment = await this.prisma.projectClient.findFirst({
      where: { projectId: task.projectId, userId },
    });
    if (!assignment) {
      throw new ForbiddenException("Not assigned to this project");
    }

    const option = task.options.find((o) => o.id === optionId);
    if (!option) throw new BadRequestException("Invalid option");

    const vote = await this.prisma.decisionVote.upsert({
      where: { taskId_userId: { taskId, userId } },
      create: { optionId, taskId, userId },
      update: { optionId },
    });

    this.activityService
      .create({
        type: "decision_vote",
        action: "voted",
        actorId: userId,
        targetId: taskId,
        targetTitle: task.question || task.title,
        detail: option.label,
        projectId: task.projectId,
        organizationId: orgId,
      })
      .catch((err) => this.logger.warn({ err }, "Failed to log decision vote activity"));

    return vote;
  }

  async closeVoting(taskId: string, orgId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId, type: "decision" },
    });
    if (!task) throw new NotFoundException("Decision task not found");
    if (task.closedAt) throw new BadRequestException("Voting is already closed");

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { closedAt: new Date(), status: "done" },
      include: {
        options: {
          orderBy: { order: "asc" },
          include: {
            _count: { select: { votes: true } },
          },
        },
      },
    });

    this.notifications.notifyDecisionClosed(taskId);

    this.activityService
      .create({
        type: "decision_closed",
        action: "closed",
        actorId: "system",
        targetId: taskId,
        targetTitle: task.question || task.title,
        projectId: task.projectId,
        organizationId: orgId,
      })
      .catch((err) => this.logger.warn({ err }, "Failed to log decision closed activity"));

    return updated;
  }

  async update(id: string, dto: UpdateTaskDto, orgId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!task) throw new NotFoundException("Task not found");

    if (dto.assigneeId) {
      const member = await this.prisma.member.findFirst({
        where: {
          userId: dto.assigneeId,
          organizationId: orgId,
          role: { in: ["owner", "admin"] },
        },
      });
      if (!member) throw new BadRequestException("Assignee must be an agency member (owner or admin)");
    }

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
      },
    });

    if (dto.status && dto.status !== task.status) {
      this.notifications.notifyTaskStatusChanged(
        task.id,
        task.title,
        task.projectId,
        orgId,
        dto.status,
        task.requestedById,
        updated.assigneeId,
      );
    }

    if (dto.assigneeId && dto.assigneeId !== task.assigneeId) {
      this.notifications.notifyTaskAssigned(
        task.title,
        task.projectId,
        orgId,
        dto.assigneeId,
      );
    }

    return updated;
  }

  /**
   * Cancel a task that the client originally requested.
   * Only the requesting user can cancel their own open tasks.
   */
  async cancelClientTask(taskId: string, userId: string, orgId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
    });
    if (!task) throw new NotFoundException("Task not found");
    if (task.requestedById !== userId) throw new ForbiddenException("Cannot cancel this task");
    if (task.status !== "open") throw new BadRequestException("Only open tasks can be cancelled");

    return this.prisma.task.update({
      where: { id: taskId },
      data: { status: "cancelled" },
    });
  }

  async reorder(taskIds: string[], orgId: string) {
    const updates = taskIds.map((id, index) =>
      this.prisma.task.updateMany({
        where: { id, organizationId: orgId },
        data: { order: index },
      }),
    );
    await this.prisma.$transaction(updates);
  }

  async remove(id: string, orgId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!task) throw new NotFoundException("Task not found");

    await this.prisma.task.delete({ where: { id } });
  }
}
