import { IsString, IsOptional, MaxLength } from "class-validator";

/** A portal client's self-service profile; stored on their contact. */
export class UpdateClientProfileDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  company?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  website?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;
}
