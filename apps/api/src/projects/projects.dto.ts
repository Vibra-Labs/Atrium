import { IsString, IsOptional, IsArray, IsDateString, MaxLength } from "class-validator";
import { PaginationQueryDto } from "../common";

export class CreateProjectDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  status?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  clientUserIds?: string[];
}

export class ClientProjectListQueryDto extends PaginationQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  search?: string;
}

export class ProjectListQueryDto extends ClientProjectListQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  status?: string;

  @IsString()
  @IsOptional()
  archived?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  labels?: string;
}

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  status?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string | null;

  @IsDateString()
  @IsOptional()
  endDate?: string | null;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  clientUserIds?: string[];
}
