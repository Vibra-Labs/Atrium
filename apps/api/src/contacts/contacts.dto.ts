import {
  ValidateIf,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { PaginationQueryDto } from "../common";

export const CONTACT_STATUSES = ["lead", "client", "past_client"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

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
  @MaxLength(200)
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
  @IsString()
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class CreateCompanyDto extends UpdateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  declare name: string;
}
