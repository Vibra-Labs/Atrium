/** True for Prisma's unique-constraint error (P2002), e.g. a duplicate name or a lost create race. */
export function isPrismaUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}
