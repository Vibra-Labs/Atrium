import { Global, Module } from "@nestjs/common";
import { DemoService } from "./demo.service";

/**
 * DemoService on its own, global, and with no dependencies of its own beyond
 * Prisma and config.
 *
 * Separate from DemoModule because that one imports AuthModule for the entry
 * controller. DemoService is needed by the global DemoGuard, by
 * OrganizationController and by anything else that has to ask "is this the
 * demo workspace?", and none of them should have to pull AuthModule in — or
 * risk a module cycle — to find out.
 */
@Global()
@Module({
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoCoreModule {}
