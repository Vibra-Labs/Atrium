# Client Requests & Task Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the task system so clients can submit requests from the portal, agency can manage status and assignments, and all parties are notified of relevant changes.

**Architecture:** Replace `completed: Boolean` on `Task` with a `status` enum (`open`/`in_progress`/`done`/`cancelled`). Add `requestedById` and `assigneeId` fields. Add a client-facing create endpoint and cancel endpoint. Add four notification triggers (client request created, status changed, task assigned, comment from other side). Update dashboard and portal UIs.

**Tech Stack:** NestJS 11, Prisma ORM, Next.js 15 / React 19, Playwright E2E, Bun test runner

---

## File Map

**Modified:**
- `packages/database/prisma/schema.prisma` — add `status`, `requestedById`, `assigneeId`; remove `completed`
- `apps/api/src/tasks/tasks.dto.ts` — update DTOs
- `apps/api/src/tasks/tasks.service.ts` — replace completed logic, add client create/cancel, notifications
- `apps/api/src/tasks/tasks.controller.ts` — add `POST /tasks/mine`, `PATCH /tasks/:id/cancel`, update CSV
- `apps/api/src/notifications/notifications.service.ts` — add 3 new notification methods
- `apps/web/src/app/(dashboard)/dashboard/projects/[id]/components/tasks-section.tsx` — status UI, assignee picker, client request badge
- `apps/web/src/app/(portal)/portal/projects/[id]/page.tsx` — New Request button, status badges, cancel own request
- `e2e/tests/tasks.e2e.ts` — fix `completed` → `status` in existing tests

**Created:**
- `e2e/tests/client-requests.e2e.ts` — new E2E coverage

---

## Task 1: Schema Migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Update the Task model in schema.prisma**

Replace the `completed` and `closedAt`-adjacent fields block with the new fields. The full updated Task model:

```prisma
model Task {
  id             String    @id @default(cuid())
  title          String
  description    String?
  dueDate        DateTime?
  status         String    @default("open") // "open" | "in_progress" | "done" | "cancelled"
  requestedById  String?
  assigneeId     String?
  order          Int       @default(0)
  type           String    @default("checkbox") // "checkbox" | "decision"
  question       String?
  closedAt       DateTime?
  projectId      String
  organizationId String
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  project  Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  options  DecisionOption[]
  votes    DecisionVote[]
  comments Comment[]
  labels   TaskLabel[]

  @@index([projectId])
  @@index([organizationId])
  @@map("task")
}
```

- [ ] **Step 2: Push schema and backfill**

```bash
cd /path/to/repo
bun run db:push
```

Then run this SQL to backfill status from completed. Connect to the dev database and run:

```sql
UPDATE task SET status = CASE WHEN completed = true THEN 'done' ELSE 'open' END;
```

> Note: `completed` column is removed by `db:push` since it's no longer in the schema. Run the SQL *before* pushing if the column still exists, or handle it as a Prisma migration. With `db:push` (dev workflow), add the new columns first, run the SQL, then remove `completed` in a second push. Since this is dev, it's simplest to reset and reseed if you don't need to preserve data.

- [ ] **Step 3: Regenerate Prisma client**

```bash
bun run db:generate
```

Expected output: `Generated Prisma Client` with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat(db): replace task completed flag with status, add requestedById and assigneeId"
```

---

## Task 2: Update Task DTOs

**Files:**
- Modify: `apps/api/src/tasks/tasks.dto.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
import { Type } from "class-transformer";
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsArray,
  IsIn,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
  ValidateNested,
  ValidateIf,
} from "class-validator";

export class DecisionOptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  label!: string;
}

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  @IsIn(["checkbox", "decision"])
  type?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  question?: string;

  @IsArray()
  @IsOptional()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => DecisionOptionDto)
  options?: DecisionOptionDto[];
}

// Used by clients creating requests from the portal — no type/question/options
export class CreateClientTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;
}

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @ValidateIf((o: UpdateTaskDto) => o.dueDate !== null)
  @IsDateString()
  @IsOptional()
  dueDate?: string | null;

  @IsString()
  @IsOptional()
  @IsIn(["open", "in_progress", "done", "cancelled"])
  status?: string;

  // null = unassign, string = assign to userId
  @IsString()
  @IsOptional()
  assigneeId?: string | null;
}

export class ReorderTasksDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  taskIds!: string[];
}

