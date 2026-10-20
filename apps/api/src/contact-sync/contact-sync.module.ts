import { Module } from "@nestjs/common";
import { ContactSyncService } from "./contact-sync.service";

@Module({
  providers: [ContactSyncService],
  exports: [ContactSyncService],
})
export class ContactSyncModule {}
