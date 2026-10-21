import { Injectable } from "@nestjs/common";
import { Prisma } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";

export interface Revenue {
  paidCents: number;
  outstandingCents: number;
  monthly: { month: string; paidCents: number }[];
}

interface InvoiceRow {
  status: string;
  paidAt: Date | null;
  paidCents: bigint | number;
  totalCents: bigint | number;
}

const MONTHS = 12;

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

@Injectable()
export class ContactRevenueService {
  constructor(private readonly prisma: PrismaService) {}

  forContact(contactId: string, orgId: string, now: Date): Promise<Revenue> {
    return this.compute(Prisma.sql`pc."contactId" = ${contactId}`, orgId, now);
  }

  forCompany(companyId: string, orgId: string, now: Date): Promise<Revenue> {
    return this.compute(
      Prisma.sql`pc."contactId" IN (SELECT id FROM "contact" WHERE "companyId" = ${companyId} AND "organizationId" = ${orgId})`,
      orgId,
      now,
    );
  }

  /** Paid total per contact; `null` ids means every contact in the workspace. */
  async paidTotals(contactIds: string[] | null, orgId: string): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    if (contactIds?.length === 0) return totals;
    const only = contactIds ? Prisma.sql`pc."contactId" IN (${Prisma.join(contactIds)})` : Prisma.sql`TRUE`;
    const rows = await this.prisma.$queryRaw<
      Array<{ contactId: string; paid: bigint | number }>
    >`
      SELECT pc."contactId" AS "contactId", COALESCE(SUM(t."paidCents"), 0) AS paid
      FROM "project_contact" pc
      JOIN "contact" c ON c.id = pc."contactId" AND c."organizationId" = ${orgId}
      JOIN (${this.invoiceTotals(orgId)}) t ON t."projectId" = pc."projectId"
      WHERE ${only} AND t.status = 'paid'
      GROUP BY pc."contactId"
    `;
    for (const r of rows) totals.set(r.contactId, Number(r.paid));
    return totals;
  }

  /**
   * Paid total per company; an invoice shared by several of its contacts counts once.
   * `null` ids means every company in the workspace.
   */
  async paidTotalsForCompanies(companyIds: string[] | null, orgId: string): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    if (companyIds?.length === 0) return totals;
    const only = companyIds
      ? Prisma.sql`c."companyId" IN (${Prisma.join(companyIds)})`
      : Prisma.sql`c."companyId" IS NOT NULL`;
    const rows = await this.prisma.$queryRaw<
      Array<{ companyId: string; paid: bigint | number }>
    >`
      SELECT d."companyId" AS "companyId", COALESCE(SUM(d."paidCents"), 0) AS paid
      FROM (
        SELECT DISTINCT c."companyId", t.id, t."paidCents"
        FROM "project_contact" pc
        JOIN "contact" c ON c.id = pc."contactId" AND c."organizationId" = ${orgId}
        JOIN (${this.invoiceTotals(orgId)}) t ON t."projectId" = pc."projectId"
        WHERE ${only} AND t.status = 'paid'
      ) d
      GROUP BY d."companyId"
    `;
    for (const r of rows) totals.set(r.companyId, Number(r.paid));
    return totals;
  }

  /** One row per invoice with its total and paid amount, so line items never fan out sums. */
  private invoiceTotals(orgId: string): Prisma.Sql {
    return Prisma.sql`
      SELECT i.id, i.status, i."projectId", i."paidAt",
        CASE WHEN i.type = 'uploaded' THEN COALESCE(i.amount, 0)
             ELSE COALESCE((SELECT SUM(li.quantity * li."unitPrice") FROM "invoice_line_item" li WHERE li."invoiceId" = i.id), 0)
        END AS "totalCents",
        COALESCE(i."paidAmount",
          CASE WHEN i.type = 'uploaded' THEN COALESCE(i.amount, 0)
               ELSE COALESCE((SELECT SUM(li.quantity * li."unitPrice") FROM "invoice_line_item" li WHERE li."invoiceId" = i.id), 0)
          END) AS "paidCents"
      FROM "invoice" i
      WHERE i."organizationId" = ${orgId} AND i."projectId" IS NOT NULL
    `;
  }

  private async compute(contactFilter: Prisma.Sql, orgId: string, now: Date): Promise<Revenue> {
    // DISTINCT on invoice id so a project shared by several contacts counts once.
    const rows = await this.prisma.$queryRaw<InvoiceRow[]>`
      SELECT t.status, t."paidAt", t."paidCents", t."totalCents"
      FROM (${this.invoiceTotals(orgId)}) t
      WHERE t.id IN (
        SELECT DISTINCT t2.id
        FROM "project_contact" pc
        JOIN "contact" c ON c.id = pc."contactId" AND c."organizationId" = ${orgId}
        JOIN "invoice" t2 ON t2."projectId" = pc."projectId" AND t2."organizationId" = ${orgId}
        WHERE ${contactFilter}
      )
    `;

    const monthly: Revenue["monthly"] = [];
    for (let i = MONTHS - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      monthly.push({ month: monthKey(d), paidCents: 0 });
    }
    const byMonth = new Map(monthly.map((m) => [m.month, m]));

    let paidCents = 0;
    let outstandingCents = 0;
    for (const r of rows) {
      if (r.status === "paid") {
        const cents = Number(r.paidCents);
        paidCents += cents;
        const bucket = r.paidAt ? byMonth.get(monthKey(r.paidAt)) : undefined;
        if (bucket) bucket.paidCents += cents;
      } else if (r.status === "sent" || r.status === "overdue") {
        outstandingCents += Number(r.totalCents);
      }
    }
    return { paidCents, outstandingCents, monthly };
  }
}
