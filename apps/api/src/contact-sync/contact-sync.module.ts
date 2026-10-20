import { Module } from "@nestjs/common";
import { ContactSyncService } from "./contact-sync.service";
import { ContactBackfillService } from "./contact-backfill.service";

@Module({
  providers: [ContactSyncService, ContactBackfillService],
  exports: [ContactSyncService],
})
export class ContactSyncModule {}
