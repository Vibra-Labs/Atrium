import "reflect-metadata";
import { describe, test, expect } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { MAX_CENTS } from "@atrium/shared";
import { CostLineDto, UpdateCostLineDto, UpdateCostsDto } from "./costs.dto";
import { UpdatePursuitDto } from "./pursuit.dto";

async function errorsFor(cls: new () => object, plain: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe("money and cost-line validation", () => {
  test("amounts above what the database holds are rejected, not a 500", async () => {
    expect(await errorsFor(UpdatePursuitDto, { valueCents: MAX_CENTS + 1 })).toEqual(["valueCents"]);
    expect(await errorsFor(UpdateCostsDto, { costCents: MAX_CENTS + 1 })).toEqual(["costCents"]);
    expect(await errorsFor(UpdateCostsDto, { laborRateCents: MAX_CENTS + 1 })).toEqual(["laborRateCents"]);
    expect(await errorsFor(CostLineDto, { label: "Paint", amountCents: MAX_CENTS + 1 })).toEqual(["amountCents"]);
    expect(await errorsFor(UpdateCostLineDto, { amountCents: MAX_CENTS + 1 })).toEqual(["amountCents"]);
  });

  test("the largest amount is fine", async () => {
    expect(await errorsFor(UpdatePursuitDto, { valueCents: MAX_CENTS })).toEqual([]);
    expect(await errorsFor(CostLineDto, { label: "Paint", amountCents: MAX_CENTS })).toEqual([]);
  });

  test("a cost name of only spaces is rejected", async () => {
    expect(await errorsFor(CostLineDto, { label: "   ", amountCents: 1 })).toEqual(["label"]);
    expect(await errorsFor(UpdateCostLineDto, { label: "   " })).toEqual(["label"]);
  });
});
