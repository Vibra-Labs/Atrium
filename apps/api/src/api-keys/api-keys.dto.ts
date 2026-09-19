import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;
}
