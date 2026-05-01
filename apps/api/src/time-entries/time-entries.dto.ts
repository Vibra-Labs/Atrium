import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";

export class StartTimerDto {
  @IsString() projectId!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class CreateManualEntryDto {
  @IsString() projectId!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsDateString() startedAt!: string;
  @IsDateString() endedAt!: string;
  @IsOptional() @IsBoolean() billable?: boolean;
}

export class UpdateTimeEntryDto {
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsDateString() startedAt?: string;
  @IsOptional() @IsDateString() endedAt?: string;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsString() taskId?: string | null;
}

export class TimeEntryListQueryDto {
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() billable?: "true" | "false";
  @IsOptional() invoiced?: "true" | "false";
  @IsOptional() @IsInt() @Min(1) page?: number;
  @IsOptional() @IsInt() @Min(1) limit?: number;
}

export class GenerateInvoiceDto {
  @IsString() projectId!: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsBoolean() includeNonBillable?: boolean;
}
