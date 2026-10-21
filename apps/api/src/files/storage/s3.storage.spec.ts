import { describe, expect, it, mock } from "bun:test";
import { Readable } from "stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import type { ConfigService } from "@nestjs/config";
import { S3Storage } from "./s3.storage";

const config = {
  get: (_key: string, fallback?: string): string | undefined => fallback,
  getOrThrow: (): string => "test-key",
} as unknown as ConfigService;

type Send = (command: unknown) => Promise<unknown>;

function storageWithSend(send: Send): S3Storage {
  const storage = new S3Storage(config);
  (storage as unknown as { client: { send: Send } }).client.send = mock(send);
  return storage;
}

describe("S3Storage.upload", () => {
  it("streams a small body as one PutObject with its length and content type", async () => {
    const sent: unknown[] = [];
    const storage = storageWithSend(async (command) => {
      sent.push(command);
      return {};
    });
    const content = Buffer.from("hello s3");

    await storage.upload("org/proj/file.txt", Readable.from(content), content.length, "text/plain");

    expect(sent).toHaveLength(1);
    const put = sent[0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input.Bucket).toBe("atrium");
    expect(put.input.Key).toBe("org/proj/file.txt");
    expect(put.input.ContentType).toBe("text/plain");
    expect(put.input.ContentLength).toBe(content.length);
    expect(Buffer.from(put.input.Body as Uint8Array).toString()).toBe("hello s3");
  });

  it("sends a body over 5 MB as a multipart upload: create, two parts, complete", async () => {
    const sent: unknown[] = [];
    const storage = storageWithSend(async (command) => {
      sent.push(command);
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: "up-1" };
      if (command instanceof UploadPartCommand) return { ETag: `"etag-${command.input.PartNumber}"` };
      return {};
    });
    const content = Buffer.alloc(6 * 1024 * 1024, 7);

    await storage.upload("big.bin", Readable.from([content]), content.length, "application/octet-stream");

    expect(sent.map((c) => (c as object).constructor.name)).toEqual([
      "CreateMultipartUploadCommand",
      "UploadPartCommand",
      "UploadPartCommand",
      "CompleteMultipartUploadCommand",
    ]);
    const complete = sent[3] as CompleteMultipartUploadCommand;
    expect(complete.input.UploadId).toBe("up-1");
    expect(complete.input.MultipartUpload?.Parts?.map((p) => p.PartNumber)).toEqual([1, 2]);
  });

  it("aborts the multipart upload when a part fails", async () => {
    const sent: unknown[] = [];
    const storage = storageWithSend(async (command) => {
      sent.push(command);
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: "up-2" };
      if (command instanceof UploadPartCommand) throw new Error("part failed");
      return {};
    });
    const content = Buffer.alloc(6 * 1024 * 1024, 7);

    const err = await storage
      .upload("big.bin", Readable.from([content]), content.length, "application/octet-stream")
      .catch((e: Error) => e);

    expect((err as Error).message).toBe("part failed");
    const abort = sent.find((c) => c instanceof AbortMultipartUploadCommand) as AbortMultipartUploadCommand | undefined;
    expect(abort?.input.UploadId).toBe("up-2");
    expect(sent.some((c) => c instanceof CompleteMultipartUploadCommand)).toBe(false);
  });

  it("rethrows a storage error and destroys the source stream", async () => {
    const storage = storageWithSend(async () => {
      throw new Error("bucket gone");
    });
    const body = Readable.from(Buffer.from("x"));

    const err = await storage.upload("k", body, 1, "text/plain").catch((e: Error) => e);

    expect((err as Error).message).toBe("bucket gone");
    expect(body.destroyed).toBe(true);
  });
});
