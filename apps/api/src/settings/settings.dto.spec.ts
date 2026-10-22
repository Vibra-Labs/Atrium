import "reflect-metadata";
import { describe, test, expect } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateSettingsDto } from "./settings.dto";

async function validateDto(plain: Record<string, unknown>) {
  const instance = plainToInstance(UpdateSettingsDto, plain);
  const errors = await validate(instance);
  return { instance, errors };
}

describe("UpdateSettingsDto validation", () => {
  // --- emailFrom field ---

  test('emailFrom: "" transforms to null and passes validation', async () => {
    const { instance, errors } = await validateDto({ emailFrom: "" });

    expect(instance.emailFrom).toBeNull();
    expect(errors.length).toBe(0);
  });

  test("emailFrom: null passes validation", async () => {
    const { errors } = await validateDto({ emailFrom: null });

    expect(errors.length).toBe(0);
  });

  test("emailFrom: valid email passes validation", async () => {
    const { errors } = await validateDto({ emailFrom: "valid@email.com" });

    expect(errors.length).toBe(0);
  });

  test("emailFrom: invalid email fails validation", async () => {
    const { errors } = await validateDto({ emailFrom: "not-an-email" });

    expect(errors.length).toBeGreaterThan(0);
    const emailError = errors.find((e) => e.property === "emailFrom");
    expect(emailError).toBeDefined();
  });

  test("emailFrom: undefined (not provided) passes validation", async () => {
    const { errors } = await validateDto({});

    expect(errors.length).toBe(0);
  });

  // --- emailProvider field ---

  test('emailProvider: "resend" passes validation', async () => {
    const { errors } = await validateDto({ emailProvider: "resend" });

    expect(errors.length).toBe(0);
  });

  test('emailProvider: "smtp" passes validation', async () => {
    const { errors } = await validateDto({ emailProvider: "smtp" });

    expect(errors.length).toBe(0);
  });

  test('emailProvider: "invalid" fails validation', async () => {
    const { errors } = await validateDto({ emailProvider: "invalid" });

    expect(errors.length).toBeGreaterThan(0);
    const providerError = errors.find((e) => e.property === "emailProvider");
    expect(providerError).toBeDefined();
  });

  test('emailProvider: "" transforms to null and passes validation', async () => {
    const { instance, errors } = await validateDto({ emailProvider: "" });

    expect(instance.emailProvider).toBeNull();
    expect(errors.length).toBe(0);
  });

  // --- maxFileSizeMb field ---

  test("maxFileSizeMb: 0 fails validation (min is 1)", async () => {
    const { errors } = await validateDto({ maxFileSizeMb: 0 });

    expect(errors.length).toBeGreaterThan(0);
    const sizeError = errors.find((e) => e.property === "maxFileSizeMb");
    expect(sizeError).toBeDefined();
  });

  test("maxFileSizeMb: 1 passes validation", async () => {
    const { errors } = await validateDto({ maxFileSizeMb: 1 });

    expect(errors.length).toBe(0);
  });

  test("maxFileSizeMb: 500 passes validation (at max boundary)", async () => {
    const { errors } = await validateDto({ maxFileSizeMb: 500 });

    expect(errors.length).toBe(0);
  });

  test("maxFileSizeMb: 501 fails validation (exceeds max of 500)", async () => {
    const { errors } = await validateDto({ maxFileSizeMb: 501 });

    expect(errors.length).toBeGreaterThan(0);
    const sizeError = errors.find((e) => e.property === "maxFileSizeMb");
    expect(sizeError).toBeDefined();
  });

  test("maxFileSizeMb: string '25' coerces to number 25 and passes", async () => {
    const { instance, errors } = await validateDto({ maxFileSizeMb: "25" });

    expect(instance.maxFileSizeMb).toBe(25);
    expect(errors.length).toBe(0);
  });

  // --- smtpPort field ---

  test("smtpPort: 0 fails validation (min is 1)", async () => {
    const { errors } = await validateDto({ smtpPort: 0 });

    expect(errors.length).toBeGreaterThan(0);
  });

  test("smtpPort: 65535 passes validation (at max boundary)", async () => {
    const { errors } = await validateDto({ smtpPort: 65535 });

    expect(errors.length).toBe(0);
  });

  test("smtpPort: 65536 fails validation (exceeds max)", async () => {
    const { errors } = await validateDto({ smtpPort: 65536 });

    expect(errors.length).toBeGreaterThan(0);
  });

  // --- Combined valid DTO ---

  test("full valid DTO with all fields passes validation", async () => {
    const { errors } = await validateDto({
      emailProvider: "smtp",
      emailFrom: "mail@company.com",
      smtpHost: "smtp.company.com",
      smtpPort: 587,
      smtpUser: "smtp-user",
      smtpPass: "smtp-password",
      smtpSecure: false,
      maxFileSizeMb: 100,
    });

    expect(errors.length).toBe(0);
  });

  // --- plainHttpNoticeDismissed field ---

  test("plainHttpNoticeDismissed: true passes validation", async () => {
    const { errors } = await validateDto({ plainHttpNoticeDismissed: true });

    expect(errors.length).toBe(0);
  });

  test("plainHttpNoticeDismissed: a string fails validation", async () => {
    const { errors } = await validateDto({ plainHttpNoticeDismissed: "yes" });

    expect(errors.find((e) => e.property === "plainHttpNoticeDismissed")).toBeDefined();
  });
});
