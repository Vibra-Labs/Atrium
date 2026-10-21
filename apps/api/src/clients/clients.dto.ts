import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";
import { PaginationQueryDto } from "../common";

export const MEMBER_KINDS = ["staff", "client"] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];

export class ListMembersQueryDto extends PaginationQueryDto {
  /** staff = owners and admins; client = portal clients (role "member"). */
  @IsOptional()
  @IsIn(MEMBER_KINDS)
  role?: MemberKind;
}

export class ChangeRoleDto {
  @IsString()
  @IsIn(["owner", "admin", "member"])
  role!: string;
}

export class SetRateDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  hourlyRateCents?: number | null;
}
