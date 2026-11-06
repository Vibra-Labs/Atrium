import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min, ValidateIf } from "class-validator";
import { PURSUIT_STAGES } from "@atrium/shared";
import type { PursuitStage } from "@atrium/shared";

/** Deal fields on a potential contract. Null clears a field. */
export class UpdatePursuitDto {
  @IsOptional()
  @IsIn(PURSUIT_STAGES)
  stage?: PursuitStage;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(0)
  valueCents?: number | null;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsDateString()
  closeDate?: string | null;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(500)
  nextStep?: string | null;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsDateString()
  nextStepAt?: string | null;

  @IsOptional()
  @IsBoolean()
  isBid?: boolean;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(100)
  solicitationNumber?: string | null;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsDateString()
  questionsDueAt?: string | null;

  @ValidateIf((_o, v) => v !== null && v !== undefined && v !== "")
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  sourceUrl?: string | null;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(100)
  companyId?: string | null;
}

export class WinPursuitDto {
  @IsString()
  @MaxLength(100)
  contactId!: string;

  @IsString()
  @MaxLength(100)
  status!: string;

  @IsBoolean()
  giveAccess!: boolean;
}

export class LosePursuitDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
