import { Module } from "@nestjs/common";
import { EmbedsController } from "./embeds.controller";
import { EmbedsService } from "./embeds.service";
import { UnfurlService } from "./unfurl.service";

@Module({
  controllers: [EmbedsController],
  providers: [EmbedsService, UnfurlService],
  exports: [EmbedsService, UnfurlService],
})
export class EmbedsModule {}
