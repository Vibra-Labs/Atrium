import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { PayloadTooLargeException } from "@nestjs/common";
import { Readable } from "stream";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { defer, lastValueFrom, type Observable } from "rxjs";
import { TempFileInterceptor } from "./temp-file.interceptor";

interface FakeRequest extends Readable {
  headers: Record<string, string>;
  file?: { path: string; size: number; originalname: string };
  body?: Record<string, unknown>;
}

const BOUNDARY = "----atriumTestBoundary";

function multipartHead(filename: string): Buffer {
  return Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      "Content-Type: application/octet-stream\r\n\r\n",
  );
}

function multipartBody(filename: string, content: Buffer): Buffer {
  return Buffer.concat([multipartHead(filename), content, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]);
}

function fakeRequest(stream: Readable, contentLength: number): FakeRequest {
  const req = stream as FakeRequest;
  req.headers = {
    "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
    "content-length": String(contentLength),
  };
  return req;
}

function context(req: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

function handler(fn: () => Promise<unknown>): CallHandler {
  return { handle: (): Observable<unknown> => defer(fn) };
}

async function run(interceptor: NestInterceptor, req: FakeRequest, next: CallHandler): Promise<unknown> {
  const out = await interceptor.intercept(context(req), next);
  return lastValueFrom(out as Observable<unknown>);
}

/** Let fire-and-forget unlinks settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("TempFileInterceptor", () => {
  let dir: string;

  beforeEach(async () => {
    dir = path.join(tmpdir(), `atrium-temp-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes the upload to a temp file, exposes its path, and deletes it after the handler succeeds", async () => {
    const Interceptor = TempFileInterceptor("file", 1024 * 1024, dir);
    const content = Buffer.from("hello streaming world");
    const body = multipartBody("hello.txt", content);
    const req = fakeRequest(Readable.from([body]), body.length);

    let seenPath = "";
    let seenContent = "";
    const result = await run(new Interceptor(), req, handler(async () => {
      seenPath = req.file?.path ?? "";
      seenContent = await fs.readFile(seenPath, "utf8");
      return "ok";
    }));
    await settle();

    expect(result).toBe("ok");
    expect(seenContent).toBe("hello streaming world");
    expect(req.file?.size).toBe(content.length);
    expect(path.dirname(seenPath)).toBe(dir);
    expect(existsSync(seenPath)).toBe(false);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("deletes the temp file when the handler throws", async () => {
    const Interceptor = TempFileInterceptor("file", 1024 * 1024, dir);
    const body = multipartBody("x.pdf", Buffer.alloc(4096, 1));
    const req = fakeRequest(Readable.from([body]), body.length);

    let seenPath = "";
    const err = await run(new Interceptor(), req, handler(async () => {
      seenPath = req.file?.path ?? "";
      throw new Error("storage down");
    })).catch((e: Error) => e);
    await settle();

    expect((err as Error).message).toBe("storage down");
    expect(seenPath).not.toBe("");
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("rejects files over the size limit and leaves no temp file", async () => {
    const Interceptor = TempFileInterceptor("file", 1024, dir);
    const body = multipartBody("big.bin", Buffer.alloc(64 * 1024, 2));
    const req = fakeRequest(Readable.from([body]), body.length);

    let called = false;
    const err = await run(new Interceptor(), req, handler(async () => {
      called = true;
    })).catch((e: Error) => e);
    await settle();

    expect(err).toBeInstanceOf(PayloadTooLargeException);
    expect(called).toBe(false);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("deletes the partial temp file when the client aborts mid-upload", async () => {
    const Interceptor = TempFileInterceptor("file", 1024 * 1024, dir);
    const stream = new Readable({ read(): void {} });
    const req = fakeRequest(stream, 100_000);
    stream.push(multipartHead("partial.bin"));
    stream.push(Buffer.alloc(8192, 3));
    setTimeout(() => stream.destroy(new Error("aborted")), 30);

    let called = false;
    const err = await run(new Interceptor(), req, handler(async () => {
      called = true;
    })).catch((e: Error) => e);
    await settle();

    expect(err).toBeInstanceOf(Error);
    expect(called).toBe(false);
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
