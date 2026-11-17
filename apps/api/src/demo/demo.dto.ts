import { IsIn } from "class-validator";
import type { DemoKind } from "./demo-config";

export class DemoEnterDto {
  @IsIn(["owner", "client"])
  kind!: DemoKind;
}
