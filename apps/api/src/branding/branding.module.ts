import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BrandingController } from "./branding.controller";
import { BrandingService } from "./branding.service";
import { FilesModule } from "../files/files.module";
import { BillingModule } from "../billing/billing.module";

@Module({
  imports: [FilesModule, ConfigModule, BillingModule],
  controllers: [BrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
