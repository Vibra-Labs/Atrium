import { IsDateString, IsIn, IsOptional, IsString } from "class-validator";

export class CalendarQueryDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() type?: string;
  // IANA timezone (e.g. "America/Los_Angeles"). Defaults to UTC.
  @IsOptional() @IsString() tz?: string;
  // "true" leaves out archived projects and completed or cancelled project deadlines (dashboard "This week").
  @IsOptional() @IsIn(["true", "false"]) activeOnly?: string;
}
