import type { Prisma, PrismaClient } from "@atrium/database";
import { MCP_ACTOR_ROLES } from "./mcp-actor-roles";

type CredentialClient = Pick<PrismaClient, "apiKey" | "mcpGrant">;

/**
 * Revokes the API keys and drops the MCP grants issued under one membership.
 * Called when a member loses the owner/admin role: resolving a token already
 * refuses a demoted member, but without this a later re-promotion would bring
 * every old key and connected app back without anyone re-approving them.
 *
 * Removal needs no call: both tables cascade from `member`.
 *
 * Returns the queries unawaited so callers can put them in the same
 * `$transaction` as the role change.
 */
export function revokeMemberCredentials(
  prisma: CredentialClient,
  memberId: string,
): [Prisma.PrismaPromise<Prisma.BatchPayload>, Prisma.PrismaPromise<Prisma.BatchPayload>] {
  return [
    prisma.apiKey.updateMany({
      where: { memberId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.mcpGrant.deleteMany({ where: { memberId } }),
  ];
}

/** For role changes made outside `ClientsService`, e.g. Better Auth's own
 * `/organization/update-member-role`, which only offers an after-hook. */
export async function revokeCredentialsIfDemoted(
  prisma: CredentialClient & Pick<PrismaClient, "$transaction">,
  member: { id: string; role: string },
): Promise<void> {
  if (MCP_ACTOR_ROLES.includes(member.role)) return;
  await prisma.$transaction(revokeMemberCredentials(prisma, member.id));
}
