import { describe, expect, it, mock } from "bun:test";
import { HttpException } from "@nestjs/common";
import { HealthController } from "./health.controller";
import type { PrismaService } from "./prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";

const makePrisma = (opts: { dbOk: boolean; org?: object | null }) => ({
  $queryRaw: opts.dbOk
    ? mock(() => Promise.resolve([1]))
    : mock(() => Promise.reject(new Error("Connection refused"))),
  organization: {
    findUnique: mock(() => Promise.resolve(opts.org ?? null)),
  },
});

function makeRes() {
  const codes: number[] = [];
  const send = mock(() => {});
  const status = mock((code: number) => { codes.push(code); return { send } as unknown as Response; });
  return { status, send, _codes: codes } as unknown as Response & { status: typeof status; _codes: number[] };
}

function makeReq(ip: string) {
  return { socket: { remoteAddress: ip } } as unknown as Request;
}

const makeConfig = (vals: Record<string, string> = {}) =>
  ({ get: (key: string) => vals[key] }) as unknown as ConfigService;

describe("HealthController", () => {
  it("returns ok status when DB is connected", async () => {
    const controller = new HealthController(makePrisma({ dbOk: true }) as unknown as PrismaService, makeConfig());
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.database).toBe("connected");
    expect(result.timestamp).toBeDefined();
  });

  it("throws 503 when DB fails", async () => {
    const controller = new HealthController(makePrisma({ dbOk: false }) as unknown as PrismaService, makeConfig());
    try {
      await controller.check();
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const err = e as HttpException;
      expect(err.getStatus()).toBe(503);
      const body = err.getResponse() as Record<string, unknown>;
      expect(body.status).toBe("degraded");
      expect(body.database).toBe("disconnected");
    }
  });

  describe("domainCheck", () => {
    it("returns 403 for non-loopback callers", async () => {
      const controller = new HealthController(makePrisma({ dbOk: true }) as unknown as PrismaService, makeConfig());
      const res = makeRes();
      await controller.domainCheck("example.com", makeReq("8.8.8.8"), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("returns 400 when domain param is missing", async () => {
      const controller = new HealthController(makePrisma({ dbOk: true }) as unknown as PrismaService, makeConfig());
      const res = makeRes();
      await controller.domainCheck("", makeReq("127.0.0.1"), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns 200 for a registered domain from loopback", async () => {
      const controller = new HealthController(makePrisma({ dbOk: true, org: { id: "org-1" } }) as unknown as PrismaService, makeConfig());
      const res = makeRes();
      await controller.domainCheck("portal.acme.com", makeReq("127.0.0.1"), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("returns 404 for an unregistered domain from loopback", async () => {
      const controller = new HealthController(makePrisma({ dbOk: true, org: null }) as unknown as PrismaService, makeConfig());
      const res = makeRes();
      await controller.domainCheck("unknown.com", makeReq("127.0.0.1"), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
