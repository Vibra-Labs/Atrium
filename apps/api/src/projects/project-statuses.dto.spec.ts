import { describe, expect, it } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateProjectStatusDto, UpdateProjectStatusDto } from "./project-statuses.dto";

const errorsFor = async (cls: new () => object, body: object): Promise<string[]> =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe("project status DTOs", () => {
  it("rejects null name or color on update", async () => {
    expect(await errorsFor(UpdateProjectStatusDto, { name: null })).toEqual(["name"]);
    expect(await errorsFor(UpdateProjectStatusDto, { color: null })).toEqual(["color"]);
  });

  it("still allows omitting name and color on update", async () => {
    expect(await errorsFor(UpdateProjectStatusDto, {})).toEqual([]);
  });

  it("rejects null color on create", async () => {
    expect(await errorsFor(CreateProjectStatusDto, { name: "A", color: null })).toEqual(["color"]);
  });
});
