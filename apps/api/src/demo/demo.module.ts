import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DemoController } from "./demo.controller";
import { DemoResetService } from "./demo-reset.service";
import { DemoResetTask } from "./demo-reset.task";
import { DemoService } from "./demo.service";

@Module({
  imports: [AuthModule],
  controllers: [DemoController],
  providers: [DemoService, DemoResetService, DemoResetTask],
  exports: [DemoService],
})
export class DemoModule {}
