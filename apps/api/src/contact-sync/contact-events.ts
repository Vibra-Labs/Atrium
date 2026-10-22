import type { PrismaService } from "../prisma/prisma.service";

/** Adds an entry to a contact's timeline. */
export async function addContactEvent(
  prisma: PrismaService,
  contactId: string,
  organizationId: string,
  type: string,
  detail: string,
  refId?: string,
): Promise<void> {
  await prisma.contactEvent.create({
    data: { contactId, organizationId, type, detail, ...(refId ? { refId } : {}) },
  });
}
