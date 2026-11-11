import { describe, expect, it } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreatePursuitStageDto, PursuitNameDto } from "./pursuit-stages.dto";
import { UpdatePursuitDto } from "./pursuit.dto";

const errorsFor = async (cls: new () => object, body: object): Promise<string[]> =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe("pursuit DTOs", () => {
  it("rejects a null pipeline or stage name", async () => {
    expect(await errorsFor(PursuitNameDto, { name: null })).toEqual(["name"]);
    expect(await errorsFor(CreatePursuitStageDto, { name: null, pipelineId: "p" })).toEqual(["name"]);
  });

  it("rejects null pipelineId, stage and isBid on update, but allows omitting them", async () => {
    expect(await errorsFor(UpdatePursuitDto, { pipelineId: null })).toEqual(["pipelineId"]);
    expect(await errorsFor(UpdatePursuitDto, { stage: null })).toEqual(["stage"]);
    expect(await errorsFor(UpdatePursuitDto, { isBid: null })).toEqual(["isBid"]);
    expect(await errorsFor(UpdatePursuitDto, {})).toEqual([]);
  });
});
