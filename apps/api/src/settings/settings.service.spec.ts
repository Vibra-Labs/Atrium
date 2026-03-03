import { describe, test, expect, beforeEach, mock } from "bun:test";
import { SettingsService } from "./settings.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";

interface UpsertArgs {
  update?: Record<string, unknown>;
  create?: Record<string, unknown>;
}

// Minimal logger mock
const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

function makePrisma(overrides: Partial<typeof basePrisma> = {}) {
  return { ...basePrisma, ...overrides };
}

const basePrisma = {
  systemSettings: {
    upsert: mock(() => Promise.resolve(baseSettings())),
    findUnique: mock(() => Promise.resolve(null)),
  },
};

function baseSettings(extra: Record<string, unknown> = {}) {
  return {
    id: "settings-1",
    organizationId: "org-1",
    emailProvider: null,
    emailFrom: null,
    resendApiKey: null,
    smtpHost: null,
    smtpPort: 587,
    smtpUser: null,
    smtpPass: null,
    smtpSecure: true,
    maxFileSizeMb: null,
    setupCompleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

function makeConfig(overrides: Record<string, string | undefined> = {}) {
  const defaults: Record<string, string | undefined> = {
    BETTER_AUTH_SECRET: "a-very-long-secret-for-testing-purposes-at-least-32",
    RESEND_API_KEY: undefined,
    EMAIL_FROM: undefined,
    MAX_FILE_SIZE_MB: undefined,
  };
  const merged = { ...defaults, ...overrides };
  return {
    getOrThrow: (key: string) => {
      const val = merged[key];
      if (val === undefined) throw new Error(`Missing: ${key}`);
      return val;
    },
    get: (key: string, fallback?: string) => merged[key] ?? fallback,
  };
}

describe("SettingsService", () => {
  let service: SettingsService;
  let prisma: typeof basePrisma;
  let config: ReturnType<typeof makeConfig>;

  beforeEach(() => {
    prisma = {
      systemSettings: {
        upsert: mock(() => Promise.resolve(baseSettings())),
        findUnique: mock(() => Promise.resolve(null)),
      },
    };
    config = makeConfig();
    service = new SettingsService(prisma as unknown as PrismaService, config as unknown as ConfigService, mockLogger as unknown as PinoLogger);
  });

  // --- Encryption round-trip ---

  test("encrypt/decrypt round-trip via updateSettings + getEffectiveEmailConfig", async () => {
    let storedResendKey: string | null = null;

    // Capture what was stored in the DB
    prisma.systemSettings.upsert.mockImplementation((args: UpsertArgs) => {
      const data = args.update ?? args.create ?? {};
      if (data.resendApiKey !== undefined) storedResendKey = data.resendApiKey;
      return Promise.resolve(
        baseSettings({ resendApiKey: storedResendKey }),
      );
    });

    // findUnique returns whatever was "stored"
    prisma.systemSettings.findUnique.mockImplementation(() =>
      Promise.resolve(baseSettings({ resendApiKey: storedResendKey })),
    );

    await service.updateSettings("org-1", { resendApiKey: "re_secret_key_123" });

    // The stored value must not be the plaintext
    expect(storedResendKey).not.toBeNull();
    expect(storedResendKey).not.toBe("re_secret_key_123");

    // getEffectiveEmailConfig must decrypt and return the original value
    const emailConfig = await service.getEffectiveEmailConfig("org-1");
    expect(emailConfig.apiKey).toBe("re_secret_key_123");
  });

  test("smtpPass is encrypted on save and decrypted in getEffectiveEmailConfig", async () => {
    let storedSmtpPass: string | null = null;

    prisma.systemSettings.upsert.mockImplementation((args: UpsertArgs) => {
      const data = args.update ?? args.create ?? {};
      if (data.smtpPass !== undefined) storedSmtpPass = data.smtpPass;
      return Promise.resolve(
        baseSettings({
          emailProvider: "smtp",
          smtpHost: "mail.example.com",
          smtpPass: storedSmtpPass,
        }),
      );
    });

    prisma.systemSettings.findUnique.mockImplementation(() =>
      Promise.resolve(
        baseSettings({
          emailProvider: "smtp",
          smtpHost: "mail.example.com",
          smtpPass: storedSmtpPass,
        }),
      ),
    );

    await service.updateSettings("org-1", {
      emailProvider: "smtp",
      smtpPass: "super-secret-password",
    });

    expect(storedSmtpPass).not.toBe("super-secret-password");

    const emailConfig = await service.getEffectiveEmailConfig("org-1");
    expect(emailConfig.smtp?.pass).toBe("super-secret-password");
  });

  // --- getSettings masked values ---

  test("getSettings masks resendApiKey with bullet characters", async () => {
    prisma.systemSettings.upsert.mockImplementation(() =>
      Promise.resolve(baseSettings({ resendApiKey: "encrypted-value-stored-here" })),
    );

    const result = await service.getSettings("org-1");

    expect(result.resendApiKey).toBe("••••••••");
  });

  test("getSettings masks smtpPass with bullet characters", async () => {
    prisma.systemSettings.upsert.mockImplementation(() =>
      Promise.resolve(baseSettings({ smtpPass: "encrypted-smtp-pass" })),
    );

    const result = await service.getSettings("org-1");

    expect(result.smtpPass).toBe("••••••••");
  });

  test("getSettings returns null for resendApiKey when not set", async () => {
    prisma.systemSettings.upsert.mockImplementation(() =>
      Promise.resolve(baseSettings({ resendApiKey: null })),
    );

    const result = await service.getSettings("org-1");

    expect(result.resendApiKey).toBeNull();
  });

  test("updateSettings masks resendApiKey in returned value", async () => {
    prisma.systemSettings.upsert.mockImplementation((args: UpsertArgs) => {
      const data = args.update ?? args.create ?? {};
      return Promise.resolve(
        baseSettings({ resendApiKey: data.resendApiKey ?? null }),
      );
    });

    const result = await service.updateSettings("org-1", {
      resendApiKey: "re_test_key",
    });

    expect(result.resendApiKey).toBe("••••••••");
  });

  // --- getEffectiveEmailConfig env fallback ---

  test("getEffectiveEmailConfig falls back to RESEND_API_KEY env var when no DB settings", async () => {
    config = makeConfig({ RESEND_API_KEY: "re_env_key_456" });
    service = new SettingsService(prisma as unknown as PrismaService, config as unknown as ConfigService, mockLogger as unknown as PinoLogger);

    prisma.systemSettings.findUnique.mockImplementation(() =>
      Promise.resolve(null),
    );

    const result = await service.getEffectiveEmailConfig("org-1");

    expect(result.provider).toBe("resend");
    expect(result.apiKey).toBe("re_env_key_456");
  });

  test("getEffectiveEmailConfig returns null provider when no env or DB config", async () => {
    prisma.systemSettings.findUnique.mockImplementation(() =>
      Promise.resolve(null),
    );

    const result = await service.getEffectiveEmailConfig("org-1");

    expect(result.provider).toBeNull();
  });

  test("getEffectiveEmailConfig uses DB emailFrom over env EMAIL_FROM", async () => {
    config = makeConfig({ EMAIL_FROM: "env@example.com" });
    service = new SettingsService(prisma as unknown as PrismaService, config as unknown as ConfigService, mockLogger as unknown as PinoLogger);

    prisma.systemSettings.findUnique.mockImplementation(() =>
      Promise.resolve(baseSettings({ emailFrom: "db@example.com" })),
    );

    const result = await service.getEffectiveEmailConfig("org-1");

    expect(result.from).toBe("db@example.com");
  });

  test("getEffectiveEmailConfig falls back to EMAIL_FROM env var", async () => {
    config = makeConfig({ EMAIL_FROM: "fallback@example.com" });
    service = new SettingsService(prisma as unknown as PrismaService, config as unknown as ConfigService, mockLogger as unknown as PinoLogger);

    prisma.systemSettings.findUnique.mockImplementation(() =>
      Promise.resolve(baseSettings({ emailFrom: null })),
    );

    const result = await service.getEffectiveEmailConfig("org-1");

    expect(result.from).toBe("fallback@example.com");
  });

  test("getEffectiveEmailConfig defaults from to noreply@atrium.local when no config", async () => {
    prisma.systemSettings.findUnique.mockImplementation(() =>
      Promise.resolve(null),
    );

    const result = await service.getEffectiveEmailConfig("org-1");

    expect(result.from).toBe("noreply@atrium.local");
  });

  // --- getEffectiveMaxFileSize ---

  test("getEffectiveMaxFileSize returns DB value when set", async () => {
    prisma.systemSettings.findUnique.mockImplementation(() =>
      Promise.resolve(baseSettings({ maxFileSizeMb: 100 })),
    );

    const result = await service.getEffectiveMaxFileSize("org-1");

    expect(result).toBe(100);
  });

  test("getEffectiveMaxFileSize returns MAX_FILE_SIZE_MB env var when DB not set", async () => {
    config = makeConfig({ MAX_FILE_SIZE_MB: "75" });
    service = new SettingsService(prisma as unknown as PrismaService, config as unknown as ConfigService, mockLogger as unknown as PinoLogger);

    prisma.systemSettings.findUnique.mockImplementation(() =>
      Promise.resolve(baseSettings({ maxFileSizeMb: null })),
    );

    const result = await service.getEffectiveMaxFileSize("org-1");

    expect(result).toBe(75);
  });

  test("getEffectiveMaxFileSize defaults to 50 when no DB or env config", async () => {
    prisma.systemSettings.findUnique.mockImplementation(() =>
      Promise.resolve(null),
    );

    const result = await service.getEffectiveMaxFileSize("org-1");

    expect(result).toBe(50);
  });

  // --- Null sensitive fields ---

  test("updateSettings stores null when resendApiKey is cleared", async () => {
    let storedKey: string | null = "previous-value";

    prisma.systemSettings.upsert.mockImplementation((args: UpsertArgs) => {
      const data = args.update ?? args.create ?? {};
      if ("resendApiKey" in data) storedKey = data.resendApiKey;
      return Promise.resolve(baseSettings({ resendApiKey: storedKey }));
    });

    await service.updateSettings("org-1", { resendApiKey: "" });

    expect(storedKey).toBeNull();
  });
});
