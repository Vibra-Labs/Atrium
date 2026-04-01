import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { InvoicesService } from "./invoices.service";

@Injectable()
export class InvoiceRecurringTask {
  private readonly logger = new Logger(InvoiceRecurringTask.name);

  constructor(
    private prisma: PrismaService,
    private invoicesService: InvoicesService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async fireRecurringInvoices() {
    const now = new Date();

    const due = await this.prisma.recurringInvoice.findMany({
      where: { isActive: true, nextRunAt: { lte: now } },
      include: { lineItems: true },
    });

    if (due.length === 0) return;

    this.logger.log(`Processing ${due.length} recurring invoice(s)`);

    for (const recurring of due) {
      try {
        await this.invoicesService.fireRecurringInvoice(recurring);
        this.logger.log(`Fired recurring invoice ${recurring.id} for org ${recurring.organizationId}`);
      } catch (err) {
        this.logger.error(`Failed to fire recurring invoice ${recurring.id}`, err);
      }
    }
  }
}
