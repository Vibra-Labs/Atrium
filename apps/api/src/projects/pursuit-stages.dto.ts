import { ArrayMaxSize, IsArray, IsIn, IsString, MaxLength } from "class-validator";
import { MAX_PURSUIT_STAGES, PURSUIT_PIPELINES } from "@atrium/shared";
import type { PursuitPipeline } from "@atrium/shared";

export const PURSUIT_STAGE_NAME_MAX = 40;

export class RenamePursuitStageDto {
  @IsString()
  @MaxLength(PURSUIT_STAGE_NAME_MAX)
  name!: string;
}

export class CreatePursuitStageDto extends RenamePursuitStageDto {
  @IsIn(PURSUIT_PIPELINES)
  pipeline!: PursuitPipeline;
}

export class ReorderPursuitStagesDto {
  @IsIn(PURSUIT_PIPELINES)
  pipeline!: PursuitPipeline;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_PURSUIT_STAGES)
  ids!: string[];
}
