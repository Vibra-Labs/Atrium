import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Response } from "express";
import {
  AuthGuard, RolesGuard, Roles, CurrentOrg, CurrentUser, CurrentMember, contentDisposition, toCsv,
} from "../common";
import type { CsvColumn } from "../common";
import { TimeEntriesService } from "./time-entries.service";
import type { TimeEntryListResponse, TimeEntryListItem, TimeReport, RunningEntry, GenerateInvoiceResult } from "./time-entries.service";
import type { TimeEntry } from "@atrium/database";
import {
  StartTimerDto, CreateManualEntryDto, UpdateTimeEntryDto, TimeEntryListQueryDto, GenerateInvoiceDto,
} from "./time-entries.dto";

@Controller("time-entries")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class TimeEntriesController {
  constructor(private service: TimeEntriesService) {}

  @Get()
  list(
    @CurrentOrg("id") orgId: string,
    @CurrentMember("role") role: string,
    @Query() q: TimeEntryListQueryDto,
  ): Promise<TimeEntryListResponse> {
    return this.service.list(orgId, q, role);
  }

  @Get("running")
  running(@CurrentUser("id") userId: string, @CurrentOrg("id") orgId: string): Promise<RunningEntry> {
    return this.service.getRunning(userId, orgId);
  }

  @Get("report")
  report(
    @CurrentOrg("id") orgId: string,
    @CurrentMember("role") role: string,
    @Query() q: TimeEntryListQueryDto,
  ): Promise<TimeReport> {
    return this.service.report(orgId, q, role);
  }

  // CSV export is expensive (up to 50,000 rows + joins). Tighten the
  // throttler relative to the global 100/min so a runaway client can't
  // wedge the API.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get("report/export")
  async exportCsv(
    @CurrentOrg("id") orgId: string,
    @CurrentMember("role") role: string,
    @Query() q: TimeEntryListQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const list = await this.service.listForExport(orgId, q, role);
    type Row = { date: string; user: string; project: string; task: string; description: string; hours: string; billable: string; invoiced: string };
    const rows: Row[] = list.data.map((e: TimeEntryListItem) => ({
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
  start(
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Body() dto: StartTimerDto,
  ): Promise<TimeEntry> {
    return this.service.start(userId, orgId, dto);
  }

  @Post("stop")
  stop(@CurrentUser("id") userId: string, @CurrentOrg("id") orgId: string): Promise<TimeEntry> {
    return this.service.stop(userId, orgId);
  }

  @Post()
  create(
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Body() dto: CreateManualEntryDto,
  ): Promise<TimeEntry> {
    return this.service.create(userId, orgId, dto);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Body() dto: UpdateTimeEntryDto,
  ): Promise<TimeEntry> {
    return this.service.update(id, userId, orgId, dto);
  }

  @Delete(":id")
  remove(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
  ): Promise<void> {
    return this.service.delete(id, userId, orgId);
  }

  @Post("generate-invoice")
  generateInvoice(
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Body() dto: GenerateInvoiceDto,
  ): Promise<GenerateInvoiceResult> {
    return this.service.generateInvoice(userId, orgId, dto);
  }
}
