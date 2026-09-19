import { describe, expect, it, mock } from "bun:test";
import { ForbiddenException } from "@nestjs/common";
import { ApiKeysController } from "./api-keys.controller";
import type { AuthenticatedRequest } from "../common";

function build() {
  const service = {
    create: mock(() => Promise.resolve({ id: "k1", name: "Agent", keyPrefix: "atr_abcdefgh", key: "atr_full", createdAt: new Date() })),
    list: mock(() => Promise.resolve([])),
    revoke: mock(() => Promise.resolve()),
  };
  return { controller: new ApiKeysController(service as never), service };
}

describe("ApiKeysController", () => {
  it("creates a key for the current user and org", async () => {
    const { controller, service } = build();
    const result = await controller.create({ name: "Agent" }, {} as AuthenticatedRequest, "org1", "u1");
    expect(result.key).toBe("atr_full");
    expect(service.create).toHaveBeenCalledWith("Agent", "u1", "org1");
  });

  it("refuses to create a key when the request itself used an API key", async () => {
    const { controller, service } = build();
    const req = { apiKeyId: "k0" } as AuthenticatedRequest;
    let error: Error | null = null;
    try {
      await controller.create({ name: "Agent" }, req, "org1", "u1");
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("lists and revokes within the current org", async () => {
    const { controller, service } = build();
    await controller.list("org1");
    await controller.revoke("k1", "org1");
    expect(service.list).toHaveBeenCalledWith("org1");
    expect(service.revoke).toHaveBeenCalledWith("k1", "org1");
  });
});
