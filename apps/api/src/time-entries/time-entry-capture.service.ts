import { Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { PrismaService } from "../prisma/prisma.service";

export type TimeEntryLogActorType = "user" | "agent";

export interface CaptureTaskCompletionInput {
  orgId: string;
  projectId: string;
  taskId: string;
  actorType: TimeEntryLogActorType;
  actorName?: string | null;
  taskTitle: string;
}

@Injectable()
export class TimeEntryCaptureService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(TimeEntryCaptureService.name) private readonly logger: PinoLogger,
  ) {}

  async captureTaskCompletion(input: CaptureTaskCompletionInput): Promise<void> {
    try {
      const running = await this.prisma.timeEntry.findFirst({
        where: {
          organizationId: input.orgId,
          projectId: input.projectId,
          endedAt: null,
        },
        select: { id: true, userId: true },
        orderBy: { startedAt: "desc" },
      });

      const text = `Completed: ${input.taskTitle}`;
      if (running) {
        await this.prisma.timeEntryLog.create({
          data: {
            timeEntryId: running.id,
            organizationId: input.orgId,
            userId: running.userId,
            kind: "task_done",
            text,
            taskId: input.taskId,
            actorType: input.actorType,
          },
        });
        return;
      }

      const actorLabel = input.actorName?.trim() || (input.actorType === "agent" ? "Agent" : "User");
      await this.prisma.pendingTimeCapture.create({
        data: {
          organizationId: input.orgId,
          projectId: input.projectId,
          taskId: input.taskId,
          kind: "task_done",
          label: `${actorLabel} completed “${input.taskTitle}”`,
          completedByType: input.actorType,
          completedByName: input.actorName?.trim() || null,
        },
      });
    } catch (err) {
      this.logger.warn({ err, input }, "Failed to capture task completion journal entry");
    }
  }
}
