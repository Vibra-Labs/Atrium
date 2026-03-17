import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { NotificationsModule } from "../notifications/notifications.module";
import { FilesModule } from "../files/files.module";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { InvoicePdfService } from "./invoice-pdf.service";
import { InvoiceOverdueTask } from "./invoice-overdue.task";

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule, FilesModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicePdfService, InvoiceOverdueTask],
  exports: [InvoicesService],
})
export class InvoicesModule {}
