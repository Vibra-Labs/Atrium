import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DemoController } from "./demo.controller";
import { DemoService } from "./demo.service";

@Module({
  imports: [AuthModule],
  controllers: [DemoController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
