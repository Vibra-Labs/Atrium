import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from "class-validator";

export class CreateFileLinkDto {
  @IsString()
  projectId!: string;

  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @MaxLength(2048)
  url!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
