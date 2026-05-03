import { IsDateString, IsOptional, IsString } from "class-validator";

export class CalendarQueryDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() type?: string;
}
