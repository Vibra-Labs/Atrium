import { describe, expect, it, mock } from "bun:test";
import { TwoFactorController } from "./two-factor.controller";
import type { AuthenticatedRequest } from "../common";

function build() {
  const service = {
    getStatus: mock(() => Promise.resolve({ enabled: false })),
    setRequirement: mock(() => Promise.resolve({ required: true })),
    resetForMember: mock(() => Promise.resolve({ success: true })),
  };
  const config = { get: (key: string): string | undefined => (key === "BILLING_ENABLED" ? "true" : undefined) };
  return { controller: new TwoFactorController(service as never, config as never), service };
}

describe("TwoFactorController", () => {
  it("reads status for the caller's session and active workspace", async () => {
    const { controller, service } = build();
    const req = {
      user: { id: "u1" },
      session: { secondFactor: "totp" },
      organization: { id: "org1" },
      member: { role: "admin" },
    } as unknown as AuthenticatedRequest;
    await controller.status(req);
    expect(service.getStatus).toHaveBeenCalledWith({
      userId: "u1",
      secondFactor: "totp",
      organizationId: "org1",
      role: "admin",
    });
  });

  it("lets only owners change the workspace requirement", () => {
    const roles: unknown = Reflect.getMetadata("roles", TwoFactorController.prototype.setRequirement);
    expect(roles).toEqual(["owner"]);
  });

  it("changes the requirement for the active workspace", async () => {
    const { controller, service } = build();
    await controller.setRequirement({ required: true }, "u1", "org1");
    expect(service.setRequirement).toHaveBeenCalledWith("u1", "org1", true);
  });
  it("lets owners and admins reset a member's two-factor", () => {
    const roles: unknown = Reflect.getMetadata("roles", TwoFactorController.prototype.resetForMember);
    expect(roles).toEqual(["owner", "admin"]);
  });

  it("resets with the actor's role, code and headers", async () => {
    const { controller, service } = build();
    const req = {
      user: { id: "owner1" },
      member: { role: "owner" },
      organization: { id: "org1" },
      headers: { cookie: "c=1" },
    } as unknown as AuthenticatedRequest;
    await controller.resetForMember("admin1", { code: "123456" }, req);
    const call = (service.resetForMember.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call).toMatchObject({
      actorId: "owner1",
      actorRole: "owner",
      organizationId: "org1",
      targetUserId: "admin1",
      code: "123456",
      hosted: true,
    });
    expect((call.headers as Headers).get("cookie")).toBe("c=1");
  });
});
