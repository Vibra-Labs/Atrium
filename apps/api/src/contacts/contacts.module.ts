import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { CompaniesController } from "./companies.controller";
import { ContactsService } from "./contacts.service";
import { CompaniesService } from "./companies.service";
import { LeadSourcesController } from "./lead-sources.controller";
import { LeadSourcesService } from "./lead-sources.service";
import { ContactRevenueService } from "./contact-revenue.service";
import { FollowUpTask } from "./follow-up.task";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [ContactsController, CompaniesController, LeadSourcesController],
  providers: [ContactsService, CompaniesService, LeadSourcesService, ContactRevenueService, FollowUpTask],
  exports: [ContactRevenueService],
})
export class ContactsModule {}
