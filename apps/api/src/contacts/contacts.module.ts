import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { CompaniesController } from "./companies.controller";
import { ContactsService } from "./contacts.service";
import { CompaniesService } from "./companies.service";
import { LeadSourcesController } from "./lead-sources.controller";
import { LeadSourcesService } from "./lead-sources.service";
import { ContactRevenueService } from "./contact-revenue.service";

@Module({
  controllers: [ContactsController, CompaniesController, LeadSourcesController],
  providers: [ContactsService, CompaniesService, LeadSourcesService, ContactRevenueService],
  exports: [ContactRevenueService],
})
export class ContactsModule {}
