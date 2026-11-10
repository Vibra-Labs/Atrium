import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateMcpGrantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  oauthQuery!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  organizationId!: string;
}

export class ConsentInfoQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  oauthQuery!: string;
}
