import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { GenerateInvoiceDto } from "./time-entries.dto";

async function validateGenerateInvoiceDto(plain: Record<string, unknown>) {
  const instance = plainToInstance(GenerateInvoiceDto, plain);
  return validate(instance);
}

describe("GenerateInvoiceDto validation", () => {
  it("accepts projectId only", async () => {
    const errors = await validateGenerateInvoiceDto({ projectId: "project-1" });
    expect(errors.length).toBe(0);
  });

  it("accepts billingClientId only", async () => {
    const errors = await validateGenerateInvoiceDto({ billingClientId: "billing-client-1" });
    expect(errors.length).toBe(0);
  });

  it("rejects neither projectId nor billingClientId", async () => {
    const errors = await validateGenerateInvoiceDto({});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.property === "invoiceScope")).toBe(true);
  });

  it("rejects both projectId and billingClientId", async () => {
    const errors = await validateGenerateInvoiceDto({
      projectId: "project-1",
      billingClientId: "billing-client-1",
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.property === "invoiceScope")).toBe(true);
  });
});
