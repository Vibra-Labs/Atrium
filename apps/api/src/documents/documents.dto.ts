import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
  MaxLength,
  IsBoolean,
  IsInt,
  IsNumber,
  IsArray,
  Min,
  Max,
  ValidateNested,
} from "class-validator";
import { Transform, Type } from "class-transformer";

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsIn(["quote", "contract", "proposal", "nda", "other"])
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true" || value === true)
  requiresSignature?: boolean;
}

export class RespondDocumentDto {
  @IsString()
  @IsIn(["accepted", "declined", "acknowledged"])
  action!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateSignatureFieldDto {
  @IsInt()
  @Min(0)
  pageNumber!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  width!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  height!: number;
}

export class SetSignatureFieldsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSignatureFieldDto)
  fields!: CreateSignatureFieldDto[];
}

export class SignDocumentDto {
  @IsString()
  @IsIn(["draw", "type"])
  method!: string;

  @IsString()
  @IsNotEmpty()
  fieldId!: string;
}
