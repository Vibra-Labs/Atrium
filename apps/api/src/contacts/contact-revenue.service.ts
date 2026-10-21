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

const PAID_ONLY = Prisma.sql`i.status = 'paid'`;

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
    const rows = await this.prisma.$queryRaw<Array<{ contactId: string; paid: bigint | number }>>(
      this.paidPerContactSql(orgId, only),
    );
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
    const only = companyIds ? Prisma.sql`c."companyId" IN (${Prisma.join(companyIds)})` : Prisma.sql`TRUE`;
    const rows = await this.prisma.$queryRaw<Array<{ companyId: string; paid: bigint | number }>>(
      this.paidPerCompanySql(orgId, only),
    );
    for (const r of rows) totals.set(r.companyId, Number(r.paid));
    return totals;
  }

  /**
   * A query yielding `("contactId", paid)` for each contact with a paid invoice, limited by
   * `only` (over `pc`, the project_contact row). Usable as a subquery.
   */
  paidPerContactSql(orgId: string, only: Prisma.Sql = Prisma.sql`TRUE`): Prisma.Sql {
    return Prisma.sql`
      WITH t AS MATERIALIZED (${this.invoiceTotals(orgId, PAID_ONLY)})
      SELECT pc."contactId" AS "contactId", SUM(t."paidCents") AS paid
      FROM "project_contact" pc
      JOIN "contact" c ON c.id = pc."contactId" AND c."organizationId" = ${orgId}
      JOIN t ON t."projectId" = pc."projectId"
      WHERE ${only}
      GROUP BY pc."contactId"
    `;
  }

  /**
   * A query yielding `("companyId", paid)` for each company with a paid invoice, limited by
   * `only` (over `c`, the contact row); an invoice shared by several contacts counts once.
   */
  paidPerCompanySql(orgId: string, only: Prisma.Sql = Prisma.sql`TRUE`): Prisma.Sql {
    return Prisma.sql`
      WITH t AS MATERIALIZED (${this.invoiceTotals(orgId, PAID_ONLY)})
      SELECT d."companyId" AS "companyId", SUM(d."paidCents") AS paid
      FROM (
        SELECT DISTINCT c."companyId", t.id, t."paidCents"
        FROM "project_contact" pc
        JOIN "contact" c ON c.id = pc."contactId" AND c."organizationId" = ${orgId}
        JOIN t ON t."projectId" = pc."projectId"
        WHERE c."companyId" IS NOT NULL AND ${only}
      ) d
      GROUP BY d."companyId"
    `;
  }

  /**
   * One row per invoice matching `filter` (over `i`) with its total and paid amount. Callers
   * wrap it in a MATERIALIZED CTE so line items are summed once per invoice, not per joined row.
   */
  private invoiceTotals(orgId: string, filter: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
      SELECT i.id, i.status, i."projectId", i."paidAt", x.total AS "totalCents",
        COALESCE(i."paidAmount", x.total) AS "paidCents"
      FROM "invoice" i
      LEFT JOIN LATERAL (
        SELECT SUM(li.quantity * li."unitPrice") AS s FROM "invoice_line_item" li WHERE li."invoiceId" = i.id
      ) li ON TRUE
      CROSS JOIN LATERAL (
        SELECT CASE WHEN i.type = 'uploaded' THEN COALESCE(i.amount, 0) ELSE COALESCE(li.s, 0) END AS total
      ) x
      WHERE i."organizationId" = ${orgId} AND i."projectId" IS NOT NULL AND ${filter}
    `;
  }

  private async compute(contactFilter: Prisma.Sql, orgId: string, now: Date): Promise<Revenue> {
    // DISTINCT on invoice id so a project shared by several contacts counts once.
    const linked = Prisma.sql`i.id IN (
      SELECT DISTINCT i2.id
      FROM "project_contact" pc
      JOIN "contact" c ON c.id = pc."contactId" AND c."organizationId" = ${orgId}
      JOIN "invoice" i2 ON i2."projectId" = pc."projectId" AND i2."organizationId" = ${orgId}
      WHERE ${contactFilter}
    )`;
    const rows = await this.prisma.$queryRaw<InvoiceRow[]>`
      WITH t AS MATERIALIZED (${this.invoiceTotals(orgId, linked)})
      SELECT t.status, t."paidAt", t."paidCents", t."totalCents" FROM t
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
