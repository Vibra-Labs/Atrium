import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageProvider } from "./storage.interface";
import { Readable } from "stream";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class S3Storage implements StorageProvider {
  protected readonly logger = new Logger(S3Storage.name);
  protected client: S3Client;
  protected bucket: string;

  constructor(protected config: ConfigService) {
    const endpoint = this.config.get("S3_ENDPOINT");
    this.bucket = this.config.get("S3_BUCKET", "atrium");

    this.client = new S3Client({
      region: this.config.get("S3_REGION", "us-east-1"),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: this.config.getOrThrow("S3_ACCESS_KEY"),
        secretAccessKey: this.config.getOrThrow("S3_SECRET_KEY"),
      },
    });
  }

  /**
   * Streams via lib-storage: one PutObject for bodies up to 5 MB, otherwise a
   * multipart upload holding at most a few 5 MB parts in memory. A failed
   * multipart upload is aborted so no orphaned parts are left in the bucket.
   */
  async upload(key: string, body: Readable, size: number, contentType: string): Promise<void> {
    try {
      await new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: size,
        },
      }).done();
    } catch (err) {
      this.logger.warn(`Upload of ${key} failed: ${err instanceof Error ? err.message : String(err)}`);
      body.destroy();
      throw err;
    }
  }

  async download(
    key: string,
  ): Promise<{ body: Readable; contentType: string }> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    return {
      body: response.Body as Readable,
      contentType: response.ContentType || "application/octet-stream",
    };
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}
