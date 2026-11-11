import { ArrayMaxSize, IsArray, IsString, MaxLength } from "class-validator";
import { MAX_PURSUIT_PIPELINES, MAX_PURSUIT_STAGES } from "@atrium/shared";

export const PURSUIT_NAME_MAX = 40;

/** A pipeline's or a stage's name. */
export class PursuitNameDto {
  @IsString()
  @MaxLength(PURSUIT_NAME_MAX)
  name!: string;
}

export class CreatePursuitStageDto extends PursuitNameDto {
  @IsString()
  @MaxLength(64)
  pipelineId!: string;
}

export class ReorderPursuitPipelinesDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_PURSUIT_PIPELINES)
  ids!: string[];
}

export class ReorderPursuitStagesDto {
  @IsString()
  @MaxLength(64)
  pipelineId!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_PURSUIT_STAGES)
  ids!: string[];
}
