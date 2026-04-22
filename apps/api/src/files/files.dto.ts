import { IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from "class-validator";

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

export class UpdateFileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(/^https?:\/\//i, { message: "url must start with http:// or https://" })
  url?: string;
}
