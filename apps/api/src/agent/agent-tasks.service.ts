import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import { TimeEntryCaptureService } from "../time-entries/time-entry-capture.service";
import type { CurrentApiKeyContext } from "./decorators/current-api-key.decorator";
import { AuditService } from "./services/audit.service";
import { CreateAgentTaskDto } from "./dto/create-task.dto";
import { UpdateAgentTaskDto } from "./dto/update-task.dto";
import type { AgentResult } from "./agent-projects.service";

@Injectable()
export class AgentTasksService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private timeEntryCapture: TimeEntryCaptureService,
  ) {}

  async create(dto: CreateAgentTaskDto, apiKey: CurrentApiKeyContext, requestId: string): Promise<AgentResult<unknown>> {
    if (dto.externalId) {
      const existing = await this.prisma.task.findFirst({
        where: { organizationId: apiKey.organizationId, externalId: dto.externalId },
      });
      if (existing) return { data: existing, auditEventId: null, created: false };
    }

    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId: apiKey.organizationId },
    });
    if (!project) throw new NotFoundException("Project not found");
    if (dto.assigneeId) await this.assertMember(dto.assigneeId, apiKey.organizationId);

    return this.prisma.$transaction(async (tx) => {
      const maxOrder = await tx.task.aggregate({
        where: { projectId: dto.projectId, organizationId: apiKey.organizationId },
        _max: { order: true },
      });
      const task = await tx.task.create({
        data: {
          projectId: dto.projectId,
          organizationId: apiKey.organizationId,
          title: dto.title,
          description: dto.description,
          assigneeId: dto.assigneeId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          externalId: dto.externalId,
          source: "agent",
          clientVisible: dto.clientVisible ?? true,
          order: (maxOrder._max.order ?? -1) + 1,
        },
      });
      const event = await this.audit.writeAudit({
        tx,
        organizationId: apiKey.organizationId,
        apiKey,
        requestId,
        entityType: "task",
        entityId: task.id,
        action: "created",
        before: null,
        after: task,
      });
      return { data: task, auditEventId: event.id, created: true };
    });
  }

  async update(id: string, dto: UpdateAgentTaskDto, apiKey: CurrentApiKeyContext, requestId: string): Promise<AgentResult<unknown>> {
    const existing = await this.prisma.task.findFirst({
      where: { id, organizationId: apiKey.organizationId },
    });
    if (!existing) throw new NotFoundException("Task not found");
    if (dto.assigneeId) await this.assertMember(dto.assigneeId, apiKey.organizationId);

    const statusChanged = dto.status !== undefined && dto.status !== existing.status;
    const shouldStampCompleted = statusChanged && dto.status === "done" && !existing.completedAt;

    const result = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
          ...(dto.clientVisible !== undefined ? { clientVisible: dto.clientVisible } : {}),
          ...(shouldStampCompleted ? { completedAt: new Date() } : {}),
        },
      });
      const event = await this.audit.writeAudit({
        tx,
        organizationId: apiKey.organizationId,
        apiKey,
        requestId,
        entityType: "task",
        entityId: task.id,
        action: statusChanged ? "status_changed" : "updated",
        before: existing,
        after: task,
      });
      return { data: task, auditEventId: event.id, created: false };
    });

    if (statusChanged && dto.status === "done") {
      await this.timeEntryCapture.captureTaskCompletion({
        orgId: apiKey.organizationId,
        projectId: existing.projectId,
        taskId: existing.id,
        actorType: "agent",
        actorName: `API key ${apiKey.keyPrefix}`,
        taskTitle: existing.title,
      });
    }

    return result;
  }

  private async assertMember(userId: string, organizationId: string) {
    const member = await this.prisma.member.findFirst({ where: { userId, organizationId } });
    if (!member) throw new BadRequestException("assigneeId is not a member of this organization");
  }
}
