import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { paginationArgs, paginatedResponse } from "../common";
import { CreateTaskDto, UpdateTaskDto } from "./tasks.dto";

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(dto: CreateTaskDto, projectId: string, orgId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
    });
    if (!project) throw new NotFoundException("Project not found");

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
        order,
        projectId,
        organizationId: orgId,
      },
    });

    this.notifications.notifyTaskCreated(
      projectId,
      dto.title,
      dto.dueDate ? new Date(dto.dueDate) : undefined,
    );

    return task;
  }

  async findByProject(
    projectId: string,
    orgId: string,
    page = 1,
    limit = 20,
  ) {
    const where = { projectId, organizationId: orgId };
    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: { order: "asc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.task.count({ where }),
    ]);
    return paginatedResponse(data, total, page, limit);
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

    return this.findByProject(projectId, orgId, page, limit);
  }

  async update(id: string, dto: UpdateTaskDto, orgId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!task) throw new NotFoundException("Task not found");

    return this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
        completed: dto.completed,
      },
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
