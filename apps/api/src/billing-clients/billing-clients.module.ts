import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { BillingClientsController } from "./billing-clients.controller";
import { BillingClientsService } from "./billing-clients.service";

@Module({
  imports: [PrismaModule],
  controllers: [BillingClientsController],
  providers: [BillingClientsService],
  exports: [BillingClientsService],
})
export class BillingClientsModule {}
