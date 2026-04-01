import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { InvoicesService } from "./invoices.service";
import { InvoicePdfService } from "./invoice-pdf.service";
import { FilesService, UploadedFile as UploadedFileType, INVOICE_ALLOWED_MIMES } from "../files/files.service";
import {
  CreateInvoiceDto,
  CreateUploadedInvoiceDto,
  UpdateInvoiceDto,
  InvoiceListQueryDto,
  MineInvoiceQueryDto,
  CreateRecurringInvoiceDto,
  UpdateRecurringInvoiceDto,
  RecurringInvoiceQueryDto,
} from "./invoices.dto";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  CurrentOrg,
  PlanLimit,
  sanitizeFilename,
  contentDisposition,
  toCsv,
} from "../common";
import type { CsvColumn } from "../common";

@Controller("invoices")
@UseGuards(AuthGuard, RolesGuard)
export class InvoicesController {
  constructor(
    private invoicesService: InvoicesService,
    private invoicePdfService: InvoicePdfService,
    private filesService: FilesService,
  ) {}

  @Post()
  @Roles("owner", "admin")
  create(
    @Body() dto: CreateInvoiceDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.invoicesService.create(dto, orgId);
  }

  @Post("upload")
  @Roles("owner", "admin")
  @PlanLimit("storage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 200 * 1024 * 1024 } }))
  async createUploaded(
    @UploadedFile() file: UploadedFileType,
    @Body() dto: CreateUploadedInvoiceDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    if (!file) throw new BadRequestException("No file provided");
    if (!INVOICE_ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException(
        "Only PDF and image files are allowed for invoice uploads",
      );
    }
    if (!dto.projectId) throw new BadRequestException("projectId is required");

    const fileRecord = await this.filesService.upload(
      file,
      dto.projectId,
      orgId,
      userId,
    );

    return this.invoicesService.createUploaded(dto, fileRecord.id, orgId);
  }

  @Get()
  @Roles("owner", "admin")
  findAll(
    @CurrentOrg("id") orgId: string,
    @Query() query: InvoiceListQueryDto,
  ) {
    return this.invoicesService.findAll(orgId, query);
  }

  @Get("stats")
  @Roles("owner", "admin")
  getStats(
    @CurrentOrg("id") orgId: string,
    @Query("projectId") projectId?: string,
  ) {
    return this.invoicesService.getStats(orgId, projectId);
  }

  @Get("mine")
  findMine(
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Query() query: MineInvoiceQueryDto,
  ) {
    return this.invoicesService.findMine(
      userId,
      orgId,
      query.page,
      query.limit,
      query.projectId,
    );
  }

  @Get("mine/:id/pdf")
  async downloadMinePdf(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
    @Res() res: Response,
  ) {
    // Verify client access first
    await this.invoicesService.findOneMine(id, userId, orgId);
    const { stream, filename } = await this.invoicePdfService.generate(id, orgId);
    const safeName = sanitizeFilename(filename);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  }

  @Get("export")
  @Roles("owner", "admin")
  async exportCsv(@CurrentOrg("id") orgId: string, @Res() res: Response) {
    const data = await this.invoicesService.exportAll(orgId);
    const columns: CsvColumn<(typeof data)[0]>[] = [
      { header: "Invoice Number", value: (r) => r.invoiceNumber },
      { header: "Status", value: (r) => r.status },
      { header: "Type", value: (r) => r.type },
      { header: "Amount", value: (r) => {
        if (r.amount != null) return (r.amount / 100).toFixed(2);
        const total = r.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
        return (total / 100).toFixed(2);
      }},
      { header: "Due Date", value: (r) => r.dueDate?.toISOString().split("T")[0] },
      { header: "Project", value: (r) => r.project?.name },
      { header: "Notes", value: (r) => r.notes },
      { header: "Created At", value: (r) => r.createdAt.toISOString().split("T")[0] },
    ];
    const csv = toCsv(columns, data);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", contentDisposition("invoices.csv"));
    res.send(csv);
  }

  @Get("mine/:id")
  findOneMine(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.invoicesService.findOneMine(id, userId, orgId);
  }

  @Get(":id/pdf")
  @Roles("owner", "admin")
  async downloadPdf(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @Res() res: Response,
  ) {
    const { stream, filename } = await this.invoicePdfService.generate(id, orgId);
    const safeName = sanitizeFilename(filename);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  }

  // ── Recurring Invoices ── (must be before :id routes)

  @Post("recurring")
  @Roles("owner", "admin")
  createRecurring(
    @Body() dto: CreateRecurringInvoiceDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.invoicesService.createRecurring(dto, orgId);
  }

  @Get("recurring")
  @Roles("owner", "admin")
  findRecurring(
    @CurrentOrg("id") orgId: string,
    @Query() query: RecurringInvoiceQueryDto,
  ) {
    return this.invoicesService.findRecurring(orgId, query);
  }

  @Put("recurring/:id")
  @Roles("owner", "admin")
  updateRecurring(
    @Param("id") id: string,
    @Body() dto: UpdateRecurringInvoiceDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.invoicesService.updateRecurring(id, dto, orgId);
  }

  @Delete("recurring/:id")
  @Roles("owner", "admin")
  removeRecurring(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.invoicesService.removeRecurring(id, orgId);
  }

  @Get(":id")
  @Roles("owner", "admin")
  findOne(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.invoicesService.findOne(id, orgId);
  }

  @Put(":id")
  @Roles("owner", "admin")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.invoicesService.update(id, dto, orgId);
  }

  @Delete(":id")
  @Roles("owner", "admin")
  remove(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.invoicesService.remove(id, orgId);
  }
}
