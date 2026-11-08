import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from "class-validator";

/** Null clears a field. */
export class UpdateCostsDto {
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(0)
  costCents?: number | null;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(0)
  laborRateCents?: number | null;
}

export class CostLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  @IsInt()
  @Min(0)
  amountCents!: number;
}

export class UpdateCostLineDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;
}
