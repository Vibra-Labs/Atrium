import {
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
} from "@nestjs/common";
import { Response } from "express";
import { InvoicesService } from "./invoices.service";
import { InvoicePdfService } from "./invoice-pdf.service";
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoiceListQueryDto,
} from "./invoices.dto";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  CurrentOrg,
  PaginationQueryDto,
  sanitizeFilename,
} from "../common";

@Controller("invoices")
@UseGuards(AuthGuard, RolesGuard)
export class InvoicesController {
  constructor(
    private invoicesService: InvoicesService,
    private invoicePdfService: InvoicePdfService,
  ) {}

  @Post()
  @Roles("owner", "admin")
  create(
    @Body() dto: CreateInvoiceDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.invoicesService.create(dto, orgId);
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
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.invoicesService.findMine(
      userId,
      orgId,
      pagination.page,
      pagination.limit,
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
