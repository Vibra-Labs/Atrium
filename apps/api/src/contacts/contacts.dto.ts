import {
  ValidateIf,
  IsDateString,
  IsEmail,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Type } from "class-transformer";
import { CONTACT_STATUSES, FOLLOW_UP_REPEAT_DAYS, FOLLOW_UP_SNOOZE_DAYS } from "@atrium/shared";
import type { ContactStatus } from "@atrium/shared";
import { PaginationQueryDto } from "../common";

export { CONTACT_STATUSES };

export const LEAD_SOURCE_NAME_MAX = 100;
export const TIMELINE_MAX_PAGE = 50;
export type { ContactStatus };

export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsIn(CONTACT_STATUSES)
  status?: ContactStatus;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  companyId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  leadSourceId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEAD_SOURCE_NAME_MAX)
  leadSourceName?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  referredById?: string | null;
}

export class CreateContactDto extends UpdateContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  declare name: string;
}

export class ListCompaniesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class ListContactsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn(CONTACT_STATUSES)
  status?: ContactStatus;

  @IsOptional()
  @IsString()
  labelId?: string;

  @IsOptional()
  @IsString()
  leadSourceId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}

export class CreateContactNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  website?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

export class CreateCompanyDto extends UpdateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  declare name: string;
}

export class LeadSourceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(LEAD_SOURCE_NAME_MAX)
  name!: string;
}

/** page * limit is fetched from each of notes and events, so keep it bounded (≤ 5,000). */
export class TimelineQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TIMELINE_MAX_PAGE)
  declare page?: number;
}

export class SetFollowUpDto {
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  followUpAt!: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @IsIn(FOLLOW_UP_REPEAT_DAYS)
  everyDays?: number | null;
}

export class SnoozeFollowUpDto {
  @IsInt()
  @IsIn(FOLLOW_UP_SNOOZE_DAYS)
  days!: number;
}