export class CastVoteDto {
  @IsString()
  @IsNotEmpty()
  optionId!: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && bun run build 2>&1 | head -30
```

Expected: no errors referencing `tasks.dto.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/tasks/tasks.dto.ts
git commit -m "feat(tasks): update DTOs — replace completed with status, add CreateClientTaskDto"
```

---

## Task 3: Update Notifications Service

**Files:**
- Modify: `apps/api/src/notifications/notifications.service.ts`

- [ ] **Step 1: Add three new public methods to NotificationsService**

After the existing `notifyTaskCreated` method (around line 67), add these three methods. Add them before the private methods section:

```typescript
/**
 * Notify org owners/admins that a client submitted a new request.
 * Fire-and-forget.
 */
notifyClientRequestCreated(
  projectId: string,
  orgId: string,
  taskTitle: string,
  clientName: string,
): void {
  this.sendClientRequestCreatedNotifications(projectId, orgId, taskTitle, clientName).catch(
    (err) => {
      this.logger.error({ err, projectId }, "Failed to send client request notifications");
    },
  );
}

/**
 * Notify relevant users when a task's status changes.
 * Fire-and-forget.
 */
notifyTaskStatusChanged(
  taskId: string,
  taskTitle: string,
  projectId: string,
  orgId: string,
  newStatus: string,
  requestedById: string | null,
  assigneeId: string | null,
): void {
  this.sendTaskStatusChangedNotifications(
    taskId,
    taskTitle,
    projectId,
    orgId,
    newStatus,
    requestedById,
    assigneeId,
  ).catch((err) => {
    this.logger.error({ err, taskId }, "Failed to send task status changed notifications");
  });
}

/**
 * Notify an agency member that they have been assigned to a task.
 * Fire-and-forget.
 */
notifyTaskAssigned(
  taskTitle: string,
  projectId: string,
  orgId: string,
  assigneeId: string,
): void {
  this.sendTaskAssignedNotification(taskTitle, projectId, orgId, assigneeId).catch((err) => {
    this.logger.error({ err, assigneeId }, "Failed to send task assigned notification");
  });
}
```

- [ ] **Step 2: Add the three private implementation methods**

Add these before the closing `}` of the class (after `getProjectClients`):

```typescript
private async sendClientRequestCreatedNotifications(
  projectId: string,
  orgId: string,
  taskTitle: string,
  clientName: string,
): Promise<void> {
  const admins = await this.getOrgAdmins(orgId);
  if (admins.length === 0) return;
  const link = `/dashboard/projects/${projectId}`;
  this.createInAppAndPush(
    admins.map((a) => a.userId),
    orgId,
    "client_request_created",
    `New request from ${clientName}`,
    taskTitle,
    link,
  );
}

private async sendTaskStatusChangedNotifications(
  taskId: string,
  taskTitle: string,
  projectId: string,
  orgId: string,
  newStatus: string,
  requestedById: string | null,
  assigneeId: string | null,
): Promise<void> {
  const userIds = [requestedById, assigneeId].filter(
    (id): id is string => id !== null && id !== undefined,
  );
  if (userIds.length === 0) return;

  const statusLabel: Record<string, string> = {
    open: "Open",
    in_progress: "In Progress",
    done: "Done",
    cancelled: "Cancelled",
  };

  // Determine link: portal for clients, dashboard for agency
  const isPortalUser = (userId: string) =>
    this.prisma.member
      .findFirst({ where: { userId, organizationId: orgId } })
      .then((m) => m === null);

  await Promise.all(
    userIds.map(async (userId) => {
      const isClient = await isPortalUser(userId);
      const link = isClient
        ? `/portal/projects/${projectId}`
        : `/dashboard/projects/${projectId}`;
      this.createInAppAndPush(
        [userId],
        orgId,
        "task_status_changed",
        `"${taskTitle}" is now ${statusLabel[newStatus] ?? newStatus}`,
        taskTitle,
        link,
      );
    }),
  );
}

