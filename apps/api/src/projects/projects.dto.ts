import { IsString, IsOptional, IsArray, IsBoolean, IsDateString, IsIn, IsInt, MaxLength, Min } from "class-validator";
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

  /** Creates it as a potential contract: work that isn't signed yet. */
  @IsBoolean()
  @IsOptional()
  potential?: boolean;
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

  /** "only": open potential contracts. "exclude": signed work only. */
  @IsOptional()
  @IsIn(["only", "exclude"])
  pursuit?: "only" | "exclude";
}

export class DuplicateProjectDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsBoolean()
  @IsOptional()
  includeTasks?: boolean;

  @IsBoolean()
  @IsOptional()
  includeClients?: boolean;
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

  @IsOptional()
  @IsInt()
  @Min(0)
  hourlyRateCents?: number | null;
}
