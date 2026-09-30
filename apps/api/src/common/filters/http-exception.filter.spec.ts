import { describe, expect, it, mock } from "bun:test";
import { BadRequestException, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { AllExceptionsFilter } from "./http-exception.filter";

function buildHost() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status: mock((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: mock((b: unknown) => {
      res.body = b;
      return res;
    }),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

function buildFilter(): AllExceptionsFilter {
  const filter = new AllExceptionsFilter();
  // The 500 branch logs on purpose; keep the test output pristine.
  (filter as unknown as { logger: { error: () => void } }).logger = { error: mock(() => {}) };
  return filter;
}

/** What body-parser throws; Express marks client-safe ones `expose: true`. */
function bodyParserError(type: string, status: number, message: string): Error {
  return Object.assign(new Error(message), { type, status, statusCode: status, expose: true });
}

describe("AllExceptionsFilter", () => {
  it("passes an HttpException through with its own status and message", () => {
    const { host, res } = buildHost();
    buildFilter().catch(new BadRequestException("name is required"), host);
    expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body).toMatchObject({ statusCode: 400, message: "name is required" });
  });

  it("hides an unexpected error behind a 500", () => {
    const { host, res } = buildHost();
    buildFilter().catch(new Error("connect ECONNREFUSED 127.0.0.1:5432"), host);
    expect(res.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.body).toEqual({
      statusCode: 500,
      message: "Internal server error",
      error: "Internal Server Error",
    });
  });

  it("reports an oversized body as 413, not as a server fault", () => {
    const { host, res } = buildHost();
    buildFilter().catch(
      bodyParserError("entity.too.large", 413, "request entity too large"),
      host,
    );
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({
      statusCode: 413,
      message: "request entity too large",
      error: "Payload Too Large",
    });
  });

  it("reports malformed JSON as 400", () => {
    const { host, res } = buildHost();
    buildFilter().catch(
      bodyParserError("entity.parse.failed", 400, "Unexpected token } in JSON at position 4"),
      host,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ statusCode: 400, error: "Bad Request" });
  });

  it("does not leak an error that merely carries a status", () => {
    const { host, res } = buildHost();
    // No `expose`, so the message is not the client's business.
    const err = Object.assign(new Error("internal detail"), { status: 400 });
    buildFilter().catch(err, host);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ message: "Internal server error" });
  });

  it("does not honour a 5xx or out-of-range status on a plain error", () => {
    const { host, res } = buildHost();
    for (const status of [500, 503, 302, 999]) {
      const err = Object.assign(new Error("nope"), { status, expose: true });
      buildFilter().catch(err, host);
      expect(res.statusCode).toBe(500);
    }
  });
});
