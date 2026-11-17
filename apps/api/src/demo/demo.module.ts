import { Module } from "@nestjs/common";
import { DemoService } from "./demo.service";

@Module({
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
