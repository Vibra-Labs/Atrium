import { IsBoolean } from "class-validator";

export class SetRequirementDto {
  @IsBoolean()
  required!: boolean;
}
