/**
 * The demo workspace must send no mail at all. A request guard cannot deliver
 * that: most mail originates in crons, and trial-emails.task.ts does not even
 * pass an organizationId. What every demo recipient does have in common is the
 * address — the seed refuses anything outside @demo.invalid and the demo blocks
 * invites, so nothing else can get in.
 *
 * Dropping them is not only politeness. Resend would attempt @demo.invalid,
 * bounce, and spend sending reputation on the real domain.
 */
import { describe, expect, it, mock } from "bun:test";
import { MailService, isDemoRecipient } from "./mail.service";
import type { ConfigService } from "@nestjs/config";
import type { SettingsService } from "../settings/settings.service";

function build(): { service: MailService; settings: { getEffectiveEmailConfig: ReturnType<typeof mock> } } {
  const config = {
    get: (key: string, fallback?: string) => (key === "RESEND_API_KEY" ? "re_test" : fallback),
  } as unknown as ConfigService;
  const settings = {
    getEffectiveEmailConfig: mock(() =>
      Promise.resolve({ isOrgConfigured: false, provider: null, apiKey: null, smtp: null, from: "x@y.z" }),
    ),
  };
  const logger = { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}), debug: mock(() => {}) };
  return {
    service: new MailService(
      config,
      settings as unknown as SettingsService,
      logger as never,
    ),
    settings,
  };
}

describe("MailService and the demo domain", () => {
  it("drops a send to a demo address and reports it unsent", async () => {
    const { service, settings } = build();

    const result = await service.send("owner@demo.invalid", "Hello", "<p>hi</p>", "org-demo");

    expect(result).toEqual({ sent: false, viaOrgConfig: false });
    // Nothing was looked up, so nothing was attempted.
    expect(settings.getEffectiveEmailConfig).not.toHaveBeenCalled();
  });

  it("drops it whatever the case of the address", async () => {
    const { service, settings } = build();

    expect(await service.send("Owner@Demo.Invalid", "Hello", "<p>hi</p>", "org-demo")).toEqual({
      sent: false,
      viaOrgConfig: false,
    });
    expect(settings.getEffectiveEmailConfig).not.toHaveBeenCalled();
  });

  it("recognises a demo recipient regardless of how the send was triggered", () => {
    // The rule is about the address, not the caller, so trial-emails.task.ts —
    // which passes no organizationId at all — is covered too.
    expect(isDemoRecipient("client@demo.invalid")).toBe(true);
    expect(isDemoRecipient("CLIENT@DEMO.INVALID")).toBe(true);
    expect(isDemoRecipient(" client@demo.invalid ")).toBe(true);
    expect(isDemoRecipient("someone@example.com")).toBe(false);
    expect(isDemoRecipient("demo.invalid@example.com")).toBe(false);
  });

  it("still attempts a real address", async () => {
    const { service, settings } = build();

    await service.send("someone@example.com", "Hello", "<p>hi</p>", "org-1");

    expect(settings.getEffectiveEmailConfig).toHaveBeenCalled();
  });
});
