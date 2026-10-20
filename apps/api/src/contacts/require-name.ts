import { BadRequestException } from "@nestjs/common";

/** Trims a company / lead source name, rejecting one that is blank. */
export function requireName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new BadRequestException("Name is required");
  return name;
}
