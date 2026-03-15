import {
  IsString,
  IsNotEmpty,
  IsIn,
  MaxLength,
} from "class-validator";

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsIn(["quote", "contract", "nda", "other"])
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;
}

export class RespondDocumentDto {
  @IsString()
  @IsIn(["accepted", "declined", "acknowledged"])
  action!: string;
}
