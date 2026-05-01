# Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add staff time tracking with live timer and manual entry, per-project and per-member rates, billable rollup into invoice line items, and a reports page with CSV export.

**Architecture:** A new `time-entries` NestJS module owns all business logic (start/stop with auto-stop, CRUD with invoiced-locking, report aggregation, "generate invoice from time" transactional flow). Three small schema additions: a new `TimeEntry` model and two `Int?` rate columns on `Member` and `Project`. Web app gains a persistent timer widget in the dashboard layout, a "Time" tab on each project, a `/dashboard/reports/time` page, and a "Generate from time" wizard on the invoices page.

**Tech Stack:** NestJS 11, Prisma, Bun test runner, Next.js 15 + React 19, Tailwind, Playwright. No new dependencies.

---

## File Structure

**Created:**
- `apps/api/src/time-entries/time-entries.module.ts`
- `apps/api/src/time-entries/time-entries.controller.ts`
- `apps/api/src/time-entries/time-entries.service.ts`
- `apps/api/src/time-entries/time-entries.service.spec.ts`
- `apps/api/src/time-entries/time-entries.dto.ts`
- `apps/web/src/components/timer-widget.tsx`
- `apps/web/src/lib/format-duration.ts`
- `apps/web/src/app/(dashboard)/dashboard/projects/[id]/time-tab.tsx`
- `apps/web/src/app/(dashboard)/dashboard/projects/[id]/manual-entry-modal.tsx`
- `apps/web/src/app/(dashboard)/dashboard/reports/page.tsx`
- `apps/web/src/app/(dashboard)/dashboard/reports/time/page.tsx`
- `apps/web/src/app/(dashboard)/dashboard/invoices/generate-from-time-modal.tsx`
- `e2e/tests/time-tracking.e2e.ts`

**Modified:**
- `packages/database/prisma/schema.prisma` (add TimeEntry, Member.hourlyRateCents, Project.hourlyRateCents, User/Organization/Project/Task back-relations)
- `apps/api/src/app.module.ts` (register TimeEntriesModule)
- `apps/api/src/clients/clients.controller.ts` (PUT /clients/:id/rate)
- `apps/api/src/clients/clients.service.ts` (setMemberRate)
- `apps/api/src/clients/clients.service.spec.ts` (test for setMemberRate)
- `apps/api/src/projects/projects.dto.ts` (UpdateProjectDto.hourlyRateCents)
- `apps/api/src/projects/projects.service.ts` (no logic change — DTO passthrough)
- `apps/web/src/app/(dashboard)/layout.tsx` (mount TimerWidget in top bar)
- `apps/web/src/components/sidebar-nav.tsx` (add Reports entry)
- `apps/web/src/app/(dashboard)/dashboard/projects/[id]/page.tsx` (add Time tab)
- `apps/web/src/app/(dashboard)/dashboard/clients/page.tsx` (owner-only inline rate input on team rows)
- `apps/web/src/app/(dashboard)/dashboard/projects/[id]/settings-section.tsx` (project rate field — adapt path if file name differs)
- `apps/web/src/app/(dashboard)/dashboard/invoices/page.tsx` (add "Generate from time" button)

---

## Conventions used throughout

- **Money is cents.** All `hourlyRateCents` and `unitPrice` values are integer cents. UI formats via existing money helpers; tests assert in cents.
- **Time is seconds.** `durationSec` is integer seconds. UI formats via `formatDuration(seconds)`.
- **Tenancy:** every Prisma query filters on `organizationId`. Cross-org returns 404 (consistent with other modules).
- **Roles:** all `/time-entries/*` endpoints declare `@Roles("owner", "admin")`. The global `RolesGuard` returns 403 for `member`.
- **TDD:** every service method gets a `*.spec.ts` test before implementation. Run `bun test` from `apps/api/` after each change.
- **Commits:** one per task, conventional commits format. No `Co-Authored-By` trailers.

---

## Task 1: Schema — TimeEntry model + rate columns

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add TimeEntry model**

Append at the end of `schema.prisma` (or alongside other domain models):

```prisma
model TimeEntry {
  id                String           @id @default(cuid())
  organizationId    String
  organization      Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  projectId         String
  project           Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  taskId            String?
  task              Task?            @relation(fields: [taskId], references: [id], onDelete: SetNull)
  userId            String
  user              User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  description       String?          @db.VarChar(1000)
  startedAt         DateTime
  endedAt           DateTime?
  durationSec       Int?
  billable          Boolean          @default(true)
  hourlyRateCents   Int?
  invoiceLineItemId String?          @unique
  invoiceLineItem   InvoiceLineItem? @relation(fields: [invoiceLineItemId], references: [id], onDelete: SetNull)
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  @@index([organizationId, userId, startedAt])
  @@index([projectId, startedAt])
  @@index([taskId])
  @@map("time_entry")
}
```

- [ ] **Step 2: Add rate columns**

In the `Member` model:

```prisma
hourlyRateCents Int?
```

In the `Project` model:

```prisma
hourlyRateCents Int?
```

- [ ] **Step 3: Add reverse relations**

In `User`, add `timeEntries TimeEntry[]`.
In `Organization`, add `timeEntries TimeEntry[]`.
In `Project`, add `timeEntries TimeEntry[]`.
In `Task`, add `timeEntries TimeEntry[]`.
In `InvoiceLineItem`, add `timeEntry TimeEntry?` (1:1 because each entry maps to exactly one line item via the `@unique` FK).

- [ ] **Step 4: Push schema and regenerate client**

```bash
set -a && source .env && set +a
bun run db:push
bun run db:generate
```

Expected: schema applied; Prisma client regenerated.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat(db): add TimeEntry model and per-member/per-project rate columns"
```

---

## Task 2: Module skeleton + DTOs

**Files:**
- Create: `apps/api/src/time-entries/time-entries.module.ts`
- Create: `apps/api/src/time-entries/time-entries.dto.ts`

- [ ] **Step 1: DTOs**

```ts
// time-entries.dto.ts
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";

