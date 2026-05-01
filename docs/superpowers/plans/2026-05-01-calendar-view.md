# Calendar View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only calendar at `/dashboard/calendar` that aggregates tasks (`dueDate`), projects (`startDate`/`endDate`), and invoices (`dueDate`) into a month grid and an agenda list.

**Architecture:** A NestJS service issues three parallel Prisma queries scoped to the active org and returns a discriminated `CalendarEvent[]`. The Next.js page renders either a Month grid or an Agenda list, with project filter sent to the API and type/assignee filters applied client-side.

**Tech Stack:** NestJS 11, Prisma, Next.js 15, React 19, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-05-01-calendar-view-design.md`

---

## Task 1: API skeleton — module + DTO

**Files:**
- Create: `apps/api/src/calendar/calendar.module.ts`
- Create: `apps/api/src/calendar/calendar.dto.ts`

- [ ] **Step 1: DTO**

```ts
// apps/api/src/calendar/calendar.dto.ts
import { IsDateString, IsOptional, IsString } from "class-validator";

export class CalendarQueryDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() type?: string;
}
```

- [ ] **Step 2: Module skeleton**

```ts
// apps/api/src/calendar/calendar.module.ts
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";

@Module({
  imports: [PrismaModule],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
```

(Controller + service will be created in Tasks 2 and 3; the module won't import cleanly until Task 3. This is expected.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/calendar
git commit -m "feat(api): calendar module skeleton + DTO"
```

---

## Task 2: API service — aggregation + range validation

**Files:**
- Create: `apps/api/src/calendar/calendar.service.ts`
- Create: `apps/api/src/calendar/calendar.service.spec.ts`

- [ ] **Step 1: Failing tests**

```ts
// apps/api/src/calendar/calendar.service.spec.ts
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { CalendarService } from "./calendar.service";

let service: CalendarService;
let prisma: PrismaService;
let orgId: string;
let userId: string;
let projectId: string;

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    providers: [CalendarService, PrismaService],
  }).compile();
  service = mod.get(CalendarService);
  prisma = mod.get(PrismaService);
});

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await prisma.task.deleteMany({ where: {} });
  await prisma.invoiceLineItem.deleteMany({ where: {} });
  await prisma.invoice.deleteMany({ where: {} });
  await prisma.project.deleteMany({ where: {} });

  const org = await prisma.organization.create({
    data: { id: `cal-org-${stamp}`, name: `cal-${stamp}`, slug: `cal-${stamp}` },
  });
  orgId = org.id;
  const user = await prisma.user.create({
    data: { id: `cal-user-${stamp}`, name: "C", email: `cal-${stamp}@x.com`, emailVerified: true },
  });
  userId = user.id;
  await prisma.member.create({
    data: { id: `cal-mem-${stamp}`, organizationId: orgId, userId, role: "owner" },
  });
  const project = await prisma.project.create({
    data: {
      id: `cal-proj-${stamp}`,
      name: "P",
      organizationId: orgId,
      startDate: new Date("2026-05-05"),
      endDate: new Date("2026-05-25"),
    },
  });
  projectId = project.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("CalendarService.list", () => {
  it("returns task whose dueDate falls in window", async () => {
    await prisma.task.create({
      data: { title: "Inside", organizationId: orgId, projectId, status: "todo", dueDate: new Date("2026-05-10") },
    });
    await prisma.task.create({
      data: { title: "Outside", organizationId: orgId, projectId, status: "todo", dueDate: new Date("2026-06-15") },
    });
    const events = await service.list(orgId, { from: "2026-05-01", to: "2026-05-31" });
    const tasks = events.filter((e) => e.type === "task");
    expect(tasks.length).toBe(1);
    expect(tasks[0].type === "task" && tasks[0].title).toBe("Inside");
  });

  it("returns project_start and project_end events for projects in window", async () => {
    const events = await service.list(orgId, { from: "2026-05-01", to: "2026-05-31" });
    const types = events.filter((e) => e.type === "project_start" || e.type === "project_end").map((e) => e.type);
    expect(types).toContain("project_start");
    expect(types).toContain("project_end");
  });

  it("omits project events when start/end is null", async () => {
    await prisma.project.update({ where: { id: projectId }, data: { startDate: null, endDate: null } });
    const events = await service.list(orgId, { from: "2026-05-01", to: "2026-05-31" });
    expect(events.filter((e) => e.type === "project_start" || e.type === "project_end").length).toBe(0);
  });

  it("returns invoice with computed amount from line items", async () => {
    const inv = await prisma.invoice.create({
      data: {
        organizationId: orgId,
        projectId,
        invoiceNumber: `INV-CAL-${Date.now()}`,
        status: "draft",
        dueDate: new Date("2026-05-20"),
      },
    });
    await prisma.invoiceLineItem.create({
      data: { invoiceId: inv.id, description: "x", quantity: 2, unitPrice: 5000 },
    });
    const events = await service.list(orgId, { from: "2026-05-01", to: "2026-05-31" });
    const invoiceEvents = events.filter((e) => e.type === "invoice_due");
    expect(invoiceEvents.length).toBe(1);
    expect(invoiceEvents[0].type === "invoice_due" && invoiceEvents[0].amountCents).toBe(10000);
  });

  it("projectId filter narrows tasks, projects, and invoices", async () => {
    const stamp2 = `${Date.now()}-other-${Math.random().toString(36).slice(2, 7)}`;
    const other = await prisma.project.create({
      data: { id: `cal-other-${stamp2}`, name: "Other", organizationId: orgId, startDate: new Date("2026-05-08") },
    });
    await prisma.task.create({
      data: { title: "OtherTask", organizationId: orgId, projectId: other.id, status: "todo", dueDate: new Date("2026-05-12") },
    });
    const events = await service.list(orgId, { from: "2026-05-01", to: "2026-05-31", projectId });
    const titles = events.map((e) => e.title);
    expect(titles).not.toContain("OtherTask");
    expect(titles).not.toContain("Other");
  });

  it("type filter returns only requested event types", async () => {
    await prisma.task.create({
      data: { title: "T", organizationId: orgId, projectId, status: "todo", dueDate: new Date("2026-05-10") },
    });
    const events = await service.list(orgId, { from: "2026-05-01", to: "2026-05-31", type: "task" });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.type === "task")).toBe(true);
  });

  it("rejects when to <= from", async () => {
    await expect(
      service.list(orgId, { from: "2026-05-10", to: "2026-05-01" }),
    ).rejects.toThrow();
  });

  it("rejects when window > 366 days", async () => {
    await expect(
      service.list(orgId, { from: "2026-01-01", to: "2027-01-15" }),
    ).rejects.toThrow();
  });

  it("sorts events ascending by date", async () => {
    await prisma.task.create({
      data: { title: "Late", organizationId: orgId, projectId, status: "todo", dueDate: new Date("2026-05-22") },
    });
    await prisma.task.create({
      data: { title: "Early", organizationId: orgId, projectId, status: "todo", dueDate: new Date("2026-05-03") },
    });
    const events = await service.list(orgId, { from: "2026-05-01", to: "2026-05-31" });
    for (let i = 1; i < events.length; i++) {
      expect(events[i].date >= events[i - 1].date).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

```bash
set -a && source .env && set +a
cd apps/api && bun test src/calendar
```

Expected: error — `Cannot find module './calendar.service'`.

- [ ] **Step 3: Implement service**

```ts
// apps/api/src/calendar/calendar.service.ts
import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type CalendarEvent =
  | {
      type: "task";
      id: string;
      date: string;
      title: string;
      status: string;
      projectId: string;
      projectName: string;
      assigneeId: string | null;
      assigneeName: string | null;
    }
  | {
      type: "project_start" | "project_end";
      id: string;
      date: string;
      title: string;
      projectId: string;
      projectName: string;
    }
  | {
      type: "invoice_due";
      id: string;
      date: string;
      title: string;
      status: string;
      projectId: string | null;
      projectName: string | null;
      amountCents: number;
    };

interface CalendarQuery {
  from: string;
  to: string;
  projectId?: string;
  type?: string;
}

const VALID_TYPES = new Set(["task", "project_start", "project_end", "invoice_due"]);

@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  async list(orgId: string, query: CalendarQuery): Promise<CalendarEvent[]> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException("Invalid date format");
    }
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException("`to` must be after `from`");
    }
    const days = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    if (days > 366) {
      throw new BadRequestException("Window cannot exceed 366 days");
    }

    const requestedTypes = query.type
      ? new Set(query.type.split(",").map((s) => s.trim()).filter((s) => VALID_TYPES.has(s)))
      : VALID_TYPES;

    const wantTasks = requestedTypes.has("task");
    const wantProjectStart = requestedTypes.has("project_start");
    const wantProjectEnd = requestedTypes.has("project_end");
    const wantInvoices = requestedTypes.has("invoice_due");

    const [tasks, projects, invoices] = await Promise.all([
      wantTasks
        ? this.prisma.task.findMany({
            where: {
              organizationId: orgId,
              ...(query.projectId ? { projectId: query.projectId } : {}),
              dueDate: { gte: from, lte: to },
            },
            select: {
              id: true,
              title: true,
              status: true,
              dueDate: true,
              projectId: true,
              project: { select: { name: true } },
              assigneeId: true,
              assignee: { select: { name: true } },
            },
          })
        : Promise.resolve([] as Array<{
            id: string; title: string; status: string; dueDate: Date | null;
            projectId: string; project: { name: string };
            assigneeId: string | null; assignee: { name: string } | null;
          }>),
      wantProjectStart || wantProjectEnd
        ? this.prisma.project.findMany({
            where: {
              organizationId: orgId,
              ...(query.projectId ? { id: query.projectId } : {}),
              OR: [
                { startDate: { gte: from, lte: to } },
                { endDate: { gte: from, lte: to } },
              ],
            },
            select: { id: true, name: true, startDate: true, endDate: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string; startDate: Date | null; endDate: Date | null }>),
      wantInvoices
        ? this.prisma.invoice.findMany({
            where: {
              organizationId: orgId,
              ...(query.projectId ? { projectId: query.projectId } : {}),
              dueDate: { gte: from, lte: to },
            },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              dueDate: true,
              amount: true,
              projectId: true,
              project: { select: { name: true } },
              lineItems: { select: { quantity: true, unitPrice: true } },
            },
          })
        : Promise.resolve([] as Array<{
            id: string; invoiceNumber: string; status: string; dueDate: Date | null;
            amount: number | null; projectId: string | null;
            project: { name: string } | null;
            lineItems: Array<{ quantity: number; unitPrice: number }>;
          }>),
    ]);

    const events: CalendarEvent[] = [];

    for (const t of tasks) {
      if (!t.dueDate) continue;
      events.push({
        type: "task",
        id: t.id,
        date: t.dueDate.toISOString().slice(0, 10),
        title: t.title,
        status: t.status,
        projectId: t.projectId,
        projectName: t.project.name,
        assigneeId: t.assigneeId,
        assigneeName: t.assignee?.name ?? null,
      });
    }

    for (const p of projects) {
      if (wantProjectStart && p.startDate && p.startDate >= from && p.startDate <= to) {
        events.push({
          type: "project_start",
          id: p.id,
          date: p.startDate.toISOString().slice(0, 10),
          title: p.name,
          projectId: p.id,
          projectName: p.name,
        });
      }
      if (wantProjectEnd && p.endDate && p.endDate >= from && p.endDate <= to) {
        events.push({
          type: "project_end",
          id: p.id,
          date: p.endDate.toISOString().slice(0, 10),
          title: p.name,
          projectId: p.id,
          projectName: p.name,
        });
      }
    }

    for (const inv of invoices) {
      if (!inv.dueDate) continue;
      const computed = inv.lineItems.reduce((s, li) => s + li.unitPrice * li.quantity, 0);
      events.push({
        type: "invoice_due",
        id: inv.id,
        date: inv.dueDate.toISOString().slice(0, 10),
        title: inv.invoiceNumber,
        status: inv.status,
        projectId: inv.projectId,
        projectName: inv.project?.name ?? null,
        amountCents: inv.amount ?? computed,
      });
    }

    events.sort((a, b) => a.date.localeCompare(b.date));
    return events;
  }
}
```

- [ ] **Step 4: Run tests, expect 9/9 pass**

```bash
set -a && source .env && set +a
cd apps/api && bun test src/calendar
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/calendar
git commit -m "feat(api): calendar service aggregates tasks/projects/invoices"
```

---

## Task 3: API controller + module registration

**Files:**
- Create: `apps/api/src/calendar/calendar.controller.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Controller**

