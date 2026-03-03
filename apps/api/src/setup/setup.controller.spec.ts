import { describe, test, expect, beforeEach, mock } from "bun:test";
import { SetupController } from "./setup.controller";
import type { SetupService } from "./setup.service";
import type { SettingsService } from "../settings/settings.service";

// --- Mock services ---

function makeSetupService() {
  return {
    getSetupStatus: mock(() => Promise.resolve({ completed: false })),
    markSetupComplete: mock(() => Promise.resolve({ completed: true })),
  };
}

function makeSettingsService() {
  return {
    updateSettings: mock(() => Promise.resolve({ emailProvider: null })),
    testEmailConfig: mock(() =>
      Promise.resolve({ success: true, message: "Test email sent" }),
    ),
  };
}

describe("SetupController", () => {
  let controller: SetupController;
  let setupService: ReturnType<typeof makeSetupService>;
  let settingsService: ReturnType<typeof makeSettingsService>;

  const orgId = "org-1";

  beforeEach(() => {
    setupService = makeSetupService();
    settingsService = makeSettingsService();
    controller = new SetupController(
      setupService as unknown as SetupService,
      settingsService as unknown as SettingsService,
    );
  });

  // --- GET /setup/status ---

  test("getSetupStatus returns setup status from SetupService", async () => {
    const result = await controller.getSetupStatus(orgId);

    expect(setupService.getSetupStatus).toHaveBeenCalledWith(orgId);
    expect(result).toEqual({ completed: false });
  });

  test("getSetupStatus returns completed:true when setup is done", async () => {
    setupService.getSetupStatus.mockImplementation(() =>
      Promise.resolve({ completed: true }),
    );

    const result = await controller.getSetupStatus(orgId);

    expect(result).toEqual({ completed: true });
  });

  // --- POST /setup/complete ---

  test("markComplete delegates to SetupService.markSetupComplete", async () => {
    const result = await controller.markComplete(orgId);

    expect(setupService.markSetupComplete).toHaveBeenCalledWith(orgId);
    expect(result).toEqual({ completed: true });
  });

  // --- PUT /setup/email ---

  test("updateEmailSettings delegates to SettingsService.updateSettings", async () => {
    const dto = {
      provider: "resend" as const,
      resendApiKey: "re_test_key",
      fromEmail: "noreply@company.com",
    };

    const result = await controller.updateEmailSettings(orgId, dto);

    expect(settingsService.updateSettings).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({
        emailProvider: "resend",
        resendApiKey: "re_test_key",
        emailFrom: "noreply@company.com",
      }),
    );
    expect(result).toEqual({ success: true, message: "Email settings saved" });
  });

  test("updateEmailSettings converts provider 'none' to null", async () => {
    const dto = { provider: "none" as const };

    await controller.updateEmailSettings(orgId, dto);

    expect(settingsService.updateSettings).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({ emailProvider: null }),
    );
  });

  test("updateEmailSettings passes SMTP settings to SettingsService", async () => {
    const dto = {
      provider: "smtp" as const,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUser: "user@example.com",
      smtpPass: "secret",
      smtpSecure: false,
      fromEmail: "sender@example.com",
    };

    await controller.updateEmailSettings(orgId, dto);

    expect(settingsService.updateSettings).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({
        emailProvider: "smtp",
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpUser: "user@example.com",
        smtpPass: "secret",
        smtpSecure: false,
        emailFrom: "sender@example.com",
      }),
    );
  });

  test("updateEmailSettings returns success message on completion", async () => {
    const dto = { provider: "resend" as const };
    const result = await controller.updateEmailSettings(orgId, dto);

    expect(result).toEqual({ success: true, message: "Email settings saved" });
  });

  // --- POST /setup/test-email ---

  test("sendTestEmail delegates to SettingsService.testEmailConfig", async () => {
    const dto = { to: "test@recipient.com" };

    const result = await controller.sendTestEmail(orgId, dto);

    expect(settingsService.testEmailConfig).toHaveBeenCalledWith(
      orgId,
      "test@recipient.com",
    );
    expect(result).toEqual({ success: true, message: "Test email sent" });
  });

  test("sendTestEmail returns failure result when testEmailConfig returns failure", async () => {
    settingsService.testEmailConfig.mockImplementation(() =>
      Promise.resolve({
        success: false,
        message: "No email provider configured",
      }),
    );

    const result = await controller.sendTestEmail(orgId, { to: "x@test.com" });

    expect(result.success).toBe(false);
    expect(result.message).toBe("No email provider configured");
  });
});
