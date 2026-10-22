import type { Prisma } from "@atrium/database";

export interface EndedLink {
  id: string;
  endedAt: Date;
}

/**
 * Locks the project row until the transaction ends and returns its current client user ids.
 * Project edits and client linking both take it, so neither works from a stale client list.
 */
export async function lockProjectClients(tx: Prisma.TransactionClient, projectId: string): Promise<string[]> {
  await tx.$queryRaw`SELECT id FROM "project" WHERE id = ${projectId} FOR UPDATE`;
  const rows: { userId: string }[] = await tx.projectClient.findMany({
    where: { projectId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * Reopens ended project links. The time each was ended is kept as a gap, so invoices paid
 * while the contact was off the project still don't count toward them.
 */
export async function reopenProjectLinks(db: Prisma.TransactionClient, links: EndedLink[], now: Date): Promise<void> {
  if (links.length === 0) return;
  await db.projectContactGap.createMany({
    data: links.map((l) => ({ projectContactId: l.id, startedAt: l.endedAt, endedAt: now })),
  });
  await db.projectContact.updateMany({
    where: { id: { in: links.map((l) => l.id) }, endedAt: { not: null } },
    data: { endedAt: null },
  });
}

/**
 * The links that get an invoice paid at `paidAt`, the same rule revenue uses: an ended link only
 * gets invoices paid until it ended, and no link gets one paid inside a gap. An invoice with no
 * paid date counts for every link.
 */
export function linksPaidAt(paidAt: Date | null): Prisma.ProjectContactWhereInput {
  if (!paidAt) return {};
  return {
    OR: [{ endedAt: null }, { endedAt: { gte: paidAt } }],
    gaps: { none: { startedAt: { lt: paidAt }, endedAt: { gt: paidAt } } },
  };
}