```ts
// apps/api/src/calendar/calendar.controller.ts
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, RolesGuard, Roles, CurrentOrg } from "../common";
import { CalendarService } from "./calendar.service";
import { CalendarQueryDto } from "./calendar.dto";

@Controller("calendar")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class CalendarController {
  constructor(private service: CalendarService) {}

  @Get()
  list(@CurrentOrg("id") orgId: string, @Query() q: CalendarQueryDto) {
    return this.service.list(orgId, q);
  }
}
```

- [ ] **Step 2: Register module in app.module.ts**

Add import alongside the other module imports:

```ts
import { CalendarModule } from "./calendar/calendar.module";
```

Add `CalendarModule` to the `imports` array (place near `TimeEntriesModule`).

- [ ] **Step 3: Verify**

```bash
set -a && source .env && set +a
cd apps/api && bun test && bunx tsc --noEmit
```

Expected: all tests pass; `tsc --noEmit` exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/calendar/calendar.controller.ts apps/api/src/app.module.ts
git commit -m "feat(api): calendar controller + module registration"
```

---

## Task 4: Web — types and date helpers

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/calendar/types.ts`

- [ ] **Step 1: types.ts**

```ts
// apps/web/src/app/(dashboard)/dashboard/calendar/types.ts
export type CalendarEvent =
  | {
      type: "task";
      id: string;
      date: string;
      title: string;
      status: string;
      projectId: string;
      projectName: string;
      assigneeId: string | null;
      assigneeName: string | null;
    }
  | {
      type: "project_start" | "project_end";
      id: string;
      date: string;
      title: string;
      projectId: string;
      projectName: string;
    }
  | {
      type: "invoice_due";
      id: string;
      date: string;
      title: string;
      status: string;
      projectId: string | null;
      projectName: string | null;
      amountCents: number;
    };

export const ALL_TYPES = ["task", "project_start", "project_end", "invoice_due"] as const;
export type CalendarEventType = (typeof ALL_TYPES)[number];

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function gridStart(month: Date): Date {
  const start = startOfMonth(month);
  const day = start.getDay();
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() - day);
}

export function gridEnd(month: Date): Date {
  const end = endOfMonth(month);
  const day = end.getDay();
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() + (6 - day));
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function gridDays(month: Date): Date[] {
  const start = gridStart(month);
  const end = gridEnd(month);
  const days: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/calendar/types.ts"
git commit -m "feat(web): calendar types and date helpers"
```

