import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateApiKeyDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;
}
