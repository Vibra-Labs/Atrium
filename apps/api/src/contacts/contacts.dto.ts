import {
  ArrayMaxSize,
  IsArray,
  ValidateIf,
  ValidateNested,
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
import {
  CONTACT_RATINGS,
  CONTACT_STATUSES,
  FOLLOW_UP_REPEAT_DAYS,
  FOLLOW_UP_SNOOZE_DAYS,
} from "@atrium/shared";
import type { ContactRating, ContactStatus } from "@atrium/shared";
import { PaginationQueryDto } from "../common";
import { MAX_SOCIAL_LINKS_INPUT, NAME_PART_MAX } from "./contact-fields";

export { CONTACT_RATINGS, CONTACT_STATUSES };

export const LEAD_SOURCE_NAME_MAX = 100;
export const TIMELINE_MAX_PAGE = 50;
export const COMPANY_NUMBER_MAX = 2_000_000_000;
export const CONTACT_DESCRIPTION_MAX = 2000;
export const PORTAL_ACCESS_FILTERS = ["portal", "pending", "none"] as const;
export type PortalAccessFilter = (typeof PORTAL_ACCESS_FILTERS)[number];
export type { ContactRating, ContactStatus };

export const CONTACT_SORTS = ["name", "company", "status", "followUp", "paid"] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];
export const COMPANY_SORTS = ["name", "people", "paid"] as const;
export type CompanySort = (typeof COMPANY_SORTS)[number];
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** Lengths are checked after trimming, in contact-fields.ts. */
export class ContactPhoneDto {
  @IsString()
  label!: string;

  @IsString()
  number!: string;
}

/** `name` is optional on both create and update; the service requires firstName or name. */
export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NAME_PART_MAX)
  firstName?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(NAME_PART_MAX)
  lastName?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  jobTitle?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  department?: string | null;

  /** Replaces the whole list; `phone` mirrors the first number. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ContactPhoneDto)
  phones?: ContactPhoneDto[] | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsArray()
  @ArrayMaxSize(MAX_SOCIAL_LINKS_INPUT)
  @IsString({ each: true })
  socialLinks?: string[] | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(CONTACT_RATINGS)
  rating?: ContactRating | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  email?: string | null;

  /** Legacy single number: sets (or, blank, removes) the first entry of `phones`. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  /** "About" text; null or blank clears it. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(CONTACT_DESCRIPTION_MAX)
  description?: string | null;

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

export class CreateContactDto extends UpdateContactDto {}

export class ListCompaniesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn(COMPANY_SORTS)
  sort?: CompanySort;

  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  dir?: SortDirection;
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
  @IsIn(CONTACT_RATINGS)
  rating?: ContactRating;

  @IsOptional()
  @IsString()
  labelId?: string;

  @IsOptional()
  @IsString()
  leadSourceId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  /** portal = has a portal login; pending = open client invitation; none = neither. */
  @IsOptional()
  @IsIn(PORTAL_ACCESS_FILTERS)
  access?: PortalAccessFilter;

  @IsOptional()
  @IsIn(CONTACT_SORTS)
  sort?: ContactSort;

  @IsOptional()
  @IsIn(SORT_DIRECTIONS)
  dir?: SortDirection;
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

  /** Whole units of currency. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(COMPANY_NUMBER_MAX)
  annualRevenue?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(COMPANY_NUMBER_MAX)
  employeeCount?: number | null;
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
