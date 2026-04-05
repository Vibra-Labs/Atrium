import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BrandingController } from "./branding.controller";
import { BrandingService } from "./branding.service";
import { FilesModule } from "../files/files.module";

@Module({
  imports: [FilesModule, ConfigModule],
  controllers: [BrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
