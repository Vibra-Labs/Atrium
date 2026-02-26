import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { SettingsModule } from "../settings/settings.module";
import { STORAGE_PROVIDER } from "./storage/storage.interface";
import { LocalStorage } from "./storage/local.storage";
import { S3Storage } from "./storage/s3.storage";
import { MinioStorage } from "./storage/minio.storage";
import { R2Storage } from "./storage/r2.storage";

@Module({
  imports: [SettingsModule],
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (config: ConfigService) => {
        const provider = config.get("STORAGE_PROVIDER", "local");
        switch (provider) {
          case "s3":
            return new S3Storage(config);
          case "minio":
            return new MinioStorage(config);
          case "r2":
            return new R2Storage(config);
          default:
            return new LocalStorage(config);
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [FilesService, STORAGE_PROVIDER],
})
export class FilesModule {}
