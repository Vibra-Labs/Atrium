import { Module } from "@nestjs/common";
import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";
import { ContactSyncModule } from "../contact-sync/contact-sync.module";
import { FilesModule } from "../files/files.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [FilesModule, ContactSyncModule, AuthModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
