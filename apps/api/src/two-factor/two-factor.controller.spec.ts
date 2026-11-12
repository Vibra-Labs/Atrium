import { describe, expect, it, mock } from "bun:test";
import { TwoFactorController } from "./two-factor.controller";
import type { AuthenticatedRequest } from "../common";

function build() {
  const service = {
    getStatus: mock(() => Promise.resolve({ enabled: false })),
    setRequirement: mock(() => Promise.resolve({ required: true })),
  };
  return { controller: new TwoFactorController(service as never), service };
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
});