export class StartTimerDto {
  @IsString() projectId!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class CreateManualEntryDto {
  @IsString() projectId!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsDateString() startedAt!: string;
  @IsDateString() endedAt!: string;
  @IsOptional() @IsBoolean() billable?: boolean;
}

export class UpdateTimeEntryDto {
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsDateString() startedAt?: string;
  @IsOptional() @IsDateString() endedAt?: string;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsString() taskId?: string | null;
}

export class TimeEntryListQueryDto {
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() billable?: "true" | "false";
  @IsOptional() invoiced?: "true" | "false";
  @IsOptional() @IsInt() @Min(1) page?: number;
  @IsOptional() @IsInt() @Min(1) limit?: number;
}

export class GenerateInvoiceDto {
  @IsString() projectId!: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsBoolean() includeNonBillable?: boolean;
}
```

- [ ] **Step 2: Empty module**

```ts
// time-entries.module.ts
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { TimeEntriesController } from "./time-entries.controller";
import { TimeEntriesService } from "./time-entries.service";

@Module({
  imports: [PrismaModule],
  controllers: [TimeEntriesController],
  providers: [TimeEntriesService],
  exports: [TimeEntriesService],
})
export class TimeEntriesModule {}
```

(Controller + service are added in subsequent tasks; the module won't import cleanly until Task 3 + Task 4 — that's expected and the next task creates them.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/time-entries
git commit -m "feat(api): time-entries module skeleton + DTOs"
```

---

## Task 3: Service — start/stop with auto-stop

**Files:**
- Create: `apps/api/src/time-entries/time-entries.service.ts`
- Create: `apps/api/src/time-entries/time-entries.service.spec.ts`

- [ ] **Step 1: Failing tests for start/stop**

```ts
// time-entries.service.spec.ts
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { TimeEntriesService } from "./time-entries.service";

let service: TimeEntriesService;
let prisma: PrismaService;
let orgId: string;
let userId: string;
let projectId: string;
let memberId: string;

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    providers: [TimeEntriesService, PrismaService],
  }).compile();
  service = mod.get(TimeEntriesService);
  prisma = mod.get(PrismaService);
});

beforeEach(async () => {
  // Clean slate
  await prisma.timeEntry.deleteMany({ where: {} });
  // Reuse fixtures pattern from clients.service.spec.ts: create org, user, project
  const org = await prisma.organization.create({ data: { name: `te-org-${Date.now()}`, slug: `te-${Date.now()}` } });
  orgId = org.id;
  const user = await prisma.user.create({ data: { name: "T", email: `t-${Date.now()}@x.com`, emailVerified: true } });
  userId = user.id;
  const member = await prisma.member.create({ data: { organizationId: orgId, userId, role: "admin", hourlyRateCents: 5000 } });
  memberId = member.id;
  const project = await prisma.project.create({ data: { name: "P", organizationId: orgId, hourlyRateCents: null } });
  projectId = project.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("TimeEntriesService.start/stop", () => {
  it("start creates a running entry", async () => {
    const entry = await service.start(userId, orgId, { projectId });
    expect(entry.endedAt).toBeNull();
    expect(entry.durationSec).toBeNull();
    expect(entry.hourlyRateCents).toBe(5000);
  });

  it("start auto-stops a previous running entry", async () => {
    const first = await service.start(userId, orgId, { projectId });
    const second = await service.start(userId, orgId, { projectId });
    const reloaded = await prisma.timeEntry.findUnique({ where: { id: first.id } });
    expect(reloaded?.endedAt).not.toBeNull();
    expect(reloaded?.durationSec).toBeGreaterThanOrEqual(0);
    expect(second.endedAt).toBeNull();
  });

  it("stop sets endedAt and durationSec", async () => {
    const started = await service.start(userId, orgId, { projectId });
    await new Promise((r) => setTimeout(r, 1100));
    const stopped = await service.stop(userId, orgId);
    expect(stopped.id).toBe(started.id);
    expect(stopped.endedAt).not.toBeNull();
    expect(stopped.durationSec).toBeGreaterThanOrEqual(1);
  });

  it("stop returns 404 when no running entry", async () => {
    await expect(service.stop(userId, orgId)).rejects.toThrow();
  });

  it("project rate overrides member rate at start time", async () => {
    await prisma.project.update({ where: { id: projectId }, data: { hourlyRateCents: 12000 } });
    const entry = await service.start(userId, orgId, { projectId });
    expect(entry.hourlyRateCents).toBe(12000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && bun test src/time-entries
```

Expected: file errors / undefined service.

- [ ] **Step 3: Implement service skeleton + start/stop**

```ts
// time-entries.service.ts
import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  StartTimerDto,
  CreateManualEntryDto,
  UpdateTimeEntryDto,
  TimeEntryListQueryDto,
  GenerateInvoiceDto,
} from "./time-entries.dto";

@Injectable()
export class TimeEntriesService {
  constructor(private prisma: PrismaService) {}

  private async resolveRate(orgId: string, userId: string, projectId: string): Promise<number | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { hourlyRateCents: true },
    });
    if (project?.hourlyRateCents != null) return project.hourlyRateCents;
    const member = await this.prisma.member.findFirst({
      where: { organizationId: orgId, userId },
      select: { hourlyRateCents: true },
    });
    return member?.hourlyRateCents ?? null;
  }

  async start(userId: string, orgId: string, dto: StartTimerDto) {
    const project = await this.prisma.project.findFirst({
      where: { id: dto.projectId, organizationId: orgId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException("Project not found");

    if (dto.taskId) {
      const task = await this.prisma.task.findFirst({
        where: { id: dto.taskId, projectId: dto.projectId },
        select: { id: true },
      });
      if (!task) throw new NotFoundException("Task not found");
    }

    const rate = await this.resolveRate(orgId, userId, dto.projectId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const running = await tx.timeEntry.findFirst({
        where: { userId, organizationId: orgId, endedAt: null },
      });
      if (running) {
        const durationSec = Math.max(0, Math.round((now.getTime() - running.startedAt.getTime()) / 1000));
        await tx.timeEntry.update({
          where: { id: running.id },
          data: { endedAt: now, durationSec },
        });
      }
      return tx.timeEntry.create({
        data: {
          organizationId: orgId,
          projectId: dto.projectId,
          taskId: dto.taskId ?? null,
          userId,
          description: dto.description ?? null,
          startedAt: now,
          hourlyRateCents: rate,
        },
      });
    });
  }

  async stop(userId: string, orgId: string) {
    const running = await this.prisma.timeEntry.findFirst({
      where: { userId, organizationId: orgId, endedAt: null },
    });
    if (!running) throw new NotFoundException("No running timer");
    const now = new Date();
    const durationSec = Math.max(0, Math.round((now.getTime() - running.startedAt.getTime()) / 1000));
    return this.prisma.timeEntry.update({
      where: { id: running.id },
      data: { endedAt: now, durationSec },
    });
  }

  async getRunning(userId: string, orgId: string) {
    return this.prisma.timeEntry.findFirst({
      where: { userId, organizationId: orgId, endedAt: null },
      include: { project: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
    });
  }
}
```

- [ ] **Step 4: Run tests until they pass**

```bash
cd apps/api && bun test src/time-entries
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/time-entries
git commit -m "feat(api): TimeEntriesService start/stop with auto-stop"
```

---

## Task 4: Service — manual create, update, delete (with invoice lock)

**Files:**
- Modify: `apps/api/src/time-entries/time-entries.service.ts`
- Modify: `apps/api/src/time-entries/time-entries.service.spec.ts`

- [ ] **Step 1: Failing tests**

Add to spec:

```ts
describe("TimeEntriesService.create/update/delete", () => {
  it("create computes durationSec from start/end", async () => {
    const start = new Date("2026-05-01T10:00:00Z");
    const end = new Date("2026-05-01T11:30:00Z");
    const entry = await service.create(userId, orgId, {
      projectId,
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      description: "manual",
    });
    expect(entry.durationSec).toBe(5400);
    expect(entry.hourlyRateCents).toBe(5000);
  });

  it("create rejects when end <= start", async () => {
    const start = new Date("2026-05-01T10:00:00Z");
    const end = new Date("2026-05-01T09:00:00Z");
    await expect(
      service.create(userId, orgId, { projectId, startedAt: start.toISOString(), endedAt: end.toISOString() }),
    ).rejects.toThrow();
  });

  it("update on invoiced entry returns 409", async () => {
    const entry = await service.create(userId, orgId, {
      projectId,
      startedAt: new Date(Date.now() - 3600_000).toISOString(),
      endedAt: new Date().toISOString(),
    });
    // Fake an invoice link
    const invoice = await prisma.invoice.create({
      data: { organizationId: orgId, invoiceNumber: "INV-9999", status: "draft", subtotal: 0, total: 0, currency: "usd" },
    });
    const lineItem = await prisma.invoiceLineItem.create({
      data: { invoiceId: invoice.id, description: "x", quantity: 1, unitPrice: 5000 },
    });
    await prisma.timeEntry.update({ where: { id: entry.id }, data: { invoiceLineItemId: lineItem.id } });

    await expect(service.update(entry.id, userId, orgId, { description: "edit" })).rejects.toThrow(/locked/i);
    await expect(service.delete(entry.id, userId, orgId)).rejects.toThrow(/locked/i);
  });

  it("delete unlocked entry succeeds", async () => {
    const entry = await service.create(userId, orgId, {
      projectId,
      startedAt: new Date(Date.now() - 3600_000).toISOString(),
      endedAt: new Date().toISOString(),
    });
    await service.delete(entry.id, userId, orgId);
    const reloaded = await prisma.timeEntry.findUnique({ where: { id: entry.id } });
    expect(reloaded).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && bun test src/time-entries
```

Expected: undefined methods.

- [ ] **Step 3: Implement create/update/delete**

Append to `TimeEntriesService`:

```ts
async create(userId: string, orgId: string, dto: CreateManualEntryDto) {
  const start = new Date(dto.startedAt);
  const end = new Date(dto.endedAt);
  if (end.getTime() <= start.getTime()) {
    throw new BadRequestException("endedAt must be after startedAt");
  }
  const project = await this.prisma.project.findFirst({
    where: { id: dto.projectId, organizationId: orgId },
    select: { id: true },
  });
  if (!project) throw new NotFoundException("Project not found");

  if (dto.taskId) {
    const task = await this.prisma.task.findFirst({
      where: { id: dto.taskId, projectId: dto.projectId },
      select: { id: true },
    });
    if (!task) throw new NotFoundException("Task not found");
  }

  const rate = await this.resolveRate(orgId, userId, dto.projectId);
  const durationSec = Math.round((end.getTime() - start.getTime()) / 1000);

  return this.prisma.timeEntry.create({
    data: {
      organizationId: orgId,
      projectId: dto.projectId,
      taskId: dto.taskId ?? null,
      userId,
      description: dto.description ?? null,
      startedAt: start,
      endedAt: end,
      durationSec,
      billable: dto.billable ?? true,
      hourlyRateCents: rate,
    },
  });
}

private async findOwnEntryOrThrow(id: string, userId: string, orgId: string) {
  const entry = await this.prisma.timeEntry.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!entry) throw new NotFoundException("Time entry not found");
  if (entry.userId !== userId) {
    throw new ForbiddenException("You can only edit your own time entries");
  }
  if (entry.invoiceLineItemId) {
    throw new ConflictException("Time entry is locked because it has been invoiced");
  }
  return entry;
}

async update(id: string, userId: string, orgId: string, dto: UpdateTimeEntryDto) {
  const entry = await this.findOwnEntryOrThrow(id, userId, orgId);

  const start = dto.startedAt ? new Date(dto.startedAt) : entry.startedAt;
  const end = dto.endedAt ? new Date(dto.endedAt) : entry.endedAt;
  if (end && end.getTime() <= start.getTime()) {
    throw new BadRequestException("endedAt must be after startedAt");
  }
  const durationSec = end ? Math.round((end.getTime() - start.getTime()) / 1000) : entry.durationSec;

  return this.prisma.timeEntry.update({
    where: { id },
    data: {
      description: dto.description ?? entry.description,
      startedAt: start,
      endedAt: end,
      durationSec,
      billable: dto.billable ?? entry.billable,
      taskId: dto.taskId === undefined ? entry.taskId : dto.taskId,
    },
  });
}

async delete(id: string, userId: string, orgId: string) {
  await this.findOwnEntryOrThrow(id, userId, orgId);
  await this.prisma.timeEntry.delete({ where: { id } });
}
```

- [ ] **Step 4: Tests pass**

```bash
cd apps/api && bun test src/time-entries
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/time-entries
git commit -m "feat(api): manual time entry create/update/delete with invoice lock"
```

---

## Task 5: Service — list, report, generate-invoice

**Files:**
- Modify: `apps/api/src/time-entries/time-entries.service.ts`
- Modify: `apps/api/src/time-entries/time-entries.service.spec.ts`

- [ ] **Step 1: Failing tests**

Add to spec:

```ts
describe("TimeEntriesService.list/report/generateInvoice", () => {
  it("list filters by projectId and date range", async () => {
    const e1 = await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T09:00:00Z",
      endedAt: "2026-04-01T10:00:00Z",
    });
    const otherProject = await prisma.project.create({ data: { name: "P2", organizationId: orgId } });
    await service.create(userId, orgId, {
      projectId: otherProject.id,
      startedAt: "2026-04-01T11:00:00Z",
      endedAt: "2026-04-01T12:00:00Z",
    });
    const res = await service.list(orgId, { projectId });
    expect(res.data.length).toBe(1);
    expect(res.data[0].id).toBe(e1.id);
  });

  it("report aggregates billable seconds and value cents", async () => {
    await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T09:00:00Z",
      endedAt: "2026-04-01T10:00:00Z",
      billable: true,
    });
    await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T10:00:00Z",
      endedAt: "2026-04-01T10:30:00Z",
      billable: false,
    });
    const r = await service.report(orgId, {});
    expect(r.totals.seconds).toBe(5400);
    expect(r.totals.billableSeconds).toBe(3600);
    expect(r.totals.valueCents).toBe(5000); // 1h * $50
  });

  it("generateInvoice creates draft, snapshots rate, marks entries", async () => {
    const e1 = await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T09:00:00Z",
      endedAt: "2026-04-01T10:00:00Z",
    });
    const e2 = await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-02T09:00:00Z",
      endedAt: "2026-04-02T09:30:00Z",
    });
    const { invoiceId } = await service.generateInvoice(userId, orgId, { projectId });
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true },
    });
    expect(invoice?.status).toBe("draft");
    expect(invoice?.lineItems.length).toBe(2);
    const total = invoice!.lineItems.reduce((s, li) => s + li.unitPrice * li.quantity, 0);
    expect(total).toBe(5000 + 2500);
    const reloaded = await prisma.timeEntry.findMany({ where: { id: { in: [e1.id, e2.id] } } });
    expect(reloaded.every((e) => e.invoiceLineItemId !== null)).toBe(true);
  });

  it("generateInvoice rejects when no eligible entries", async () => {
    await expect(service.generateInvoice(userId, orgId, { projectId })).rejects.toThrow();
  });

  it("generateInvoice skips already-invoiced entries", async () => {
    await service.create(userId, orgId, {
      projectId,
      startedAt: "2026-04-01T09:00:00Z",
      endedAt: "2026-04-01T10:00:00Z",
    });
    await service.generateInvoice(userId, orgId, { projectId });
    await expect(service.generateInvoice(userId, orgId, { projectId })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implement list/report/generateInvoice**

Append to `TimeEntriesService`:

```ts
async list(orgId: string, query: TimeEntryListQueryDto) {
  const page = query.page ?? 1;
  const limit = Math.min(query.limit ?? 50, 200);
  const where: Record<string, unknown> = { organizationId: orgId };
  if (query.projectId) where.projectId = query.projectId;
  if (query.userId) where.userId = query.userId;
  if (query.from || query.to) {
    where.startedAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }
  if (query.billable === "true") where.billable = true;
  if (query.billable === "false") where.billable = false;
  if (query.invoiced === "true") where.NOT = { invoiceLineItemId: null };
  if (query.invoiced === "false") where.invoiceLineItemId = null;

  const [data, total] = await Promise.all([
    this.prisma.timeEntry.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    this.prisma.timeEntry.count({ where }),
  ]);
  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}

async report(orgId: string, query: TimeEntryListQueryDto) {
  const where: Record<string, unknown> = { organizationId: orgId };
  if (query.projectId) where.projectId = query.projectId;
  if (query.userId) where.userId = query.userId;
  if (query.from || query.to) {
    where.startedAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }

  const entries = await this.prisma.timeEntry.findMany({
    where: { ...where, NOT: { durationSec: null } },
    include: {
      project: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  });

  const totals = { seconds: 0, billableSeconds: 0, valueCents: 0 };
  const byProjectMap = new Map<string, { projectId: string; projectName: string; seconds: number; billableSeconds: number; valueCents: number }>();
  const byUserMap = new Map<string, { userId: string; name: string; seconds: number; billableSeconds: number; valueCents: number }>();

  for (const e of entries) {
    const sec = e.durationSec ?? 0;
    totals.seconds += sec;
    if (e.billable) {
      totals.billableSeconds += sec;
      const value = Math.round((sec / 3600) * (e.hourlyRateCents ?? 0));
      totals.valueCents += value;

      const p = byProjectMap.get(e.projectId) ?? { projectId: e.projectId, projectName: e.project.name, seconds: 0, billableSeconds: 0, valueCents: 0 };
      p.seconds += sec; p.billableSeconds += sec; p.valueCents += value;
      byProjectMap.set(e.projectId, p);

      const u = byUserMap.get(e.userId) ?? { userId: e.userId, name: e.user.name, seconds: 0, billableSeconds: 0, valueCents: 0 };
      u.seconds += sec; u.billableSeconds += sec; u.valueCents += value;
      byUserMap.set(e.userId, u);
    } else {
      const p = byProjectMap.get(e.projectId) ?? { projectId: e.projectId, projectName: e.project.name, seconds: 0, billableSeconds: 0, valueCents: 0 };
      p.seconds += sec;
      byProjectMap.set(e.projectId, p);
      const u = byUserMap.get(e.userId) ?? { userId: e.userId, name: e.user.name, seconds: 0, billableSeconds: 0, valueCents: 0 };
      u.seconds += sec;
      byUserMap.set(e.userId, u);
    }
  }

  return {
    totals,
    byProject: Array.from(byProjectMap.values()).sort((a, b) => b.seconds - a.seconds),
    byUser: Array.from(byUserMap.values()).sort((a, b) => b.seconds - a.seconds),
  };
}

async generateInvoice(userId: string, orgId: string, dto: GenerateInvoiceDto) {
  const project = await this.prisma.project.findFirst({
    where: { id: dto.projectId, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!project) throw new NotFoundException("Project not found");

  const where: Record<string, unknown> = {
    organizationId: orgId,
    projectId: dto.projectId,
    invoiceLineItemId: null,
    NOT: { endedAt: null },
  };
  if (!dto.includeNonBillable) where.billable = true;
  if (dto.from || dto.to) {
    where.startedAt = {
      ...(dto.from ? { gte: new Date(dto.from) } : {}),
      ...(dto.to ? { lte: new Date(dto.to) } : {}),
    };
  }

  const entries = await this.prisma.timeEntry.findMany({
    where,
    include: { task: { select: { title: true } } },
    orderBy: { startedAt: "asc" },
  });
  if (entries.length === 0) {
    throw new BadRequestException("No eligible time entries to invoice");
  }

  return this.prisma.$transaction(async (tx) => {
    const last = await tx.invoice.findFirst({
      where: { organizationId: orgId },
      orderBy: { invoiceNumber: "desc" },
      select: { invoiceNumber: true },
    });
    let next = 1;
    if (last) {
      const m = last.invoiceNumber.match(/INV-(\d+)/);
      if (m) next = parseInt(m[1], 10) + 1;
    }
    const invoiceNumber = `INV-${String(next).padStart(4, "0")}`;

    const lineItemsData = entries.map((e) => {
      const hours = (e.durationSec ?? 0) / 3600;
      const total = Math.round(hours * (e.hourlyRateCents ?? 0));
      const dateStr = e.startedAt.toISOString().slice(0, 10);
      const label = e.description ?? e.task?.title ?? "Time entry";
      const rateStr = ((e.hourlyRateCents ?? 0) / 100).toFixed(2);
      const hoursStr = hours.toFixed(2);
      return {
        description: `${label} — ${dateStr} (${hoursStr}h @ $${rateStr}/hr)`,
        quantity: 1,
        unitPrice: total,
      };
    });

    const subtotal = lineItemsData.reduce((s, li) => s + li.unitPrice, 0);

    const invoice = await tx.invoice.create({
      data: {
        organizationId: orgId,
        projectId: dto.projectId,
        invoiceNumber,
        status: "draft",
        subtotal,
        total: subtotal,
        currency: "usd",
        lineItems: { create: lineItemsData },
      },
      include: { lineItems: true },
    });

    // Link entries 1:1 to line items by index (insertion order matches `entries`).
    for (let i = 0; i < entries.length; i++) {
      await tx.timeEntry.update({
        where: { id: entries[i].id },
        data: { invoiceLineItemId: invoice.lineItems[i].id },
      });
    }

    return { invoiceId: invoice.id };
  });
}
```

- [ ] **Step 3: Tests pass**

```bash
cd apps/api && bun test src/time-entries
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/time-entries
git commit -m "feat(api): time entries list, report aggregation, and generate-invoice"
```

---

## Task 6: Controller + module registration

**Files:**
- Create: `apps/api/src/time-entries/time-entries.controller.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Implement controller**

```ts
import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import {
  AuthGuard, RolesGuard, Roles, CurrentOrg, CurrentUser, contentDisposition, toCsv,
} from "../common";
import type { CsvColumn } from "../common";
import { TimeEntriesService } from "./time-entries.service";
import {
  StartTimerDto, CreateManualEntryDto, UpdateTimeEntryDto, TimeEntryListQueryDto, GenerateInvoiceDto,
} from "./time-entries.dto";

@Controller("time-entries")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class TimeEntriesController {
  constructor(private service: TimeEntriesService) {}

  @Get()
  list(@CurrentOrg("id") orgId: string, @Query() q: TimeEntryListQueryDto) {
    return this.service.list(orgId, q);
  }

  @Get("running")
  running(@CurrentUser("id") userId: string, @CurrentOrg("id") orgId: string) {
    return this.service.getRunning(userId, orgId);
  }

  @Get("report")
  report(@CurrentOrg("id") orgId: string, @Query() q: TimeEntryListQueryDto) {
    return this.service.report(orgId, q);
  }

  @Get("report/export")
  async exportCsv(
    @CurrentOrg("id") orgId: string,
    @Query() q: TimeEntryListQueryDto,
    @Res() res: Response,
  ) {
    const list = await this.service.list(orgId, { ...q, page: 1, limit: 10000 });
    type Row = { date: string; user: string; project: string; task: string; description: string; hours: string; billable: string; invoiced: string };
    const rows: Row[] = list.data.map((e) => ({
      date: e.startedAt.toISOString().slice(0, 10),
      user: e.user.name,
      project: e.project.name,
      task: e.task?.title ?? "",
      description: e.description ?? "",
      hours: ((e.durationSec ?? 0) / 3600).toFixed(2),
      billable: e.billable ? "yes" : "no",
      invoiced: e.invoiceLineItemId ? "yes" : "no",
    }));
    const cols: CsvColumn<Row>[] = [
      { header: "Date", value: (r) => r.date },
      { header: "User", value: (r) => r.user },
      { header: "Project", value: (r) => r.project },
      { header: "Task", value: (r) => r.task },
      { header: "Description", value: (r) => r.description },
      { header: "Hours", value: (r) => r.hours },
      { header: "Billable", value: (r) => r.billable },
      { header: "Invoiced", value: (r) => r.invoiced },
    ];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", contentDisposition("time-entries.csv"));
    res.send(toCsv(cols, rows));
  }

  @Post("start")
  start(@CurrentUser("id") userId: string, @CurrentOrg("id") orgId: string, @Body() dto: StartTimerDto) {
    return this.service.start(userId, orgId, dto);
  }

  @Post("stop")
  stop(@CurrentUser("id") userId: string, @CurrentOrg("id") orgId: string) {
    return this.service.stop(userId, orgId);
  }

  @Post()
  create(@CurrentUser("id") userId: string, @CurrentOrg("id") orgId: string, @Body() dto: CreateManualEntryDto) {
    return this.service.create(userId, orgId, dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @CurrentUser("id") userId: string, @CurrentOrg("id") orgId: string, @Body() dto: UpdateTimeEntryDto) {
    return this.service.update(id, userId, orgId, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser("id") userId: string, @CurrentOrg("id") orgId: string) {
    return this.service.delete(id, userId, orgId);
  }

  @Post("generate-invoice")
  generateInvoice(@CurrentUser("id") userId: string, @CurrentOrg("id") orgId: string, @Body() dto: GenerateInvoiceDto) {
    return this.service.generateInvoice(userId, orgId, dto);
  }
}
```

- [ ] **Step 2: Register in app.module.ts**

Add `TimeEntriesModule` to the `imports` array:

```ts
import { TimeEntriesModule } from "./time-entries/time-entries.module";
// ... in imports: TimeEntriesModule,
```

- [ ] **Step 3: Verify**

```bash
cd apps/api && bun test && bunx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/time-entries apps/api/src/app.module.ts
git commit -m "feat(api): time-entries controller and module registration"
```

---

## Task 7: Member rate endpoint + Project rate field

**Files:**
- Modify: `apps/api/src/clients/clients.controller.ts`
- Modify: `apps/api/src/clients/clients.service.ts`
- Modify: `apps/api/src/clients/clients.dto.ts`
- Modify: `apps/api/src/clients/clients.service.spec.ts`
- Modify: `apps/api/src/projects/projects.dto.ts`

- [ ] **Step 1: Add DTO**

In `clients.dto.ts`:

```ts
export class SetRateDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  hourlyRateCents?: number | null;
}
```

- [ ] **Step 2: Failing test for setMemberRate**

In `clients.service.spec.ts`:

```ts
it("setMemberRate updates member.hourlyRateCents (owner only)", async () => {
  // assume setup creates an org + an owner + an admin member
  await service.setMemberRate(adminMemberId, orgId, ownerUserId, "owner", 7500);
  const m = await prisma.member.findUnique({ where: { id: adminMemberId } });
  expect(m?.hourlyRateCents).toBe(7500);
});

it("setMemberRate rejects non-owner", async () => {
  await expect(
    service.setMemberRate(adminMemberId, orgId, otherAdminUserId, "admin", 7500),
  ).rejects.toThrow();
});
```

- [ ] **Step 3: Implement**

In `clients.service.ts`:

```ts
async setMemberRate(memberId: string, orgId: string, actorUserId: string, actorRole: string, rate: number | null) {
  if (actorRole !== "owner") {
    throw new ForbiddenException("Only owners can set member rates");
  }
  const member = await this.prisma.member.findFirst({ where: { id: memberId, organizationId: orgId } });
  if (!member) throw new NotFoundException("Member not found");
  return this.prisma.member.update({
    where: { id: memberId },
    data: { hourlyRateCents: rate },
  });
}
```

In `clients.controller.ts`:

```ts
@Put(":id/rate")
@Roles("owner")
async setRate(
  @Param("id") memberId: string,
  @CurrentOrg("id") orgId: string,
  @CurrentUser("id") userId: string,
  @CurrentMember("role") role: string,
  @Body() dto: SetRateDto,
) {
  return this.clientsService.setMemberRate(memberId, orgId, userId, role, dto.hourlyRateCents ?? null);
}
```

Import `SetRateDto` at the top.

- [ ] **Step 4: Project DTO**

In `projects.dto.ts` `UpdateProjectDto` (or create one if missing — adapt to existing patterns):

```ts
@IsOptional()
@IsInt()
@Min(0)
hourlyRateCents?: number | null;
```

The existing `ProjectsService.update` typically does a passthrough — verify it spreads the DTO into `data`. If not, add `if (dto.hourlyRateCents !== undefined) data.hourlyRateCents = dto.hourlyRateCents;`.

- [ ] **Step 5: Verify**

```bash
cd apps/api && bun test src/clients src/projects && bunx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/clients apps/api/src/projects
git commit -m "feat(api): per-member and per-project hourly rate endpoints"
```

---

## Task 8: Web — duration formatter + timer widget

**Files:**
- Create: `apps/web/src/lib/format-duration.ts`
- Create: `apps/web/src/components/timer-widget.tsx`
- Modify: `apps/web/src/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Duration formatter**

```ts
// format-duration.ts
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(2);
}
```

- [ ] **Step 2: TimerWidget component**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { formatDuration } from "@/lib/format-duration";
import { Play, Square, Clock } from "lucide-react";
import { useToast } from "@/components/toast";
import Link from "next/link";

interface RunningEntry {
  id: string;
  startedAt: string;
  description: string | null;
  project: { id: string; name: string };
  task: { id: string; title: string } | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

export function TimerWidget() {
  const { success, error: showError } = useToast();
  const [running, setRunning] = useState<RunningEntry | null>(null);
  const [tick, setTick] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch<RunningEntry | null>("/time-entries/running");
      setRunning(r);
    } catch {
      setRunning(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!pickerOpen) return;
    apiFetch<{ data: ProjectOption[] } | ProjectOption[]>("/projects?limit=100")
      .then((res) => {
        const list = Array.isArray(res) ? res : res.data;
        setProjects(list);
        if (list[0]) setProjectId(list[0].id);
      })
      .catch(console.error);
  }, [pickerOpen]);

  const elapsed = running
    ? Math.floor((Date.now() - new Date(running.startedAt).getTime()) / 1000) + (tick - tick)
    : 0;

  async function start() {
    if (!projectId) return;
    try {
      await apiFetch("/time-entries/start", {
        method: "POST",
        body: JSON.stringify({ projectId, description: description || undefined }),
      });
      success("Timer started");
      setPickerOpen(false);
      setDescription("");
      refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to start timer");
    }
  }

  async function stop() {
    try {
      await apiFetch("/time-entries/stop", { method: "POST" });
      success("Timer stopped");
      refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to stop timer");
    }
  }

  if (running) {
    return (
      <div className="flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5">
        <Link href={`/dashboard/projects/${running.project.id}?tab=time`} className="flex items-center gap-2 text-sm">
          <Clock size={14} className="text-emerald-700" />
          <span className="font-medium text-emerald-900 truncate max-w-[140px]">{running.project.name}</span>
          <span className="font-mono text-emerald-800">{formatDuration(elapsed)}</span>
        </Link>
        <button onClick={stop} className="text-emerald-700 hover:text-emerald-900" title="Stop timer">
          <Square size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setPickerOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
      >
        <Play size={14} />
        Start timer
      </button>
      {pickerOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-lg p-3 z-50 space-y-2">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="What are you working on? (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setPickerOpen(false)} className="px-3 py-1.5 text-sm text-[var(--muted-foreground)]">Cancel</button>
            <button onClick={start} disabled={!projectId} className="rounded bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">Start</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount in dashboard layout**

Find the top bar in `apps/web/src/app/(dashboard)/layout.tsx`. Import and place `<TimerWidget />` next to existing top-bar items, gated to non-member roles. The simplest approach: render it unconditionally — the widget itself handles 403s by showing nothing.

```tsx
import { TimerWidget } from "@/components/timer-widget";
// ...
<TimerWidget />
```

If 403 spam in console is a concern, gate via a session-role hook similar to `clients/page.tsx`:

```tsx
const [role, setRole] = useState("");
useEffect(() => { apiFetch<{ role: string }>("/auth/organization/get-active-member").then((m) => setRole(m.role)).catch(() => {}); }, []);
{(role === "owner" || role === "admin") && <TimerWidget />}
```

- [ ] **Step 4: Verify**

```bash
cd apps/web && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/format-duration.ts apps/web/src/components/timer-widget.tsx apps/web/src/app/\(dashboard\)/layout.tsx
git commit -m "feat(web): persistent timer widget in dashboard top bar"
```

---

## Task 9: Web — Project page Time tab

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/projects/[id]/time-tab.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/projects/[id]/manual-entry-modal.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/projects/[id]/page.tsx`

- [ ] **Step 1: Read the existing project page**

```bash
grep -n "tab\|Tabs\|activeTab" apps/web/src/app/\(dashboard\)/dashboard/projects/\[id\]/page.tsx | head -20
```

Identify the existing tab pattern (looks similar to `clients/page.tsx`). Add a "Time" tab id and render `<TimeTab projectId={...} />` when active.

- [ ] **Step 2: TimeTab component**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { formatDuration, formatHours } from "@/lib/format-duration";
import { Play, Plus, Trash2, Lock } from "lucide-react";
import { ManualEntryModal } from "./manual-entry-modal";

interface Entry {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  description: string | null;
  billable: boolean;
  invoiceLineItemId: string | null;
  user: { name: string };
  task: { id: string; title: string } | null;
}

export function TimeTab({ projectId }: { projectId: string }) {
  const { success, error: showError } = useToast();
  const confirm = useConfirm();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ data: Entry[] }>(`/time-entries?projectId=${projectId}&limit=200`);
      setEntries(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function startTimer() {
    try {
      await apiFetch("/time-entries/start", { method: "POST", body: JSON.stringify({ projectId }) });
      success("Timer started");
      load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to start");
    }
  }

  async function deleteEntry(id: string) {
    const ok = await confirm({ title: "Delete time entry?", message: "This cannot be undone.", confirmLabel: "Delete", variant: "danger" });
    if (!ok) return;
    try {
      await apiFetch(`/time-entries/${id}`, { method: "DELETE" });
      success("Entry deleted");
      load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  const totals = entries.reduce(
    (acc, e) => {
      const sec = e.durationSec ?? 0;
      acc.total += sec;
      if (e.billable) acc.billable += sec;
      return acc;
    },
    { total: 0, billable: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm">
          <div><span className="text-[var(--muted-foreground)]">Total:</span> <span className="font-medium">{formatHours(totals.total)}h</span></div>
          <div><span className="text-[var(--muted-foreground)]">Billable:</span> <span className="font-medium text-emerald-700">{formatHours(totals.billable)}h</span></div>
        </div>
        <div className="flex gap-2">
          <button onClick={startTimer} className="flex items-center gap-1 rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]">
            <Play size={14} /> Start timer
          </button>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-1 rounded bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            <Plus size={14} /> Add entry
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-sm text-[var(--muted-foreground)] text-center py-8">No time logged on this project yet.</div>
      ) : (
        <div className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between p-3 text-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono">{e.durationSec ? formatDuration(e.durationSec) : "running"}</span>
                  {e.billable && <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">billable</span>}
                  {e.invoiceLineItemId && <Lock size={12} className="text-[var(--muted-foreground)]" aria-label="Invoiced (locked)" />}
                </div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  {new Date(e.startedAt).toLocaleString()} · {e.user.name}
                  {e.task && ` · ${e.task.title}`}
                  {e.description && ` · ${e.description}`}
                </div>
              </div>
              {!e.invoiceLineItemId && (
                <button onClick={() => deleteEntry(e.id)} className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500" title="Delete">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && <ManualEntryModal projectId={projectId} onClose={() => setModalOpen(false)} onCreated={() => { setModalOpen(false); load(); }} />}
    </div>
  );
}
```

- [ ] **Step 3: ManualEntryModal**

```tsx
"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { X } from "lucide-react";

export function ManualEntryModal({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: () => void }) {
  const { error: showError } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [description, setDescription] = useState("");
  const [billable, setBillable] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const startedAt = new Date(`${date}T${start}:00`).toISOString();
      const endedAt = new Date(`${date}T${end}:00`).toISOString();
      await apiFetch("/time-entries", {
        method: "POST",
        body: JSON.stringify({ projectId, startedAt, endedAt, description: description || undefined, billable }),
      });
      onCreated();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to create entry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold">Add time entry</h3>
          <button type="button" onClick={onClose} className="p-1 text-[var(--muted-foreground)]"><X size={18} /></button>
        </div>
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">Start</label>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">End</label>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">Description</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What did you work on?" className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
          Billable
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-[var(--muted-foreground)]">Cancel</button>
          <button type="submit" disabled={busy} className="rounded bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Add Time tab to project page**

In `apps/web/src/app/(dashboard)/dashboard/projects/[id]/page.tsx`:

1. Find the existing tabs array. Append a `time` tab.
2. Add a render branch that returns `<TimeTab projectId={params.id} />`.
3. Import the component at the top.

If the tabs are in a separate component file, modify that file instead.

- [ ] **Step 5: Verify**

```bash
cd apps/web && bunx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/projects/\[id\]/
git commit -m "feat(web): project page Time tab with timer + manual entry"
```

---

## Task 10: Web — Reports page

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/reports/page.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/reports/time/page.tsx`
- Modify: `apps/web/src/components/sidebar-nav.tsx`

- [ ] **Step 1: Reports index**

```tsx
// reports/page.tsx
import Link from "next/link";

export default function ReportsIndex() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reports</h1>
      <ul className="space-y-2">
        <li>
          <Link href="/dashboard/reports/time" className="text-[var(--primary)] hover:underline">
            Time report →
          </Link>
        </li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Time report page**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { downloadCsv } from "@/lib/download";
import { formatHours } from "@/lib/format-duration";
import { Download } from "lucide-react";

interface ReportRow { projectId?: string; projectName?: string; userId?: string; name?: string; seconds: number; billableSeconds: number; valueCents: number }
interface Report {
  totals: { seconds: number; billableSeconds: number; valueCents: number };
  byProject: ReportRow[];
  byUser: ReportRow[];
}
interface Project { id: string; name: string }

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function TimeReportPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    apiFetch<{ data: Project[] } | Project[]>("/projects?limit=200")
      .then((res) => setProjects(Array.isArray(res) ? res : res.data))
      .catch(console.error);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const r = await apiFetch<Report>(`/time-entries/report?${params.toString()}`);
      setReport(r);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, from, to]);

  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    downloadCsv(`/time-entries/report/export?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-bold">Time report</h1>
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg text-sm">
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm" />
      </div>

      {loading || !report ? (
        <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="border border-[var(--border)] rounded-lg p-4">
              <div className="text-xs text-[var(--muted-foreground)]">Total hours</div>
              <div className="text-2xl font-semibold">{formatHours(report.totals.seconds)}</div>
            </div>
            <div className="border border-[var(--border)] rounded-lg p-4">
              <div className="text-xs text-[var(--muted-foreground)]">Billable hours</div>
              <div className="text-2xl font-semibold text-emerald-700">{formatHours(report.totals.billableSeconds)}</div>
            </div>
            <div className="border border-[var(--border)] rounded-lg p-4">
              <div className="text-xs text-[var(--muted-foreground)]">Total value</div>
              <div className="text-2xl font-semibold">{fmtMoney(report.totals.valueCents)}</div>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-medium mb-2">By project</h2>
            <table className="w-full border border-[var(--border)] rounded-lg text-sm">
              <thead><tr className="text-left text-xs text-[var(--muted-foreground)]"><th className="p-2">Project</th><th className="p-2">Hours</th><th className="p-2">Billable</th><th className="p-2">Value</th></tr></thead>
              <tbody>
                {report.byProject.map((r) => (
                  <tr key={r.projectId} className="border-t border-[var(--border)]">
                    <td className="p-2">{r.projectName}</td>
                    <td className="p-2">{formatHours(r.seconds)}</td>
                    <td className="p-2">{formatHours(r.billableSeconds)}</td>
                    <td className="p-2">{fmtMoney(r.valueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="text-sm font-medium mb-2">By user</h2>
            <table className="w-full border border-[var(--border)] rounded-lg text-sm">
              <thead><tr className="text-left text-xs text-[var(--muted-foreground)]"><th className="p-2">User</th><th className="p-2">Hours</th><th className="p-2">Billable</th><th className="p-2">Value</th></tr></thead>
              <tbody>
                {report.byUser.map((r) => (
                  <tr key={r.userId} className="border-t border-[var(--border)]">
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{formatHours(r.seconds)}</td>
                    <td className="p-2">{formatHours(r.billableSeconds)}</td>
                    <td className="p-2">{fmtMoney(r.valueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Sidebar entry**

In `sidebar-nav.tsx`, add (with the `BarChart3` icon from lucide-react):

```tsx
{ href: "/dashboard/reports", label: "Reports", icon: BarChart3 },
```

- [ ] **Step 4: Verify + commit**

```bash
cd apps/web && bunx tsc --noEmit
git add apps/web/src/app/\(dashboard\)/dashboard/reports apps/web/src/components/sidebar-nav.tsx
git commit -m "feat(web): time report page with filters and CSV export"
```

---

## Task 11: Web — Generate-from-time wizard on invoices page

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/invoices/generate-from-time-modal.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/invoices/page.tsx`

- [ ] **Step 1: Modal component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

interface Project { id: string; name: string }

export function GenerateFromTimeModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { success, error: showError } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeNonBillable, setIncludeNonBillable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ data: Project[] } | Project[]>("/projects?limit=200")
      .then((res) => {
        const list = Array.isArray(res) ? res : res.data;
        setProjects(list);
        if (list[0]) setProjectId(list[0].id);
      })
      .catch(console.error);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { projectId, from: from || undefined, to: to || undefined, includeNonBillable };
      const res = await apiFetch<{ invoiceId: string }>("/time-entries/generate-invoice", {
        method: "POST",
        body: JSON.stringify(body),
      });
      success("Draft invoice created");
      router.push(`/dashboard/invoices/${res.invoiceId}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to generate invoice");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold">Generate invoice from time</h3>
          <button type="button" onClick={onClose} className="p-1"><X size={18} /></button>
        </div>
        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-1">Project</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} required className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted-foreground)] mb-1">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeNonBillable} onChange={(e) => setIncludeNonBillable(e.target.checked)} />
          Include non-billable entries
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-[var(--muted-foreground)]">Cancel</button>
          <button type="submit" disabled={busy || !projectId} className="rounded bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{busy ? "Generating…" : "Generate draft"}</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Add button on invoices page**

In `apps/web/src/app/(dashboard)/dashboard/invoices/page.tsx`, find the "New invoice" button and add a sibling "Generate from time" button that toggles the modal.

```tsx
import { GenerateFromTimeModal } from "./generate-from-time-modal";
// ...
const [genOpen, setGenOpen] = useState(false);
// ...
<button onClick={() => setGenOpen(true)} className="...">Generate from time</button>
{genOpen && <GenerateFromTimeModal onClose={() => setGenOpen(false)} />}
```

- [ ] **Step 3: Verify + commit**

```bash
cd apps/web && bunx tsc --noEmit
git add apps/web/src/app/\(dashboard\)/dashboard/invoices/
git commit -m "feat(web): generate-from-time wizard on invoices page"
```

---

## Task 12: Web — Default rate fields (team page + project settings)

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/clients/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/projects/[id]/page.tsx` (or its settings sub-component)

- [ ] **Step 1: Team rate input**

In `clients/page.tsx`, add `hourlyRateCents` to `MemberRecord.user` (it's actually on `Member`, not `user`). Update the API request to include it: the `/clients` endpoint already returns `Member`-level fields.

If not already returned, modify `apps/api/src/clients/clients.controller.ts` `@Get()` to add `hourlyRateCents: true` to the top-level select alongside `id, userId, role, createdAt`. (The current select includes those — just add the rate field.)

Owner-only inline editor on each team row (next to role, hidden on `isSelf` if you want, or always shown for non-clients):

```tsx
{isOwner && (
  <input
    type="number"
    min={0}
    step={1}
    placeholder="Rate $/hr"
    defaultValue={member.hourlyRateCents != null ? (member.hourlyRateCents / 100).toString() : ""}
    onBlur={async (e) => {
      const dollars = e.target.value === "" ? null : Number(e.target.value);
      const cents = dollars == null ? null : Math.round(dollars * 100);
      try {
        await apiFetch(`/clients/${member.id}/rate`, { method: "PUT", body: JSON.stringify({ hourlyRateCents: cents }) });
        success(`Rate updated`);
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed");
      }
    }}
    className="w-24 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
  />
)}
```

- [ ] **Step 2: Project rate field**

Find the project settings UI (likely a section in the project page or a dedicated settings tab). Add an input for project-level rate that PUTs to `/projects/:id` with `{ hourlyRateCents: cents | null }`.

- [ ] **Step 3: Verify + commit**

```bash
cd apps/web && bunx tsc --noEmit
git add apps/web/src/app/\(dashboard\)/ apps/api/src/clients/clients.controller.ts
git commit -m "feat(web): default hourly rate inputs for team and projects"
```

---

## Task 13: E2E tests

**Files:**
- Create: `e2e/tests/time-tracking.e2e.ts`

- [ ] **Step 1: Implement**

```ts
import { test, expect, request as playwrightRequest } from "@playwright/test";

const API = "http://localhost:3001/api";

async function createUserAndProject() {
  const ctx = await playwrightRequest.newContext();
  const email = `time-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const password = "TestPass123!";
  await ctx.post(`${API}/onboarding/signup`, {
    data: { name: "T User", email, password, orgName: "Time Org" },
  });
  await ctx.get(`${API}/setup/status`);
  const cookies = await ctx.storageState();
  const csrf = cookies.cookies.find((c) => c.name === "csrf-token")?.value ?? "";
  await ctx.post(`${API}/setup/complete`, { headers: { "x-csrf-token": csrf } });
  const projRes = await ctx.post(`${API}/projects`, {
    data: { name: "Demo Project" },
    headers: { "x-csrf-token": csrf },
  });
  const project = await projRes.json();
  return { ctx, email, password, projectId: project.id, csrf };
}

test.describe("Time tracking", () => {
  test("start timer → stop → entry visible on Time tab", async ({ browser }) => {
    const { email, password, projectId } = await createUserAndProject();
    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto(`/dashboard/projects/${projectId}?tab=time`);
    await page.getByRole("button", { name: /^start timer$/i }).first().click();
    await page.waitForTimeout(1500);
    // Stop via the top-bar widget
    await page.locator('[title="Stop timer"]').click();
    await expect(page.getByText(/0:0[1-9]/)).toBeVisible();
  });

  test("manual entry creates a row", async ({ browser }) => {
    const { email, password, projectId } = await createUserAndProject();
    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto(`/dashboard/projects/${projectId}?tab=time`);
    await page.getByRole("button", { name: /add entry/i }).click();
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("1:00:00")).toBeVisible();
  });

  test("generate invoice from time", async ({ browser, request }) => {
    const { ctx, email, password, projectId, csrf } = await createUserAndProject();
    // Create a billable entry via API
    await ctx.post(`${API}/time-entries`, {
      data: {
        projectId,
        startedAt: new Date(Date.now() - 3600_000).toISOString(),
        endedAt: new Date().toISOString(),
        billable: true,
      },
      headers: { "x-csrf-token": csrf },
    });

    const page = await browser.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto("/dashboard/invoices");
    await page.getByRole("button", { name: /generate from time/i }).click();
    await page.getByRole("button", { name: /generate draft/i }).click();
    await page.waitForURL(/\/dashboard\/invoices\/[^/]+/);
    await expect(page.getByText(/INV-\d+/)).toBeVisible();
  });

  test("client (member role) is blocked from /api/time-entries", async ({ request }) => {
    test.fixme(true, "Pending client-invite test helper for member-role context");
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/tests/time-tracking.e2e.ts
git commit -m "test(e2e): time tracking flows"
```

---

## Task 14: Final smoke + lint

- [ ] **Step 1:** `cd apps/api && bun test` → all green.
- [ ] **Step 2:** `cd apps/api && bunx tsc --noEmit` → clean.
- [ ] **Step 3:** `cd apps/web && bunx tsc --noEmit` → clean (ignoring the pre-existing `embeds.test.ts` error).
- [ ] **Step 4:** Manual smoke — `bun run dev`, sign in, start a timer from the top bar, stop it, see it on the project Time tab, generate an invoice, confirm the entry locks with the lock icon.

---

## Self-review notes

- **Spec coverage:**
  - TimeEntry model + rate columns → Task 1
  - Service methods (start/stop, manual, list, report, generateInvoice) → Tasks 3–5
  - Controller + module registration → Task 6
  - Member rate + Project rate endpoints → Task 7
  - Timer widget → Task 8
  - Project Time tab + manual entry modal → Task 9
  - Reports page → Task 10
  - Generate-from-time wizard → Task 11
  - Default rate UI → Task 12
  - E2E (with one fixme for client-block due to missing invite helper) → Task 13
  - Final verification → Task 14

- **Type consistency:** `hourlyRateCents`, `durationSec`, `billable`, `invoiceLineItemId`, `valueCents` — used consistently across schema, service, controller, and UI.

- **No placeholders:** Every step has concrete code or a concrete command. The only soft references are to existing files whose exact tab structure / settings layout varies (Task 9 step 4 and Task 12 step 2) — both tasks instruct the engineer to grep first and adapt to existing patterns.