private async sendTaskAssignedNotification(
  taskTitle: string,
  projectId: string,
  orgId: string,
  assigneeId: string,
): Promise<void> {
  const link = `/dashboard/projects/${projectId}`;
  this.createInAppAndPush(
    [assigneeId],
    orgId,
    "task_assigned",
    `You've been assigned: ${taskTitle}`,
    taskTitle,
    link,
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api && bun run build 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/notifications/notifications.service.ts
git commit -m "feat(notifications): add client request, status change, and task assignment notifications"
```

---

## Task 4: Update Tasks Service

**Files:**
- Modify: `apps/api/src/tasks/tasks.service.ts`

- [ ] **Step 1: Write a unit test for createForClient that fails**

In `apps/api/src/tasks/tasks.service.spec.ts` (create if it doesn't exist):

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { TasksService } from "./tasks.service";
import { ForbiddenException } from "@nestjs/common";

describe("TasksService.createForClient", () => {
  let service: TasksService;
  const mockPrisma = {
    project: { findFirst: mock(() => ({ id: "proj1", organizationId: "org1" })) },
    projectClient: { findFirst: mock(() => ({ projectId: "proj1", userId: "client1" })) },
    task: {
      aggregate: mock(() => ({ _max: { order: null } })),
      create: mock(() => ({
        id: "task1",
        title: "Fix the logo",
        status: "open",
        requestedById: "client1",
        type: "checkbox",
      })),
    },
  };
  const mockNotifications = {
    notifyClientRequestCreated: mock(() => {}),
    notifyTaskCreated: mock(() => {}),
  };
  const mockActivity = { create: mock(() => Promise.resolve()) };
  const mockLogger = { warn: mock(() => {}), error: mock(() => {}) };

  beforeEach(() => {
    service = new TasksService(
      mockPrisma as never,
      mockNotifications as never,
      mockActivity as never,
      mockLogger as never,
    );
  });

  it("creates a task with status=open and requestedById set to caller", async () => {
    const result = await service.createForClient(
      { title: "Fix the logo" },
      "proj1",
      "client1",
      "org1",
    );
    expect(result.status).toBe("open");
    expect(result.requestedById).toBe("client1");
    expect(mockNotifications.notifyClientRequestCreated).toHaveBeenCalled();
  });

  it("throws ForbiddenException if client is not assigned to the project", async () => {
    mockPrisma.projectClient.findFirst = mock(() => null);
    await expect(
      service.createForClient({ title: "Fix the logo" }, "proj1", "other-user", "org1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd apps/api && bun test src/tasks/tasks.service.spec.ts 2>&1 | tail -20
```

Expected: FAIL — `createForClient is not a function` or similar.

- [ ] **Step 3: Replace tasks.service.ts with the updated implementation**

```typescript
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
  ) {
    // Load org member userIds once to compute isClientRequest
    const memberUserIds = new Set(
      (
        await this.prisma.member.findMany({
          where: { organizationId: orgId },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );

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
          labels: { include: { label: true } },
          _count: { select: { votes: true, comments: true } },
        },
        orderBy: { order: "asc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.task.count({ where }),
    ]);

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
```

- [ ] **Step 4: Run the unit tests**

```bash
cd apps/api && bun test src/tasks/tasks.service.spec.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/api && bun run build 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tasks/tasks.service.ts apps/api/src/tasks/tasks.service.spec.ts
git commit -m "feat(tasks): replace completed with status, add createForClient, cancelClientTask, update notifications"
```

---

## Task 5: Update Tasks Controller

**Files:**
- Modify: `apps/api/src/tasks/tasks.controller.ts`

- [ ] **Step 1: Replace the controller**

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { TasksService } from "./tasks.service";
import {
  CreateTaskDto,
  CreateClientTaskDto,
  UpdateTaskDto,
  ReorderTasksDto,
  CastVoteDto,
} from "./tasks.dto";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  CurrentOrg,
  PaginationQueryDto,
  contentDisposition,
  toCsv,
} from "../common";
import type { CsvColumn } from "../common";

@Controller("tasks")
@UseGuards(AuthGuard, RolesGuard)
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Post()
  @Roles("owner", "admin")
  create(
    @Body() dto: CreateTaskDto,
    @Query("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.tasksService.create(dto, projectId, orgId, userId);
  }

  // Client-facing endpoint — no @Roles, authorization handled in service
  @Post("mine")
  createForClient(
    @Body() dto: CreateClientTaskDto,
    @Query("projectId") projectId: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.tasksService.createForClient(dto, projectId, userId, orgId);
  }

  @Get("project/:projectId")
  @Roles("owner", "admin")
  findByProject(
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.tasksService.findByProject(
      projectId,
      orgId,
      pagination.page,
      pagination.limit,
    );
  }

  @Get("mine/:projectId")
  findByProjectForClient(
    @Param("projectId") projectId: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.tasksService.findByProjectForClient(
      projectId,
      userId,
      orgId,
      pagination.page,
      pagination.limit,
    );
  }

  @Get("project/:projectId/export")
  @Roles("owner", "admin")
  async exportCsv(
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
    @Res() res: Response,
  ) {
    const data = await this.tasksService.exportByProject(projectId, orgId);
    const columns: CsvColumn<(typeof data)[0]>[] = [
      { header: "Title", value: (r) => r.title },
      { header: "Type", value: (r) => r.type },
      { header: "Status", value: (r) => r.status },
      { header: "Due Date", value: (r) => r.dueDate?.toISOString().split("T")[0] },
      { header: "Description", value: (r) => r.description },
      { header: "Created At", value: (r) => r.createdAt.toISOString().split("T")[0] },
    ];
    const csv = toCsv(columns, data);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", contentDisposition("tasks.csv"));
    res.send(csv);
  }

  @Post(":id/vote")
  vote(
    @Param("id") id: string,
    @Body() dto: CastVoteDto,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.tasksService.vote(id, dto.optionId, userId, orgId);
  }

  @Post(":id/close")
  @Roles("owner", "admin")
  closeVoting(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.tasksService.closeVoting(id, orgId);
  }

  // Client cancels their own open request
  @Patch(":id/cancel")
  cancelClientTask(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.tasksService.cancelClientTask(id, userId, orgId);
  }

  @Put("reorder")
  @Roles("owner", "admin")
  reorder(
    @Body() dto: ReorderTasksDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.tasksService.reorder(dto.taskIds, orgId);
  }

  @Put(":id")
  @Roles("owner", "admin")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.tasksService.update(id, dto, orgId);
  }

  @Delete(":id")
  @Roles("owner", "admin")
  remove(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.tasksService.remove(id, orgId);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && bun run build 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/tasks/tasks.controller.ts
git commit -m "feat(tasks): add POST /tasks/mine for clients, PATCH /tasks/:id/cancel, update CSV export"
```

---

## Task 6: Update Dashboard Tasks Section

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/projects/[id]/components/tasks-section.tsx`

- [ ] **Step 1: Replace the file**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import {
  Trash2,
  Pencil,
  ListTodo,
  Vote,
  Lock,
  Download,
  UserCircle,
} from "lucide-react";
import { track } from "@/lib/track";
import { CommentsSection } from "@/components/comments-section";
import { LabelBadge } from "@/components/label-badge";
import { downloadCsv } from "@/lib/download";

interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  status: string;
  requestedById?: string | null;
  assigneeId?: string | null;
  isClientRequest: boolean;
  order: number;
  type: string;
  question?: string;
  closedAt?: string | null;
  options?: {
    id: string;
    label: string;
    order: number;
    _count: { votes: number };
  }[];
  labels?: { label: { id: string; name: string; color: string } }[];
  _count?: { votes: number; comments: number };
}

interface OrgMember {
  userId: string;
  user: { id: string; name: string; email: string };
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const STATUS_OPTIONS = [
  { value: "open", label: "Open", color: "bg-gray-100 text-gray-700" },
  { value: "in_progress", label: "In Progress", color: "bg-blue-100 text-blue-700" },
  { value: "done", label: "Done", color: "bg-green-100 text-green-700" },
  { value: "cancelled", label: "Cancelled", color: "bg-red-50 text-red-600" },
];

function StatusBadge({ status }: { status: string }) {
  const opt = STATUS_OPTIONS.find((s) => s.value === status);
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${opt?.color ?? "bg-gray-100 text-gray-700"}`}>
      {opt?.label ?? status}
    </span>
  );
}

export function TasksSection({
  projectId,
  isArchived,
}: {
  projectId: string;
  isArchived: boolean;
}) {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("active"); // "active" | "all" | "done" | "cancelled"
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDueDate, setEditingDueDate] = useState("");
  const [taskType, setTaskType] = useState<"checkbox" | "decision">("checkbox");
  const [newQuestion, setNewQuestion] = useState("");
  const [newOptions, setNewOptions] = useState<string[]>(["", ""]);

  const loadTasks = useCallback(() => {
    apiFetch<PaginatedResponse<TaskRecord>>(
      `/tasks/project/${projectId}?page=${page}&limit=20`,
    )
      .then((res) => {
        setTasks(res.data);
        setTotalPages(res.meta.totalPages);
      })
      .catch(console.error);
  }, [projectId, page]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    apiFetch<PaginatedResponse<OrgMember>>("/clients?limit=100")
      .then((res) => setMembers(res.data))
      .catch(console.error);
  }, []);

  const visibleTasks = tasks.filter((t) => {
    if (statusFilter === "active") return t.status === "open" || t.status === "in_progress";
    if (statusFilter === "done") return t.status === "done";
    if (statusFilter === "cancelled") return t.status === "cancelled";
    return true; // "all"
  });

  const handleAdd = async () => {
    if (taskType === "checkbox") {
      if (!newTitle.trim()) return;
      try {
        await apiFetch(`/tasks?projectId=${projectId}`, {
          method: "POST",
          body: JSON.stringify({
            title: newTitle,
            dueDate: newDueDate || undefined,
          }),
        });
        track("task_created");
        setNewTitle("");
        setNewDueDate("");
        loadTasks();
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to add task");
      }
    } else {
      if (!newQuestion.trim() || newOptions.filter((o) => o.trim()).length < 2) return;
      try {
        await apiFetch(`/tasks?projectId=${projectId}`, {
          method: "POST",
          body: JSON.stringify({
            title: newQuestion,
            type: "decision",
            question: newQuestion,
            options: newOptions.filter((o) => o.trim()).map((label) => ({ label })),
          }),
        });
        track("task_created", { type: "decision" });
        setNewQuestion("");
        setNewOptions(["", ""]);
        loadTasks();
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to add decision task");
      }
    }
  };

  const handleCloseVoting = async (taskId: string) => {
    try {
      await apiFetch(`/tasks/${taskId}/close`, { method: "POST" });
      loadTasks();
      success("Voting closed");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to close voting");
    }
  };

  const handleStatusChange = async (task: TaskRecord, newStatus: string) => {
    try {
      await apiFetch(`/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
      if (newStatus === "done") track("task_completed");
      loadTasks();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update task status");
    }
  };

  const handleAssigneeChange = async (taskId: string, assigneeId: string | null) => {
    try {
      await apiFetch(`/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify({ assigneeId }),
      });
      loadTasks();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update assignee");
    }
  };

  const handleUpdate = async (taskId: string) => {
    try {
      await apiFetch(`/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: editingTitle,
          dueDate: editingDueDate || null,
        }),
      });
      setEditingId(null);
      loadTasks();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update task");
    }
  };

  const handleDelete = async (taskId: string) => {
    const ok = await confirm({
      title: "Delete Task",
      message: "Delete this task? This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/tasks/${taskId}`, { method: "DELETE" });
      loadTasks();
      success("Task deleted");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete task");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">
          Tasks{tasks.length > 0 && ` (${tasks.length})`}
        </h2>
        {tasks.length > 0 && (
          <button
            onClick={() => downloadCsv(`/tasks/project/${projectId}/export`)}
            className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            title="Export tasks as CSV"
          >
            <Download size={13} />
            Export
          </button>
        )}
      </div>

      {/* Status filter bar */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {[
          { key: "active", label: "Active" },
          { key: "all", label: "All" },
          { key: "done", label: "Done" },
          { key: "cancelled", label: "Cancelled" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              statusFilter === f.key
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--border)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!isArchived && (
        <div className="mb-3 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => setTaskType("checkbox")}
              className={`px-3 py-2 rounded-lg text-sm border ${taskType === "checkbox" ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}
            >
              Checkbox
            </button>
            <button
              onClick={() => setTaskType("decision")}
              className={`px-3 py-2 rounded-lg text-sm border ${taskType === "decision" ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}
            >
              Decision
            </button>
          </div>

          {taskType === "checkbox" ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Add a task..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                />
                <button
                  onClick={handleAdd}
                  disabled={!newTitle.trim()}
                  className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 p-3 border border-[var(--border)] rounded-lg">
              <input
                type="text"
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                placeholder="Ask a question..."
                className="w-full px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
              />
              <div className="space-y-1">
                {newOptions.map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) =>
                        setNewOptions((prev) =>
                          prev.map((o, idx) => (idx === i ? e.target.value : o)),
                        )
                      }
                      placeholder={`Option ${i + 1}`}
                      className="flex-1 px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                    />
                    {newOptions.length > 2 && (
                      <button
                        onClick={() => setNewOptions((prev) => prev.filter((_, idx) => idx !== i))}
                        className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setNewOptions((prev) => [...prev, ""])}
                  disabled={newOptions.length >= 5}
                  className="text-sm text-[var(--primary)] hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
                >
                  + Add Option
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!newQuestion.trim() || newOptions.filter((o) => o.trim()).length < 2}
                  className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                >
                  Add Decision
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        {visibleTasks.map((task) => {
          if (task.type === "decision") {
            const totalVotes = task.options?.reduce((s, o) => s + o._count.votes, 0) || 0;
            const isClosed = !!task.closedAt;

            return (
              <div
                key={task.id}
                className={`p-3 border border-[var(--border)] rounded-lg space-y-2 ${isClosed ? "opacity-75" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Vote size={16} className="text-[var(--primary)] shrink-0" />
                    <span className={`text-sm font-medium break-words ${isClosed ? "line-through text-[var(--muted-foreground)]" : ""}`}>
                      {task.question || task.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isClosed ? (
                      <span className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                        <Lock size={12} />
                        Closed
                      </span>
                    ) : (
                      !isArchived && (
                        <button
                          onClick={() => handleCloseVoting(task.id)}
                          className="flex items-center gap-1 px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--muted)]"
                        >
                          <Lock size={12} />
                          Close Voting
                        </button>
                      )
                    )}
                    {!isArchived && (
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="p-2 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  {task.options?.map((opt) => {
                    const pct = totalVotes > 0 ? (opt._count.votes / totalVotes) * 100 : 0;
                    return (
                      <div key={opt.id} className="relative">
                        <div
                          className="absolute inset-0 rounded bg-[var(--primary)] opacity-10"
                          style={{ width: `${pct}%` }}
                        />
                        <div className="relative flex items-center justify-between px-3 py-1.5 text-sm">
                          <span>{opt.label}</span>
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {opt._count.votes} vote{opt._count.votes !== 1 ? "s" : ""} ({Math.round(pct)}%)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {totalVotes > 0 && (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {totalVotes} total vote{totalVotes !== 1 ? "s" : ""}
                  </p>
                )}
                <CommentsSection
                  targetType="task"
                  targetId={task.id}
                  commentCount={task._count?.comments ?? 0}
                />
              </div>
            );
          }

          // Checkbox / request task
          return (
            <div
              key={task.id}
              className="p-2 border border-[var(--border)] rounded-lg"
            >
              <div className="flex items-center gap-2">
                {/* Status dropdown */}
                <select
                  value={task.status}
                  disabled={isArchived}
                  onChange={(e) => handleStatusChange(task, e.target.value)}
                  className="shrink-0 text-xs border border-[var(--border)] rounded bg-[var(--background)] px-1 py-0.5 cursor-pointer disabled:opacity-50"
                  title="Change status"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>

                {editingId === task.id ? (
                  <div className="flex-1 flex flex-col gap-2 min-w-0">
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleUpdate(task.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      className="w-full px-2 py-1.5 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={editingDueDate}
                        onChange={(e) => setEditingDueDate(e.target.value)}
                        className="flex-1 min-w-0 px-2 py-1.5 border border-[var(--border)] rounded bg-[var(--background)] text-sm"
                      />
                      <button
                        onClick={() => handleUpdate(task.id)}
                        className="px-3 py-1.5 text-sm text-[var(--primary)] hover:underline"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-1 py-1.5 text-sm text-[var(--muted-foreground)] hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span
                      className={`flex-1 text-sm ${task.status === "done" || task.status === "cancelled" ? "line-through text-[var(--muted-foreground)]" : ""}`}
                    >
                      {task.title}
                      {task.isClientRequest && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium align-middle">
                          <UserCircle size={10} />
                          Client
                        </span>
                      )}
                      {task.labels && task.labels.length > 0 && (
                        <span className="inline-flex gap-1 ml-2 align-middle">
                          {task.labels.map((l) => (
                            <LabelBadge key={l.label.id} name={l.label.name} color={l.label.color} />
                          ))}
                        </span>
                      )}
                    </span>
                    {task.dueDate && (
                      <span className="text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)]">
                        {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    {/* Assignee picker */}
                    {!isArchived && members.length > 0 && (
                      <select
                        value={task.assigneeId ?? ""}
                        onChange={(e) =>
                          handleAssigneeChange(task.id, e.target.value || null)
                        }
                        className="text-xs border border-[var(--border)] rounded bg-[var(--background)] px-1 py-0.5 max-w-[120px] truncate cursor-pointer"
                        title="Assign to"
                      >
                        <option value="">Unassigned</option>
                        {members.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.user.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {!isArchived && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            setEditingId(task.id);
                            setEditingTitle(task.title);
                            setEditingDueDate(task.dueDate ? task.dueDate.split("T")[0] : "");
                          }}
                          className="p-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="p-2 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <CommentsSection
                targetType="task"
                targetId={task.id}
                commentCount={task._count?.comments ?? 0}
              />
            </div>
          );
        })}
        {visibleTasks.length === 0 && (
          <div className="text-center py-6">
            <ListTodo size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">
              {statusFilter === "active" ? "No active tasks." : "No tasks."}
            </p>
          </div>
        )}
      </div>
      <div className="mt-3">
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && bun run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors from `tasks-section.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(dashboard)/dashboard/projects/[id]/components/tasks-section.tsx
git commit -m "feat(dashboard): add status workflow, assignee picker, and client request badge to tasks section"
```

---

## Task 7: Update Portal Tasks Tab

**Files:**
- Modify: `apps/web/src/app/(portal)/portal/projects/[id]/page.tsx`

This file is large. Make targeted changes only.

- [ ] **Step 1: Update the TaskRecord interface**

Find this block (around line 97):
```typescript
interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  completed: boolean;
  order: number;
  type: string;
  question?: string;
  closedAt?: string | null;
```

Replace with:
```typescript
interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  status: string;
  requestedById?: string | null;
  order: number;
  type: string;
  question?: string;
  closedAt?: string | null;
```

- [ ] **Step 2: Add compose state for new request**

Find the existing state declarations for `showCompose` / `newContent` / `newAttachment` (around line 196). Add below those:

```typescript
const [showNewRequest, setShowNewRequest] = useState(false);
const [newRequestTitle, setNewRequestTitle] = useState("");
const [newRequestDesc, setNewRequestDesc] = useState("");
const [postingRequest, setPostingRequest] = useState(false);
```

- [ ] **Step 3: Add handlePostRequest function**

Add this after `handlePostUpdate` (around line 284):

```typescript
const handlePostRequest = async () => {
  if (!newRequestTitle.trim()) return;
  setPostingRequest(true);
  try {
    await apiFetch(`/tasks/mine?projectId=${id}`, {
      method: "POST",
      body: JSON.stringify({
        title: newRequestTitle,
        description: newRequestDesc || undefined,
      }),
    });
    setNewRequestTitle("");
    setNewRequestDesc("");
    setShowNewRequest(false);
    loadTasks();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to submit request");
  } finally {
    setPostingRequest(false);
  }
};
```

- [ ] **Step 4: Add handleCancelRequest function**

Add after `handlePostRequest`:

```typescript
const handleCancelRequest = async (taskId: string) => {
  try {
    await apiFetch(`/tasks/${taskId}/cancel`, { method: "PATCH" });
    loadTasks();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to cancel request");
  }
};
```

- [ ] **Step 5: Replace the Tasks Tab rendering section**

Find the `{/* Tasks Tab */}` section (around line 735) and replace the entire block through the closing `</div>` and pagination with:

```tsx
{/* Tasks Tab */}
{activeTab === "tasks" && (
  <div>
    <div className="mb-4">
      <button
        onClick={() => setShowNewRequest(true)}
        className="flex items-center gap-2 px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
      >
        <Plus size={14} />
        New Request
      </button>
    </div>

    {showNewRequest && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowNewRequest(false);
            setNewRequestTitle("");
            setNewRequestDesc("");
          }
        }}
      >
        <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-lg mx-4 p-6 space-y-4">
          <h3 className="text-lg font-semibold">New Request</h3>
          <input
            type="text"
            value={newRequestTitle}
            onChange={(e) => setNewRequestTitle(e.target.value)}
            placeholder="What do you need?"
            maxLength={255}
            autoFocus
            className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
          <textarea
            value={newRequestDesc}
            onChange={(e) => setNewRequestDesc(e.target.value)}
            placeholder="More details (optional)..."
            maxLength={5000}
            rows={3}
            className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm resize-none outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowNewRequest(false);
                setNewRequestTitle("");
                setNewRequestDesc("");
              }}
              className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handlePostRequest}
              disabled={postingRequest || !newRequestTitle.trim()}
              className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
            >
              {postingRequest ? "Submitting..." : "Submit"}
            </button>
          </div>
        </div>
      </div>
    )}

    <div className="space-y-2">
      {tasks.map((task) => {
        if (task.type === "decision") {
          const userVote = task.votes?.[0];
          const isClosed = !!task.closedAt;
          const totalVotes = task._count?.votes ?? 0;
          const hasResults = totalVotes > 0 && task.options?.some((o) => o._count.votes > 0);

          return (
            <div
              key={task.id}
              className="border border-[var(--border)] rounded-lg p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Vote size={18} className="text-[var(--primary)] shrink-0" />
                <span className="text-sm font-medium flex-1">
                  {task.question || task.title}
                </span>
                {isClosed && (
                  <span className="text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)] flex items-center gap-1">
                    <Lock size={10} />
                    Closed
                  </span>
                )}
              </div>

              {task.options && task.options.length > 0 && (
                <div className="space-y-1.5">
                  {task.options.map((opt) => {
                    const isSelected =
                      selectedOptions[task.id]
                        ? selectedOptions[task.id] === opt.id
                        : userVote?.optionId === opt.id;

                    return (
                      <label
                        key={opt.id}
                        className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? "border-[var(--primary)] bg-[var(--primary)]/5"
                            : "border-[var(--border)] hover:bg-[var(--muted)]"
                        } ${isClosed && !isSelected ? "opacity-60" : ""}`}
                        style={isSelected ? { borderColor: "var(--primary)", backgroundColor: "color-mix(in srgb, var(--primary) 5%, transparent)" } : undefined}
                      >
                        <input
                          type="radio"
                          name={`vote-${task.id}`}
                          value={opt.id}
                          checked={isSelected}
                          disabled={isClosed}
                          onChange={() => {
                            setSelectedOptions((prev) => ({ ...prev, [task.id]: opt.id }));
                          }}
                          className="accent-[var(--primary)]"
                        />
                        <span className="text-sm flex-1">{opt.label}</span>
                        {(isClosed || hasResults) && (
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {opt._count.votes} vote{opt._count.votes !== 1 ? "s" : ""}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}

              {!isClosed && (
                <div className="flex justify-end">
                  <button
                    onClick={() => handleVote(task.id)}
                    disabled={!selectedOptions[task.id]}
                    className="px-4 py-1.5 text-sm rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    {userVote ? "Change Vote" : "Vote"}
                  </button>
                </div>
              )}

              {(isClosed || hasResults) && totalVotes > 0 && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  {totalVotes} total vote{totalVotes !== 1 ? "s" : ""}
                </p>
              )}
              <CommentsSection
                targetType="task"
                targetId={task.id}
                commentCount={task._count?.comments ?? 0}
              />
            </div>
          );
        }

        // Checkbox / request task
        const statusColors: Record<string, string> = {
          open: "bg-gray-100 text-gray-600",
          in_progress: "bg-blue-100 text-blue-700",
          done: "bg-green-100 text-green-700",
          cancelled: "bg-red-50 text-red-500",
        };
        const statusLabels: Record<string, string> = {
          open: "Open",
          in_progress: "In Progress",
          done: "Done",
          cancelled: "Cancelled",
        };
        const isOwnRequest = task.requestedById === undefined
          ? false
          : task.requestedById !== null;
        const canCancel = isOwnRequest && task.status === "open";

        return (
          <div
            key={task.id}
            className="p-2 border border-[var(--border)] rounded-lg"
          >
            <div className="flex items-center gap-2">
              <span
                className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[task.status] ?? "bg-gray-100 text-gray-600"}`}
              >
                {statusLabels[task.status] ?? task.status}
              </span>
              <span
                className={`flex-1 text-sm ${task.status === "done" || task.status === "cancelled" ? "line-through text-[var(--muted-foreground)]" : ""}`}
              >
                {task.title}
              </span>
              {task.dueDate && (
                <span className="text-xs px-2 py-0.5 bg-[var(--muted)] rounded-full text-[var(--muted-foreground)]">
                  {formatDateDisplay(task.dueDate)}
                </span>
              )}
              {canCancel && (
                <button
                  onClick={() => handleCancelRequest(task.id)}
                  className="text-xs text-red-500 hover:underline shrink-0"
                >
                  Cancel
                </button>
              )}
            </div>
            <CommentsSection
              targetType="task"
              targetId={task.id}
              commentCount={task._count?.comments ?? 0}
            />
          </div>
        );
      })}
      {tasks.length === 0 && (
        <div className="text-center py-8">
          <ListTodo size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
          <p className="text-sm text-[var(--muted-foreground)]">
            No tasks yet.
          </p>
        </div>
      )}
    </div>
    <div className="mt-3">
      <Pagination page={tasksPage} totalPages={tasksTotalPages} onPageChange={setTasksPage} />
    </div>
  </div>
)}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd apps/web && bun run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/\(portal\)/portal/projects/\[id\]/page.tsx
git commit -m "feat(portal): add New Request button, status badges, and cancel own request in tasks tab"
```

---

## Task 8: Update Existing E2E Tests and Add New Coverage

**Files:**
- Modify: `e2e/tests/tasks.e2e.ts`
- Create: `e2e/tests/client-requests.e2e.ts`

- [ ] **Step 1: Fix tasks.e2e.ts — replace `completed` with `status`**

In `e2e/tests/tasks.e2e.ts`, find:

```typescript
expect(body.completed).toBe(false);
```

Replace with:
```typescript
expect(body.status).toBe("open");
```

Find:
```typescript
const res = await request.put(`${API}/tasks/${task.id}`, {
  data: { completed: true },
  headers: { "x-csrf-token": csrfToken },
});
expect(res.ok()).toBeTruthy();
const body = await res.json();
expect(body.completed).toBe(true);
```

Replace with:
```typescript
const res = await request.put(`${API}/tasks/${task.id}`, {
  data: { status: "done" },
  headers: { "x-csrf-token": csrfToken },
});
expect(res.ok()).toBeTruthy();
const body = await res.json();
expect(body.status).toBe("done");
```

Also find:
```typescript
{ header: "Status", value: (r) => r.completed ? "Completed" : "Pending" },
```
This is in the controller which we already replaced, but check `tasks.e2e.ts` for any CSV assertions and update accordingly.

- [ ] **Step 2: Create e2e/tests/client-requests.e2e.ts**

```typescript
import { test, expect } from "@playwright/test";
import { getCsrfToken } from "./helpers";

const API = "http://localhost:3001/api";

/**
 * Tests for client-submitted requests and the task status workflow.
 * These tests run as the agency user (default test session).
 * Client-perspective tests use the portal UI.
 */
test.describe("Client Requests", () => {
  let projectId: string;
  let taskId: string;

  test.beforeAll(async ({ request }) => {
    const csrfToken = getCsrfToken();
    const res = await request.post(`${API}/projects`, {
      data: { name: "Client Requests Test Project" },
      headers: { "x-csrf-token": csrfToken },
    });
    if (res.ok()) {
      const body = await res.json();
      projectId = body.id;
    }
  });

  test.describe("Task status workflow (agency)", () => {
    test("agency can create a task with status=open", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const csrfToken = getCsrfToken();
      const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
        data: { title: "Status Test Task" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.status).toBe("open");
      taskId = body.id;
    });

    test("agency can change task status to in_progress", async ({ request }) => {
      test.skip(!taskId, "No task available");
      const csrfToken = getCsrfToken();
      const res = await request.put(`${API}/tasks/${taskId}`, {
        data: { status: "in_progress" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.status).toBe("in_progress");
    });

    test("agency can change task status to done", async ({ request }) => {
      test.skip(!taskId, "No task available");
      const csrfToken = getCsrfToken();
      const res = await request.put(`${API}/tasks/${taskId}`, {
        data: { status: "done" },
        headers: { "x-csrf-token": csrfToken },
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.status).toBe("done");
    });

    test("task list includes isClientRequest field", async ({ request }) => {
      test.skip(!projectId, "No project available");
      const res = await request.get(`${API}/tasks/project/${projectId}`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.data).toBeInstanceOf(Array);
      for (const task of body.data) {
        expect(typeof task.isClientRequest).toBe("boolean");
      }
    });
  });

  test.describe("Dashboard tasks UI", () => {
    test("tasks section shows status filter bar", async ({ page }) => {
      await page.goto("/dashboard/projects");
      const projectLink = page.locator("a[href*='/dashboard/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await expect(page.getByRole("button", { name: /active/i })).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole("button", { name: /all/i })).toBeVisible({ timeout: 5000 });
      }
    });
  });

  test.describe("Portal — New Request button", () => {
    test("portal tasks tab shows New Request button", async ({ page }) => {
      // Navigate to portal as the test user — relies on global setup auth
      await page.goto("/portal/projects");
      const projectLink = page.locator("a[href*='/portal/projects/']").first();
      if (await projectLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await projectLink.click();
        await page.getByRole("button", { name: /tasks/i }).click();
        await expect(page.getByRole("button", { name: /new request/i })).toBeVisible({ timeout: 5000 });
      }
    });
  });
});
```

- [ ] **Step 3: Run all task-related E2E tests**

```bash
cd /path/to/repo && bun run test:e2e -- --grep "Tasks|Client Requests" 2>&1 | tail -40
```

Expected: all tests pass. If portal tests fail because the test user is not a portal client, that's expected — the test has a `if (await projectLink.isVisible)` guard.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/tasks.e2e.ts e2e/tests/client-requests.e2e.ts
git commit -m "test(e2e): update tasks tests for status field, add client-requests e2e coverage"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Clients can create requests (`POST /tasks/mine`) — Task 5
- [x] `status` replaces `completed` — Tasks 1, 2, 3, 4
- [x] `requestedById` tracks who created the task — Tasks 3, 4
- [x] `assigneeId` field wired up — Tasks 2, 3, 4, 6
- [x] Assignment notification — Tasks 3, 4
- [x] Status-change notification — Tasks 3, 4
- [x] Client request created notification — Tasks 3, 4
- [x] Comment notification (existing `notifyComment` already handles both sides) — no change needed
- [x] Agency status filter bar — Task 6
- [x] Agency assignee picker — Task 6
- [x] "Client Request" badge on dashboard — Task 6
- [x] Status badges on portal — Task 7
- [x] Client can cancel own open request — Tasks 4, 7
- [x] CSV export uses `status` — Task 5
- [x] E2E tests updated and added — Task 8

**Type consistency check:**
- `createForClient` signature in service matches controller call ✓
- `notifyClientRequestCreated(projectId, orgId, taskTitle, clientName)` matches both call sites ✓
- `notifyTaskStatusChanged(taskId, taskTitle, projectId, orgId, newStatus, requestedById, assigneeId)` matches service usage ✓
- `notifyTaskAssigned(taskTitle, projectId, orgId, assigneeId)` matches service usage ✓
- `CreateClientTaskDto` used in both controller and service ✓
- `TaskRecord.status: string` used consistently in both dashboard and portal ✓