---

## Task 5: Web — EventChip component

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/calendar/event-chip.tsx`

- [ ] **Step 1: EventChip**

```tsx
// apps/web/src/app/(dashboard)/dashboard/calendar/event-chip.tsx
"use client";

import Link from "next/link";
import { CheckSquare, PlayCircle, StopCircle, Receipt } from "lucide-react";
import type { CalendarEvent } from "./types";

function chipHref(e: CalendarEvent): string {
  if (e.type === "task") return `/dashboard/projects/${e.projectId}?tab=tasks&task=${e.id}`;
  if (e.type === "project_start" || e.type === "project_end") return `/dashboard/projects/${e.projectId}`;
  if (e.type === "invoice_due" && e.projectId) return `/dashboard/projects/${e.projectId}?tab=invoices`;
  return "#";
}

function invoiceColor(status: string): string {
  if (status === "paid") return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900";
  if (status === "overdue") return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900";
  return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900";
}

function taskColor(status: string): string {
  if (status === "done") return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900";
  if (status === "in_progress") return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900";
  return "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700";
}

export function EventChip({ event, compact = false }: { event: CalendarEvent; compact?: boolean }) {
  let icon: React.ReactNode;
  let className: string;
  let label: string;
  let tooltip: string;

  if (event.type === "task") {
    icon = <CheckSquare size={10} />;
    className = taskColor(event.status);
    label = event.title;
    tooltip = `${event.title} · ${event.projectName}${event.assigneeName ? ` · ${event.assigneeName}` : ""}`;
  } else if (event.type === "project_start") {
    icon = <PlayCircle size={10} />;
    className = "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900";
    label = `Start: ${event.title}`;
    tooltip = `Project starts: ${event.title}`;
  } else if (event.type === "project_end") {
    icon = <StopCircle size={10} />;
    className = "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-900";
    label = `End: ${event.title}`;
    tooltip = `Project ends: ${event.title}`;
  } else {
    icon = <Receipt size={10} />;
    className = invoiceColor(event.status);
    label = event.title;
    tooltip = `Invoice ${event.title} due${event.projectName ? ` · ${event.projectName}` : ""}`;
  }

  return (
    <Link
      href={chipHref(event)}
      title={tooltip}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] truncate hover:opacity-80 ${className} ${compact ? "" : "w-full"}`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: clean (or only the pre-existing `embeds.test.ts` error).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/calendar/event-chip.tsx"
git commit -m "feat(web): calendar event chip"
```

---

## Task 6: Web — MonthGrid component

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/calendar/month-grid.tsx`

- [ ] **Step 1: MonthGrid**

```tsx
// apps/web/src/app/(dashboard)/dashboard/calendar/month-grid.tsx
"use client";

import { useState } from "react";
import { gridDays, isSameDay, toISODate } from "./types";
import type { CalendarEvent } from "./types";
import { EventChip } from "./event-chip";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE = 3;

export function MonthGrid({ month, events }: { month: Date; events: CalendarEvent[] }) {
  const [popoverDate, setPopoverDate] = useState<string | null>(null);
  const days = gridDays(month);
  const today = new Date();

  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const arr = byDate.get(e.date) ?? [];
    arr.push(e);
    byDate.set(e.date, arr);
  }

  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 bg-[var(--muted)] text-xs font-medium">
        {WEEKDAYS.map((w) => (
          <div key={w} className="p-2 text-center">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = isSameDay(d, today);
          const dayEvents = byDate.get(iso) ?? [];
          const visible = dayEvents.slice(0, MAX_VISIBLE);
          const overflow = dayEvents.length - visible.length;

          return (
            <div
              key={iso}
              className={`min-h-[110px] border-t border-l border-[var(--border)] p-1 flex flex-col gap-1 ${inMonth ? "" : "bg-[var(--muted)]/40 text-[var(--muted-foreground)]"}`}
            >
              <div className={`text-xs px-1 ${isToday ? "inline-flex w-6 h-6 items-center justify-center rounded-full bg-[var(--primary)] text-white font-medium" : ""}`}>
                {d.getDate()}
              </div>
              {visible.map((e) => (
                <EventChip key={`${e.type}-${e.id}-${e.date}`} event={e} />
              ))}
              {overflow > 0 && (
                <button
                  onClick={() => setPopoverDate(iso)}
                  className="text-[11px] text-[var(--muted-foreground)] hover:underline text-left px-1"
                >
                  +{overflow} more
                </button>
              )}
            </div>
          );
        })}
      </div>

      {popoverDate && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setPopoverDate(null); }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-sm p-4 space-y-2">
            <div className="text-sm font-medium">{popoverDate}</div>
            <div className="space-y-1">
              {(byDate.get(popoverDate) ?? []).map((e) => (
                <EventChip key={`${e.type}-${e.id}-${e.date}-pop`} event={e} />
              ))}
            </div>
            <div className="text-right pt-2">
              <button onClick={() => setPopoverDate(null)} className="text-sm px-3 py-1 border border-[var(--border)] rounded">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd apps/web && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/calendar/month-grid.tsx"
git commit -m "feat(web): calendar month grid"
```

---

## Task 7: Web — AgendaList component

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/calendar/agenda-list.tsx`

- [ ] **Step 1: AgendaList**

```tsx
// apps/web/src/app/(dashboard)/dashboard/calendar/agenda-list.tsx
"use client";

import type { CalendarEvent } from "./types";
import { EventChip } from "./event-chip";

export function AgendaList({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="border border-[var(--border)] rounded-lg p-8 text-center text-sm text-[var(--muted-foreground)]">
        No items in this window.
      </div>
    );
  }

  const grouped = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const arr = grouped.get(e.date) ?? [];
    arr.push(e);
    grouped.set(e.date, arr);
  }

  const dates = Array.from(grouped.keys()).sort();

  return (
    <div className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
      {dates.map((date) => {
        const items = grouped.get(date) ?? [];
        const display = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
          weekday: "short", month: "short", day: "numeric", year: "numeric",
        });
        return (
          <div key={date} className="p-3 space-y-2">
            <div className="text-xs font-medium text-[var(--muted-foreground)] sticky top-0 bg-[var(--background)] py-1">
              {display}
            </div>
            <div className="space-y-1">
              {items.map((e) => (
                <EventChip key={`${e.type}-${e.id}-${e.date}-agenda`} event={e} compact />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd apps/web && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/calendar/agenda-list.tsx"
git commit -m "feat(web): calendar agenda list"
```

---

## Task 8: Web — Calendar page + sidebar nav

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/calendar/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/sidebar-nav.tsx`

- [ ] **Step 1: Calendar page**

```tsx
// apps/web/src/app/(dashboard)/dashboard/calendar/page.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  ALL_TYPES,
  addMonths,
  gridStart,
  gridEnd,
  toISODate,
  type CalendarEvent,
  type CalendarEventType,
} from "./types";
import { MonthGrid } from "./month-grid";
import { AgendaList } from "./agenda-list";

