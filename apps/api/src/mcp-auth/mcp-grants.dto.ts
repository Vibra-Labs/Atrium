import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateMcpGrantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  clientId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  organizationId!: string;
}
