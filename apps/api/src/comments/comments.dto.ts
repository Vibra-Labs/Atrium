import { IsString, MaxLength, IsNotEmpty } from "class-validator";
import { Transform } from "class-transformer";

export class CreateCommentDto {
  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;
}
