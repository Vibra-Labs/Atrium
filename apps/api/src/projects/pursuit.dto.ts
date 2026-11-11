import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateIf } from "class-validator";
import { MAX_CENTS } from "@atrium/shared";

/** Deal fields on a potential contract. Null clears a field. */
export class UpdatePursuitDto {
  /** One of the workspace's pipelines (checked by the service). */
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(64)
  pipelineId?: string;

  /** A stage slug in the contract's pipeline (checked by the service). */
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(64)
  stage?: string;

  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
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

  @ValidateIf((_o, v) => v !== undefined)
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
  /** Optional: a contract can be won before you add who it's for. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactId?: string;

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
