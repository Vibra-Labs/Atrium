import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { CompaniesController } from "./companies.controller";
import { ContactsService } from "./contacts.service";
import { CompaniesService } from "./companies.service";
import { ContactRevenueService } from "./contact-revenue.service";

@Module({
  controllers: [ContactsController, CompaniesController],
  providers: [ContactsService, CompaniesService, ContactRevenueService],
  exports: [ContactRevenueService],
})
export class ContactsModule {}
