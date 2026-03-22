import { IsString, IsOptional, MaxLength, Matches, IsIn } from "class-validator";

export class CreateLabelDto {
  @IsString()
  @MaxLength(50)
  name!: string;

  @IsString()
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: "color must be a valid hex color (e.g. #ff0000)" })
  color?: string;
}

export class UpdateLabelDto {
  @IsString()
  @IsOptional()
  @MaxLength(50)
  name?: string;

  @IsString()
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: "color must be a valid hex color (e.g. #ff0000)" })
  color?: string;
}

export class AssignLabelDto {
  @IsString()
  @IsIn(["project", "task", "file", "member"])
  entityType!: string;

  @IsString()
  entityId!: string;
}
