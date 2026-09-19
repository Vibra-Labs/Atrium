import { describe, expect, it } from "bun:test";
import { APIError } from "better-auth/api";
import { assertConsentGranted } from "./consent-hooks";
import type { PrismaService } from "../prisma/prisma.service";

function prismaWith(row: { value: string } | null): PrismaService {
  return {
    verification: { findFirst: async () => row },
  } as unknown as PrismaService;
}

describe("assertConsentGranted", () => {
  it("refuses a code whose row still requires consent", async () => {
    const prisma = prismaWith({ value: JSON.stringify({ clientId: "c1", requireConsent: true }) });

    const err = await assertConsentGranted(prisma, "code-1").then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).statusCode).toBe(400);
    expect((err as APIError).body).toMatchObject({
      error: "invalid_grant",
      error_description: "Consent has not been granted.",
    });
  });

  it("allows a code the consent endpoint has already flipped", async () => {
    // /oauth2/consent renames the row and sets requireConsent to false.
    const prisma = prismaWith({ value: JSON.stringify({ clientId: "c1", requireConsent: false }) });
    expect(await assertConsentGranted(prisma, "code-1")).toBeUndefined();
  });

  it("leaves an unknown code to the plugin's own invalid_grant answer", async () => {
    expect(await assertConsentGranted(prismaWith(null), "nope")).toBeUndefined();
  });

  it("leaves a row that is not an authorization request alone", async () => {
    expect(await assertConsentGranted(prismaWith({ value: "not json" }), "code-1")).toBeUndefined();
    expect(await assertConsentGranted(prismaWith({ value: '"a string"' }), "code-1")).toBeUndefined();
  });
});