interface ProjectOption { id: string; name: string }
type ProjectsResponse = { data: ProjectOption[] } | ProjectOption[];

const TYPE_LABEL: Record<CalendarEventType, string> = {
  task: "Tasks",
  project_start: "Project starts",
  project_end: "Project ends",
  invoice_due: "Invoices",
};

export default function CalendarPage() {
  const { error: showError } = useToast();
  const [month, setMonth] = useState<Date>(() => new Date());
  const [view, setView] = useState<"month" | "agenda">("month");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<Set<CalendarEventType>>(() => new Set(ALL_TYPES));
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ProjectsResponse>("/projects?limit=200")
      .then((res) => setProjects(Array.isArray(res) ? res : res.data))
      .catch((err: unknown) => { console.error(err); });
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const from = toISODate(gridStart(month));
      const to = toISODate(gridEnd(month));
      const params = new URLSearchParams();
      params.set("from", from);
      params.set("to", to);
      if (projectId) params.set("projectId", projectId);
      const res = await apiFetch<CalendarEvent[]>(`/calendar?${params.toString()}`);
      setEvents(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  }, [month, projectId, showError]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo<CalendarEvent[]>(() => {
    return events.filter((e) => {
      if (!typeFilter.has(e.type)) return false;
      if (assigneeId && e.type === "task" && e.assigneeId !== assigneeId) return false;
      return true;
    });
  }, [events, typeFilter, assigneeId]);

  const assigneeOptions = useMemo<{ id: string; name: string }[]>(() => {
    const seen = new Map<string, string>();
    for (const e of events) {
      if (e.type === "task" && e.assigneeId && e.assigneeName) {
        seen.set(e.assigneeId, e.assigneeName);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [events]);

  function toggleType(t: CalendarEventType): void {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-sm">
          <button
            onClick={() => setView("month")}
            className={`px-3 py-1.5 ${view === "month" ? "bg-[var(--muted)]" : ""}`}
          >Month</button>
          <button
            onClick={() => setView("agenda")}
            className={`px-3 py-1.5 ${view === "agenda" ? "bg-[var(--muted)]" : ""}`}
          >Agenda</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth((m) => addMonths(m, -1))}
            className="p-1.5 rounded border border-[var(--border)]"
            aria-label="Previous month"
          ><ChevronLeft size={16} /></button>
          <div className="px-3 text-sm font-medium min-w-[140px] text-center">
            {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </div>
          <button
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="p-1.5 rounded border border-[var(--border)]"
            aria-label="Next month"
          ><ChevronRight size={16} /></button>
          <button
            onClick={() => setMonth(new Date())}
            className="ml-2 px-3 py-1.5 text-sm border border-[var(--border)] rounded"
          >Today</button>
        </div>

        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
        >
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <div className="flex items-center gap-3 text-sm">
          {ALL_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input type="checkbox" checked={typeFilter.has(t)} onChange={() => toggleType(t)} />
              {TYPE_LABEL[t]}
            </label>
          ))}
        </div>

        {typeFilter.has("task") && assigneeOptions.length > 0 && (
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          >
            <option value="">All assignees</option>
            {assigneeOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      {error ? (
        <div className="border border-[var(--border)] rounded-lg p-6 text-center text-sm">
          <div className="text-red-600 mb-2">Failed to load</div>
          <button onClick={load} className="px-3 py-1.5 border border-[var(--border)] rounded">Retry</button>
        </div>
      ) : loading ? (
        <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
      ) : view === "month" ? (
        <MonthGrid month={month} events={filtered} />
      ) : (
        <AgendaList events={filtered} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Sidebar nav entry**

Open `apps/web/src/app/(dashboard)/sidebar-nav.tsx`. Add `Calendar` to the lucide-react imports and a nav entry between Projects and Reports:

```ts
{ href: "/dashboard/calendar", label: "Calendar", icon: Calendar },
```

(The exact entry shape should match the surrounding entries — copy structure verbatim from the existing Reports entry that was added in the time-tracking work.)

- [ ] **Step 3: Verify**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: clean (apart from the known `embeds.test.ts` `bun:test` resolution error which pre-existed).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/calendar/page.tsx" "apps/web/src/app/(dashboard)/sidebar-nav.tsx"
git commit -m "feat(web): calendar page with filters + sidebar nav"
```

---

## Task 9: E2E tests

**Files:**
- Create: `e2e/tests/calendar.e2e.ts`

- [ ] **Step 1: Read existing helpers**

Open `e2e/tests/time-tracking.e2e.ts` (committed at SHA `9087b45` on `feat/time-tracking`, will be on `main` after merge — read it directly from disk). Reuse:
- The login helper / fixture pattern.
- The `getOrCreateProject` helper (free-plan project limit is 2 — share projects across tests).
- Telemetry banner dismissal (`No thanks` button before interactions).

If those helpers live in `e2e/test-utils.ts` or `e2e/global-setup.ts`, import them. If not, replicate the inline pattern from `time-tracking.e2e.ts`.

- [ ] **Step 2: Implement four tests**

```ts
// e2e/tests/calendar.e2e.ts
import { test, expect, request as playwrightRequest } from "@playwright/test";

const API = "http://localhost:3001/api";

// NOTE: adapt these helpers if e2e/test-utils.ts already provides equivalents.
async function signupAndLogin(page: import("@playwright/test").Page) {
  const ctx = await playwrightRequest.newContext();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email = `cal-${stamp}@test.local`;
  const password = "TestPass123!";
  await ctx.post(`${API}/onboarding/signup`, {
    data: { name: "Cal User", email, password, orgName: "Cal Org" },
  });
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
  // Dismiss telemetry banner if present.
  const noThanks = page.getByRole("button", { name: /no thanks/i });
  if (await noThanks.count()) await noThanks.click();
  return { ctx, email };
}

async function createProject(ctx: import("@playwright/test").APIRequestContext, name: string) {
  const csrfRes = await ctx.get(`${API}/auth/get-csrf-token`).catch(() => null);
  const csrf = csrfRes ? (await csrfRes.json().catch(() => ({}))).token ?? "" : "";
  const res = await ctx.post(`${API}/projects`, {
    data: { name },
    headers: csrf ? { "x-csrf-token": csrf } : {},
  });
  return await res.json() as { id: string };
}

test.describe("Calendar", () => {
  test("month grid renders task on its due date", async ({ page }) => {
    const { ctx } = await signupAndLogin(page);
    const project = await createProject(ctx, "Cal Project");
    const today = new Date();
    const due = new Date(today.getFullYear(), today.getMonth(), 15);
    await ctx.post(`${API}/projects/${project.id}/tasks`, {
      data: { title: "Calendar test task", status: "todo", dueDate: due.toISOString() },
    });

    await page.goto("/dashboard/calendar");
    await expect(page.getByText("Calendar test task")).toBeVisible();
  });

  test("project filter narrows the grid", async ({ page }) => {
    const { ctx } = await signupAndLogin(page);
    const a = await createProject(ctx, "ProjA");
    const b = await createProject(ctx, "ProjB");
    const today = new Date();
    const due = new Date(today.getFullYear(), today.getMonth(), 16);
    await ctx.post(`${API}/projects/${a.id}/tasks`, { data: { title: "Task on A", status: "todo", dueDate: due.toISOString() } });
    await ctx.post(`${API}/projects/${b.id}/tasks`, { data: { title: "Task on B", status: "todo", dueDate: due.toISOString() } });

    await page.goto("/dashboard/calendar");
    await expect(page.getByText("Task on A")).toBeVisible();
    await expect(page.getByText("Task on B")).toBeVisible();
    await page.getByRole("combobox").first().selectOption({ label: "ProjA" });
    await expect(page.getByText("Task on A")).toBeVisible();
    await expect(page.getByText("Task on B")).toHaveCount(0);
  });

  test("clicking task chip navigates to project task deep link", async ({ page }) => {
    const { ctx } = await signupAndLogin(page);
    const project = await createProject(ctx, "Cal Click");
    const today = new Date();
    const due = new Date(today.getFullYear(), today.getMonth(), 17);
    await ctx.post(`${API}/projects/${project.id}/tasks`, { data: { title: "Click me", status: "todo", dueDate: due.toISOString() } });

    await page.goto("/dashboard/calendar");
    await page.getByText("Click me").click();
    await page.waitForURL(/\/dashboard\/projects\/[^/]+\?tab=tasks&task=/);
  });

  test("agenda view lists future items grouped by date", async ({ page }) => {
    const { ctx } = await signupAndLogin(page);
    const project = await createProject(ctx, "Cal Agenda");
    const today = new Date();
    const due = new Date(today.getFullYear(), today.getMonth(), 18);
    await ctx.post(`${API}/projects/${project.id}/tasks`, { data: { title: "Agenda task", status: "todo", dueDate: due.toISOString() } });

    await page.goto("/dashboard/calendar");
    await page.getByRole("button", { name: /^agenda$/i }).click();
    await expect(page.getByText("Agenda task")).toBeVisible();
  });
});
```

(If the create-task API has a different shape — different path or required fields — adapt the helper. The endpoint exists; verify against `apps/api/src/projects/projects.controller.ts` or `tasks.controller.ts` if needed.)

- [ ] **Step 3: Run the suite**

```bash
cd /Users/edgar/Documents/Development-Projects/Atrium && bun run test:e2e -- --grep "Calendar"
```

Expected: 4/4 pass. If selectors mismatch (e.g., the project select isn't `getByRole("combobox").first()`), adapt the locator.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/calendar.e2e.ts
git commit -m "test(e2e): calendar view flows"
```

---

## Task 10: Final smoke

- [ ] **Step 1:** `set -a && source .env && set +a && cd apps/api && bun test` — all green.
- [ ] **Step 2:** `cd apps/api && bunx tsc --noEmit` — clean.
- [ ] **Step 3:** `cd apps/web && bunx tsc --noEmit` — clean (allow pre-existing `embeds.test.ts` `bun:test` error).
- [ ] **Step 4:** Manual smoke — `bun run dev`, sign in, visit `/dashboard/calendar`, navigate months, toggle types, click a task chip and confirm it lands on the task detail in the project page.

---

## Self-review notes

- **Spec coverage:**
  - GET /calendar with from/to/projectId/type → Tasks 1–3
  - 366-day cap + range validation → Task 2 tests + service
  - CalendarEvent discriminated union shared between API and web → Tasks 2 + 4 (matched verbatim)
  - Owner/admin guard → Task 3 controller
  - Month grid + Agenda → Tasks 6 + 7
  - Filters (project, type, assignee) → Task 8 page
  - Click navigation to project / task / invoices → Task 5 EventChip
  - Today highlight + adjacent-month dimming + "+N more" popover → Task 6
  - Sidebar nav entry → Task 8
  - E2E covers month render, project filter, click navigation, agenda → Task 9

- **Type consistency:** `CalendarEvent` discriminated union has the same field names and shapes in `apps/api/src/calendar/calendar.service.ts` (Task 2) and `apps/web/.../calendar/types.ts` (Task 4). Status values, `amountCents`, `assigneeId`/`assigneeName`, `projectId`/`projectName` all match.

- **No placeholders:** every code step contains the full code; no "TODO" / "implement later" / "similar to Task N".
