import {
  Injectable,
  Logger,
  mixin,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type Type,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import type { StorageEngine } from "multer";
import { randomBytes } from "crypto";
import { createWriteStream } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pipeline } from "stream/promises";
import { finalize, type Observable } from "rxjs";

const logger = new Logger("TempFileUpload");

async function removeTempFile(filePath: string | undefined): Promise<void> {
  if (!filePath) return;
  try {
    await rm(filePath, { force: true });
  } catch (err) {
    logger.error(`Failed to remove temp upload ${filePath}`, err instanceof Error ? err.stack : String(err));
  }
}

/**
 * multer disk engine. Unlike multer's own diskStorage, it deletes the partial
 * file when the request stream dies mid-file (client abort), instead of
 * leaving it in the temp dir with an open descriptor.
 */
function tempDiskStorage(dir: string): StorageEngine {
  return {
    _handleFile(_req, file, cb): void {
      const filePath = join(dir, `atrium-upload-${randomBytes(16).toString("hex")}`);
      const out = createWriteStream(filePath, { mode: 0o600 });
      pipeline(file.stream, out).then(
        () => cb(null, { path: filePath, size: out.bytesWritten }),
        async (err: Error) => {
          await removeTempFile(filePath);
          cb(err);
        },
      );
    },
    _removeFile(_req, file, cb): void {
      removeTempFile(file.path).then(() => cb(null));
    },
  };
}

/**
 * Like `FileInterceptor(field)`, but streams the upload to a temp file
 * (`req.file.path`, no `buffer`) and deletes that file once the request is
 * handled, on every path: success, validation or storage error, oversize
 * (multer still enforces `maxBytes` while streaming) and client abort.
 */
export function TempFileInterceptor(
  fieldName: string,
  maxBytes: number,
  dir: string = tmpdir(),
): Type<NestInterceptor> {
  const Multer: Type<NestInterceptor> = FileInterceptor(fieldName, {
    storage: tempDiskStorage(dir),
    limits: { fileSize: maxBytes },
  });

  @Injectable()
  class TempFileMixin implements NestInterceptor {
    private readonly multer: NestInterceptor = new Multer();

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      const req = context.switchToHttp().getRequest<Request>();
      const handled = (await this.multer.intercept(context, next)) as Observable<unknown>;
      return handled.pipe(finalize(() => void removeTempFile(req.file?.path)));
    }
  }

  return mixin(TempFileMixin);
}
