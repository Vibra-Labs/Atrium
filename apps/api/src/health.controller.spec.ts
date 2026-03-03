import { describe, expect, it, mock } from "bun:test";
import { HttpException } from "@nestjs/common";
import { HealthController } from "./health.controller";
import type { PrismaService } from "./prisma/prisma.service";

describe("HealthController", () => {
  it("returns ok status when DB is connected", async () => {
    const mockPrisma = { $queryRaw: mock(() => Promise.resolve([1])) };
    const controller = new HealthController(mockPrisma as unknown as PrismaService);

    const result = await controller.check();

    expect(result.status).toBe("ok");
    expect(result.database).toBe("connected");
    expect(result.timestamp).toBeDefined();
  });

  it("throws 503 when DB fails", async () => {
    const mockPrisma = {
      $queryRaw: mock(() => Promise.reject(new Error("Connection refused"))),
    };
    const controller = new HealthController(mockPrisma as unknown as PrismaService);

    try {
      await controller.check();
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const err = e as HttpException;
      expect(err.getStatus()).toBe(503);
      const body = err.getResponse() as Record<string, unknown>;
      expect(body.status).toBe("degraded");
      expect(body.database).toBe("disconnected");
    }
  });
});
