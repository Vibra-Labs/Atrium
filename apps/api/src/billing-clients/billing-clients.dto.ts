import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";
import { PaginationQueryDto } from "../common";

export class BillingClientListQueryDto extends PaginationQueryDto {
  @IsString()
  @IsOptional()
  archived?: string;
}

export class CreateBillingClientDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  slug?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  defaultHourlyRateCents?: number | null;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  billingPeriod?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  billingNotes?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  externalReference?: string | null;
}

export class UpdateBillingClientDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  slug?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  defaultHourlyRateCents?: number | null;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  billingPeriod?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  billingNotes?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  externalReference?: string | null;
}
