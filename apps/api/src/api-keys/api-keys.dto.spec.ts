import { describe, expect, it } from "bun:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateApiKeyDto } from "./api-keys.dto";

async function check(name: unknown): Promise<{ dto: CreateApiKeyDto; errors: string[] }> {
  const dto = plainToInstance(CreateApiKeyDto, { name });
  const errors = await validate(dto);
  return { dto, errors: errors.map((e) => e.property) };
}

describe("CreateApiKeyDto", () => {
  it("rejects a name that is only whitespace", async () => {
    const { errors } = await check("   ");
    expect(errors).toEqual(["name"]);
  });

  it("trims a valid name", async () => {
    const { dto, errors } = await check("  Claude agent  ");
    expect(errors).toEqual([]);
    expect(dto.name).toBe("Claude agent");
  });

  it("rejects a name longer than 64 characters", async () => {
    const { errors } = await check("x".repeat(65));
    expect(errors).toEqual(["name"]);
  });
});
