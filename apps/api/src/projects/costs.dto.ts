import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { MAX_CENTS } from "@atrium/shared";

/** Null clears a field. */
export class UpdateCostsDto {
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  costCents?: number | null;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  laborRateCents?: number | null;
}

export class CostLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/\S/, { message: "label can't be blank" })
  label!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  amountCents!: number;
}

export class UpdateCostLineDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/\S/, { message: "label can't be blank" })
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  amountCents?: number;
}
