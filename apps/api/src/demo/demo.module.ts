import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DemoController } from "./demo.controller";
import { DemoCoreModule } from "./demo-core.module";
import { DemoResetService } from "./demo-reset.service";
import { DemoResetTask } from "./demo-reset.task";

@Module({
  imports: [AuthModule, DemoCoreModule],
  controllers: [DemoController],
  providers: [DemoResetService, DemoResetTask],
})
export class DemoModule {}
