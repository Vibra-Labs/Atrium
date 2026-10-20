import { Module } from "@nestjs/common";
import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";
import { ContactSyncModule } from "../contact-sync/contact-sync.module";
import { FilesModule } from "../files/files.module";

@Module({
  imports: [FilesModule, ContactSyncModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
