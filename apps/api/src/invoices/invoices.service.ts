import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import type { Invoice, InvoiceLineItem } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { paginationArgs, paginatedResponse } from "../common";
import {
  CreateInvoiceDto,
  CreateUploadedInvoiceDto,
  RecordInvoiceDto,
  UpdateInvoiceDto,
  InvoiceListQueryDto,
} from "./invoices.dto";

interface InvoiceWhereInput {
  organizationId?: string;
  projectId?: string;
  status?: string;
}

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(dto: CreateInvoiceDto, orgId: string, retries = 0): Promise<Invoice & { lineItems: InvoiceLineItem[] }> {
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, organizationId: orgId },
      });
      if (!project) {
        throw new ForbiddenException("Project does not belong to this organization");
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const lastInvoice = await tx.invoice.findFirst({
          where: { organizationId: orgId },
          orderBy: { invoiceNumber: "desc" },
          select: { invoiceNumber: true },
        });

        let nextNumber = 1;
        if (lastInvoice) {
          const match = lastInvoice.invoiceNumber.match(/INV-(\d+)/);
          if (match) nextNumber = parseInt(match[1], 10) + 1;
        }
        const invoiceNumber = `INV-${String(nextNumber).padStart(4, "0")}`;

        return tx.invoice.create({
          data: {
            invoiceNumber,
            status: "draft",
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
            notes: dto.notes,
            projectId: dto.projectId,
            organizationId: orgId,
            lineItems: {
              create: dto.lineItems.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
              })),
            },
          },
          include: { lineItems: true },
        });
      }, { isolationLevel: 'Serializable' });
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2002" && retries < 3) {
        return this.create(dto, orgId, retries + 1);
      }
      throw err;
    }
  }

  async createUploaded(dto: CreateUploadedInvoiceDto, fileId: string, orgId: string, retries = 0): Promise<Invoice> {
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, organizationId: orgId },
      });
      if (!project) {
        throw new ForbiddenException("Project does not belong to this organization");
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const lastInvoice = await tx.invoice.findFirst({
          where: { organizationId: orgId },
          orderBy: { invoiceNumber: "desc" },
          select: { invoiceNumber: true },
        });

        let nextNumber = 1;
        if (lastInvoice) {
          const match = lastInvoice.invoiceNumber.match(/INV-(\d+)/);
          if (match) nextNumber = parseInt(match[1], 10) + 1;
        }
        const invoiceNumber = `INV-${String(nextNumber).padStart(4, "0")}`;

        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            type: "uploaded",
            status: "draft",
            amount: dto.amount,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
            notes: dto.notes,
            uploadedFileId: fileId,
            projectId: dto.projectId,
            organizationId: orgId,
          },
          include: { uploadedFile: true },
        });

        return invoice;
      }, { isolationLevel: "Serializable" });
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2002" && retries < 3) {
        return this.createUploaded(dto, fileId, orgId, retries + 1);
      }
      throw err;
    }
  }

  // Separate method so we can call notify after createUploaded
  async createUploadedAndNotify(dto: CreateUploadedInvoiceDto, fileId: string, orgId: string): Promise<Invoice> {
    const invoice = await this.createUploaded(dto, fileId, orgId);
    if (invoice.projectId) {
      this.notifications.notifyInvoiceSent(invoice.id);
    }
    return invoice;
  }

  async recordExternalInvoice(
    dto: RecordInvoiceDto,
    orgId: string,
    fileId?: string,
    retries = 0,
  ): Promise<Invoice & { lineItems: InvoiceLineItem[] }> {
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, organizationId: orgId },
      });
      if (!project) {
        throw new ForbiddenException("Project does not belong to this organization");
      }
    }

    const timeEntryIds = Array.from(new Set(dto.timeEntryIds));
    if (timeEntryIds.length !== dto.timeEntryIds.length) {
      throw new BadRequestException("Duplicate timeEntryIds are not allowed");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const billingClient = await tx.billingClient.findFirst({
          where: { id: dto.billingClientId, organizationId: orgId },
          select: { id: true },
        });
        if (!billingClient) {
          throw new ForbiddenException("Billing client does not belong to this organization");
        }

        const timeEntries = await tx.timeEntry.findMany({
          where: { id: { in: timeEntryIds }, organizationId: orgId },
          select: { id: true, invoiceLineItemId: true },
        });
        const foundIds = new Set(timeEntries.map((entry) => entry.id));
        const missingIds = timeEntryIds.filter((id) => !foundIds.has(id));
        if (missingIds.length > 0) {
          throw new BadRequestException(
            `Time entries not found or not in this organization: ${missingIds.join(", ")}`,
          );
        }

        const alreadyBilledIds = timeEntries
          .filter((entry) => entry.invoiceLineItemId !== null)
          .map((entry) => entry.id);
        if (alreadyBilledIds.length > 0) {
          throw new BadRequestException(
            `Time entries already billed: ${alreadyBilledIds.join(", ")}`,
          );
        }

        const lastInvoice = await tx.invoice.findFirst({
          where: { organizationId: orgId },
          orderBy: { invoiceNumber: "desc" },
          select: { invoiceNumber: true },
        });

        let nextNumber = 1;
        if (lastInvoice) {
          const match = lastInvoice.invoiceNumber.match(/INV-(\d+)/);
          if (match) nextNumber = parseInt(match[1], 10) + 1;
        }
        const invoiceNumber = `INV-${String(nextNumber).padStart(4, "0")}`;

        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            type: fileId ? "uploaded" : "external",
            status: "draft",
            amount: dto.amount,
            externalReference: dto.externalReference,
            billingClientId: dto.billingClientId,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
            notes: dto.notes,
            uploadedFileId: fileId,
            projectId: dto.projectId,
            organizationId: orgId,
          },
        });

        const lineItem = await tx.invoiceLineItem.create({
          data: {
            invoiceId: invoice.id,
            description: `Recorded Digits invoice ${dto.externalReference}`,
            quantity: 1,
            unitPrice: dto.amount,
          },
        });

        const updated = await tx.timeEntry.updateMany({
          where: {
            id: { in: timeEntryIds },
            organizationId: orgId,
            invoiceLineItemId: null,
          },
          data: { invoiceLineItemId: lineItem.id },
        });
        if (updated.count !== timeEntryIds.length) {
          throw new BadRequestException("One or more time entries were already billed");
        }

        return tx.invoice.findUniqueOrThrow({
          where: { id: invoice.id },
          include: { lineItems: true },
        });
      }, { isolationLevel: "Serializable" });
    } catch (err) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "P2002" &&
        retries < 3
      ) {
        return this.recordExternalInvoice(dto, orgId, fileId, retries + 1);
      }
      throw err;
    }
  }

  async findAll(orgId: string, query: InvoiceListQueryDto) {
    const { page = 1, limit = 20, projectId, status } = query;
    const where: InvoiceWhereInput = { organizationId: orgId };
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          lineItems: true,
          uploadedFile: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginatedResponse(data, total, page, limit);
  }

  async exportAll(orgId: string) {
    return this.prisma.invoice.findMany({
      where: { organizationId: orgId },
      include: {
        lineItems: true,
        project: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, orgId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      include: {
        lineItems: true,
        uploadedFile: true,
        project: { select: { id: true, name: true } },
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    return invoice;
  }

  async findMine(userId: string, orgId: string, page = 1, limit = 20, projectId?: string) {
    const clientProjectsWhere: { userId: string; project: { organizationId: string; id?: string } } = {
      userId,
      project: { organizationId: orgId },
    };
    if (projectId) {
      clientProjectsWhere.project.id = projectId;
    }

    const clientProjects = await this.prisma.projectClient.findMany({
      where: clientProjectsWhere,
      select: { projectId: true },
    });
    const projectIds = clientProjects.map((pc) => pc.projectId);

    const where = {
      organizationId: orgId,
      projectId: { in: projectIds },
      status: { notIn: ["draft", "cancelled"] },
    };

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { lineItems: true, uploadedFile: true },
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginatedResponse(data, total, page, limit);
  }

  async findOneMine(id: string, userId: string, orgId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      include: {
        lineItems: true,
        uploadedFile: true,
        project: { select: { id: true, name: true } },
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");

    if (invoice.projectId) {
      const assignment = await this.prisma.projectClient.findFirst({
        where: { projectId: invoice.projectId, userId },
      });
      if (!assignment) {
        throw new ForbiddenException("Not assigned to this project");
      }
    } else {
      throw new ForbiddenException("Not assigned to this project");
    }

    return invoice;
  }

  async update(id: string, dto: UpdateInvoiceDto, orgId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");

    if (dto.status && dto.status !== invoice.status) {
      const allowedTransitions: Record<string, string[]> = {
        draft: ["sent"],
        sent: ["paid", "overdue", "cancelled"],
        overdue: ["paid", "cancelled"],
        paid: [],
        cancelled: [],
      };
      const allowed = allowedTransitions[invoice.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot transition from '${invoice.status}' to '${dto.status}'`,
        );
      }
    }

    const isTransitionToSent =
      dto.status === "sent" && invoice.status !== "sent";

    const dueDateValue =
      dto.dueDate === null
        ? null
        : dto.dueDate
          ? new Date(dto.dueDate)
          : undefined;

    let updated;

    if (dto.lineItems) {
      updated = await this.prisma.$transaction(async (tx) => {
        await tx.invoiceLineItem.deleteMany({
          where: { invoiceId: id, invoice: { organizationId: orgId } },
        });
        return tx.invoice.update({
          where: { id, organizationId: orgId },
          data: {
            status: dto.status,
            dueDate: dueDateValue,
            notes: dto.notes,
            lineItems: {
              create: dto.lineItems!.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
              })),
            },
          },
          include: { lineItems: true },
        });
      });
    } else {
      updated = await this.prisma.invoice.update({
        where: { id, organizationId: orgId },
        data: {
          status: dto.status,
          dueDate: dueDateValue,
          notes: dto.notes,
        },
        include: { lineItems: true },
      });
    }

    if (isTransitionToSent) {
      this.notifications.notifyInvoiceSent(id);
    }

    return updated;
  }

  async remove(id: string, orgId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");

    if (invoice.stripePaymentIntentId) {
      throw new BadRequestException(
        "Cannot delete an invoice that was paid via Stripe. The payment record must be preserved.",
      );
    }

    await this.prisma.invoice.delete({ where: { id, organizationId: orgId } });
  }

  async getStats(orgId: string, projectId?: string) {
    const where: InvoiceWhereInput = { organizationId: orgId };
    if (projectId) where.projectId = projectId;

    const [counts, totals] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ["status"],
        where,
        _count: true,
      }),
      projectId
        ? this.prisma.$queryRaw<
            Array<{ status: string; total: bigint | number }>
          >`
          SELECT i.status,
            COALESCE(SUM(
              CASE WHEN i.type = 'uploaded' THEN COALESCE(i.amount, 0)
                   ELSE COALESCE(li.quantity * li."unitPrice", 0)
              END
            ), 0) as total
          FROM "invoice" i
          LEFT JOIN "invoice_line_item" li ON li."invoiceId" = i.id
          WHERE i."organizationId" = ${orgId} AND i."projectId" = ${projectId}
          GROUP BY i.status
        `
        : this.prisma.$queryRaw<
            Array<{ status: string; total: bigint | number }>
          >`
          SELECT i.status,
            COALESCE(SUM(
              CASE WHEN i.type = 'uploaded' THEN COALESCE(i.amount, 0)
                   ELSE COALESCE(li.quantity * li."unitPrice", 0)
              END
            ), 0) as total
          FROM "invoice" i
          LEFT JOIN "invoice_line_item" li ON li."invoiceId" = i.id
          WHERE i."organizationId" = ${orgId}
          GROUP BY i.status
        `,
    ]);

    const totalInvoices = counts.reduce((sum, c) => sum + c._count, 0);

    let totalAmount = 0;
    let paidAmount = 0;
    let outstandingAmount = 0;

    for (const row of totals) {
      const amount = Number(row.total);
      totalAmount += amount;
      if (row.status === "paid") {
        paidAmount += amount;
      } else if (row.status === "sent" || row.status === "overdue") {
        outstandingAmount += amount;
      }
    }

    return { totalInvoices, totalAmount, paidAmount, outstandingAmount };
  }
}
