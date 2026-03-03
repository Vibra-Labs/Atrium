import { describe, test, expect, beforeEach, mock } from "bun:test";
import { MailService } from "./mail.service";
import type { ConfigService } from "@nestjs/config";
import type { SettingsService } from "../settings/settings.service";
import type { PinoLogger } from "nestjs-pino";

// --- Module mocks ---

interface MockTransporter {
  _config: Record<string, unknown>;
  sendMail: ReturnType<typeof mock>;
}

// Track transporter instances created by nodemailer
const createdTransporters: MockTransporter[] = [];
const mockSendMail = mock(() => Promise.resolve({ messageId: "test-id" }));

mock.module("nodemailer", () => ({
  createTransport: mock((config: Record<string, unknown>) => {
    const transporter: MockTransporter = {
      _config: config,
      sendMail: mockSendMail,
    };
    createdTransporters.push(transporter);
    return transporter;
  }),
}));

const mockResendSend = mock(() => Promise.resolve({ data: { id: "resend-id" }, error: null }));

mock.module("resend", () => ({
  Resend: class {
    emails = { send: mockResendSend };
  },
}));

// --- Helpers ---

const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

function makeConfig(env: Record<string, string | undefined> = {}) {
  return {
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  };
}

interface EmailConfig {
  provider: string | null;
  from?: string;
  apiKey?: string | null;
  smtp?: Record<string, unknown> | null;
}

function makeSettingsService(emailConfig: EmailConfig | null = null) {
  return {
    getEffectiveEmailConfig: mock(() => Promise.resolve(emailConfig)),
  };
}

describe("MailService", () => {
  beforeEach(() => {
    createdTransporters.length = 0;
    mockSendMail.mockClear();
    mockResendSend.mockClear();
  });

  // --- SMTP transporter caching ---

  test("SMTP transporter is cached and reused for the same config", async () => {
    const smtpConfig = {
      host: "smtp.example.com",
      port: 587,
      user: "user@example.com",
      pass: "secret",
      secure: false,
    };

    const settings = makeSettingsService({
      provider: "smtp",
      from: "noreply@example.com",
      smtp: smtpConfig,
    });

    const config = makeConfig();
    const service = new MailService(
      config as unknown as ConfigService,
      settings as unknown as SettingsService,
      mockLogger as unknown as PinoLogger,
    );

    await service.send("a@test.com", "Subject 1", "<p>First</p>", "org-1");
    await service.send("b@test.com", "Subject 2", "<p>Second</p>", "org-1");

    // Only one transporter should have been created
    expect(createdTransporters.length).toBe(1);
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });

  test("different SMTP configs get different transporters", async () => {
    let callCount = 0;
    const smtpConfigs = [
      { host: "smtp1.example.com", port: 587, user: "user1", pass: "pass1", secure: false },
      { host: "smtp2.example.com", port: 465, user: "user2", pass: "pass2", secure: true },
    ];

    const settings = makeSettingsService();
    settings.getEffectiveEmailConfig.mockImplementation(() => {
      const cfg = smtpConfigs[callCount % 2];
      callCount += 1;
      return Promise.resolve({
        provider: "smtp",
        from: "noreply@example.com",
        smtp: cfg,
      });
    });

    const service = new MailService(
      makeConfig() as unknown as ConfigService,
      settings as unknown as SettingsService,
      mockLogger as unknown as PinoLogger,
    );

    await service.send("a@test.com", "S1", "<p>1</p>", "org-1");
    await service.send("b@test.com", "S2", "<p>2</p>", "org-1");

    // Two distinct transporters for two distinct configs
    expect(createdTransporters.length).toBe(2);
  });

  // --- Resend provider ---

  test("sends via Resend when DB config has resend provider and API key", async () => {
    const settings = makeSettingsService({
      provider: "resend",
      apiKey: "re_test_key",
      from: "noreply@example.com",
      smtp: null,
    });

    const service = new MailService(
      makeConfig() as unknown as ConfigService,
      settings as unknown as SettingsService,
      mockLogger as unknown as PinoLogger,
    );

    await service.send("client@test.com", "Hello", "<p>Hi</p>", "org-1");

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test("sends via env-var Resend when no organizationId is provided", async () => {
    const settings = makeSettingsService(null);
    const config = makeConfig({ RESEND_API_KEY: "re_env_key" });

    const service = new MailService(
      config as unknown as ConfigService,
      settings as unknown as SettingsService,
      mockLogger as unknown as PinoLogger,
    );

    // No organizationId — uses the env-var Resend initialized in the constructor
    await service.send("client@test.com", "Subject", "<p>Body</p>");

    expect(mockResendSend).toHaveBeenCalledTimes(1);
  });

  // --- Silent skip when no provider ---

  test("silently skips sending when no provider is configured and no org ID", async () => {
    const settings = makeSettingsService(null);
    // No RESEND_API_KEY in env — this means this.resend is null
    const config = makeConfig({ RESEND_API_KEY: undefined });

    const service = new MailService(
      config as unknown as ConfigService,
      settings as unknown as SettingsService,
      mockLogger as unknown as PinoLogger,
    );

    // Should not throw
    await service.send("someone@test.com", "Test", "<p>Body</p>");

    expect(mockResendSend).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalled();
  });

  test("falls back to env-var Resend when DB provider fails", async () => {
    const settings = makeSettingsService(null);
    settings.getEffectiveEmailConfig.mockImplementation(() =>
      Promise.reject(new Error("DB error")),
    );
    const config = makeConfig({ RESEND_API_KEY: "re_fallback_key" });

    const service = new MailService(
      config as unknown as ConfigService,
      settings as unknown as SettingsService,
      mockLogger as unknown as PinoLogger,
    );

    await service.send("someone@test.com", "Test", "<p>Body</p>", "org-1");

    // Should warn about the DB failure and fall back to env-var Resend
    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockResendSend).toHaveBeenCalledTimes(1);
  });

  test("silently skips when DB config has no provider and no env fallback", async () => {
    const settings = makeSettingsService({
      provider: null,
      apiKey: null,
      from: "noreply@example.com",
      smtp: null,
    });
    const config = makeConfig({ RESEND_API_KEY: undefined });

    const service = new MailService(
      config as unknown as ConfigService,
      settings as unknown as SettingsService,
      mockLogger as unknown as PinoLogger,
    );

    await service.send("someone@test.com", "Test", "<p>Body</p>", "org-1");

    expect(mockResendSend).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
