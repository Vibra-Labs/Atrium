import { Type } from "class-transformer";
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsArray,
  IsIn,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
  ValidateNested,
  ValidateIf,
} from "class-validator";

export class DecisionOptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  label!: string;
}

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  @IsIn(["checkbox", "decision"])
  type?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  question?: string;

  @IsArray()
  @IsOptional()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => DecisionOptionDto)
  options?: DecisionOptionDto[];
}

// Used by clients creating requests from the portal — no type/question/options
export class CreateClientTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;
}

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @ValidateIf((o: UpdateTaskDto) => o.dueDate !== null)
  @IsDateString()
  @IsOptional()
  dueDate?: string | null;

  @IsString()
  @IsOptional()
  @IsIn(["open", "in_progress", "done", "cancelled"])
  status?: string;

  // null = unassign, string = assign to userId
  @IsString()
  @IsOptional()
  assigneeId?: string | null;
}

export class ReorderTasksDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  taskIds!: string[];
}

export class CastVoteDto {
  @IsString()
  @IsNotEmpty()
  optionId!: string;
}
