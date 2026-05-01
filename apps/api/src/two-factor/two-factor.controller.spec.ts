import { describe, expect, it, mock, beforeEach } from "bun:test";
import { TwoFactorController } from "./two-factor.controller";
import type { TwoFactorService } from "./two-factor.service";

const mockService = {
  getStatus: mock(() => Promise.resolve({ enabled: false, requiredByOrg: false })),
  disableForUser: mock(() => Promise.resolve({ success: true })),
};

function clearMocks() {
  mockService.getStatus.mockClear();
  mockService.disableForUser.mockClear();
}

function buildController() {
  return new TwoFactorController(mockService as unknown as TwoFactorService);
}

describe("TwoFactorController", () => {
  beforeEach(clearMocks);

  describe("GET /two-factor/status", () => {
    it("delegates to service.getStatus with current user and org", async () => {
      mockService.getStatus = mock(() =>
        Promise.resolve({ enabled: true, requiredByOrg: true }),
      );

      const result = await buildController().status("user-1", "org-1");

      expect(mockService.getStatus).toHaveBeenCalledWith("user-1", "org-1");
      expect(result).toEqual({ enabled: true, requiredByOrg: true });
    });
  });

  describe("DELETE /two-factor/admin/:userId", () => {
    it("delegates to service.disableForUser", async () => {
      const result = await buildController().disableForUser(
        "target-1",
        "actor-1",
        "org-1",
      );

      expect(mockService.disableForUser).toHaveBeenCalledWith(
        "actor-1",
        "target-1",
        "org-1",
      );
      expect(result).toEqual({ success: true });
    });
  });
});
