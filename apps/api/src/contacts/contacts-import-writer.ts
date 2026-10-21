import { randomUUID } from "crypto";
import type { Logger } from "@nestjs/common";
import { Prisma } from "@atrium/database";
import { DEFAULT_LABEL_COLOR } from "@atrium/shared";
import type { PrismaService } from "../prisma/prisma.service";
import { normalizeEmail } from "../contact-sync/contact-sync.service";
import { contactCreateFields } from "./contact-fields";
import { referrerWarning } from "./contacts-import";
import type { ImportDraft, PlannedRow, RowNote } from "./contacts-import";
import { requireName } from "./require-name";

/** Rows per contact INSERT (about 20 columns each, well under Postgres' 65k bind parameters). */
const CHUNK = 500;
/** Companies per company-size UPDATE. */
const SIZE_CHUNK = 1000;

type Referrer = string | { problem: "none" | "several" };

interface Named {
  id: string;
  name: string;
}

type DraftRow = { row: number; draft: ImportDraft; warnings: string[] };

interface ImportRow {
  row: number;
  draft: ImportDraft;
  data: Prisma.ContactCreateManyInput & { id: string };
  labelIds: string[];
  /** The plan's, the referrer's and any extra that couldn't be saved; reported once written. */
  warnings: string[];
  /** Why the write failed, if it did. */
  skip: string | null;
}

export interface ImportResult {
  created: number;
  skipped: RowNote[];
  warnings: RowNote[];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function errorCode(e: unknown): string | undefined {
  return (e as { code?: string })?.code;
}

/** Whether a P2003 names the referrer column (Prisma reports `constraint`; older versions `field_name`). */
function isReferrerFkError(e: unknown): boolean {
  const meta = (e as { meta?: { constraint?: unknown; field_name?: unknown } })?.meta;
  return String(meta?.constraint ?? meta?.field_name ?? "").includes("referredById");
}

function warnOnce(r: ImportRow, reason: string): void {
  if (!r.warnings.includes(reason)) r.warnings.push(reason);
}

/** Companies, lead sources or labels by lowercased name; a name not stored yet gets a new id. */
class NameIndex {
  private readonly ids = new Map<string, string>();
  private readonly moved = new Map<string, string>();
  private readonly failed = new Set<string>();
  pending: Named[] = [];

  constructor(stored: Named[]) {
    for (const s of stored) {
      const key = s.name.toLowerCase();
      if (!this.ids.has(key)) this.ids.set(key, s.id);
    }
  }

  idFor(name: string): string {
    const key = name.toLowerCase();
    const known = this.ids.get(key);
    if (known) return known;
    const id = randomUUID();
    this.ids.set(key, id);
    this.pending.push({ id, name });
    return id;
  }

  /** A pending name another request stored first: rows use that request's id. */
  settle(written: Named[], stored: Named[]): void {
    for (const w of written) {
      const winner = stored.find((s) => s.name === w.name);
      if (winner && winner.id !== w.id) {
        this.moved.set(w.id, winner.id);
        this.ids.set(w.name.toLowerCase(), winner.id);
      }
    }
  }

  stored(id: string): string {
    return this.moved.get(id) ?? id;
  }

  /** Names whose INSERT failed: rows already using them are told so; a later row tries again. */
  fail(rows: Named[]): void {
    for (const r of rows) {
      this.failed.add(r.id);
      const key = r.name.toLowerCase();
      if (this.ids.get(key) === r.id) this.ids.delete(key);
    }
  }

  isFailed(id: string): boolean {
    return this.failed.has(id);
  }
}

/**
 * Writes a planned CSV import with a handful of preloads and batched INSERTs, giving the same
 * result row-by-row writing would: rows are resolved in file order (dedupe, referrers from
 * earlier rows, find-or-create by case-insensitive name), and a chunk whose INSERT fails is
 * retried row by row so one bad row can't sink the rest.
 */
export class ContactImportWriter {
  private readonly takenEmails = new Set<string>();
  private readonly emailIds = new Map<string, string>();
  private readonly nameIds = new Map<string, string[]>();
  /** Emails claimed by a row of this file. */
  private readonly fileEmails = new Map<string, ImportRow>();
  /** Later rows repeating a claimed email: skipped, unless the claiming row fails to write. */
  private readonly standby = new Map<string, { planRow: DraftRow; referrer: Referrer | null }[]>();
  private readonly skipped: RowNote[] = [];
  private companies = new NameIndex([]);
  private sources = new NameIndex([]);
  private labels = new NameIndex([]);
  private readonly today = new Date().toISOString().slice(0, 10);

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
    private readonly orgId: string,
    private readonly userId: string,
  ) {}

  async run(planned: PlannedRow[]): Promise<ImportResult> {
    await this.preload(planned.flatMap((p) => ("draft" in p ? [p.draft] : [])));

    let batch: ImportRow[] = [];
    for (const p of planned) {
      if ("skip" in p) {
        this.skipped.push({ row: p.row, reason: p.skip });
        continue;
      }
      const email = p.draft.contact.email;
      if (email && this.takenEmails.has(email)) {
        this.skipped.push({ row: p.row, reason: "Email already exists" });
        continue;
      }
      const referrer = p.draft.referredBy ? this.findReferrer(p.draft.referredBy) : null;
      if (email && this.fileEmails.has(email)) {
        this.standby.set(email, [...(this.standby.get(email) ?? []), { planRow: p, referrer }]);
        continue;
      }
      const row = this.prepare(p, referrer);
      if (row) batch.push(row);
    }

    const written: ImportRow[] = [];
    while (batch.length) {
      await this.storeNames();
      for (const chunk of chunks(batch, CHUNK)) await this.writeChunk(chunk);
      for (const r of batch) {
        if (r.skip) this.skipped.push({ row: r.row, reason: r.skip });
        else written.push(r);
      }
      batch = this.promoteStandby(batch);
    }
    for (const list of this.standby.values()) {
      for (const s of list) this.skipped.push({ row: s.planRow.row, reason: "Email already exists" });
    }
    written.sort((a, b) => a.row - b.row);
    await this.fillCompanySizes(written);

    return {
      created: written.length,
      skipped: this.skipped.sort((a, b) => a.row - b.row),
      warnings: written.flatMap((r) => r.warnings.map((reason) => ({ row: r.row, reason }))),
    };
  }

  /** Existing emails, referrers named in the file, companies, lead sources and labels. */
  private async preload(drafts: ImportDraft[]): Promise<void> {
    const orgId = this.orgId;
    const refs = drafts.map((d) => d.referredBy).filter(Boolean);
    const emails = [
      ...drafts.flatMap((d) => (d.contact.email ? [d.contact.email] : [])),
      ...refs.filter((r) => r.includes("@")).map(normalizeEmail),
    ];
    const refNames = refs.filter((r) => !r.includes("@"));
    const named = (values: (string | undefined)[]): string[] => [
      ...new Set(values.flatMap((v) => (v?.trim() ? [v.trim()] : []))),
    ];
    const byName = (names: string[]) => ({
      where: { organizationId: orgId, name: { in: names, mode: "insensitive" as const } },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" as const },
    });
    const companyNames = named(drafts.map((d) => d.contact.companyName));
    const sourceNames = named(drafts.map((d) => d.contact.leadSourceName));
    const tagNames = named(drafts.flatMap((d) => d.tags));
    const none = Promise.resolve([] as Named[]);

    const [byEmail, referrers, companies, sources, labels] = await Promise.all([
      emails.length
        ? this.prisma.contact.findMany({
            where: { organizationId: orgId, email: { in: [...new Set(emails)] } },
            select: { id: true, email: true },
          })
        : Promise.resolve([] as { id: string; email: string | null }[]),
      refNames.length ? this.prisma.contact.findMany(byName([...new Set(refNames)])) : none,
      companyNames.length ? this.prisma.company.findMany(byName(companyNames)) : none,
      sourceNames.length ? this.prisma.leadSource.findMany(byName(sourceNames)) : none,
      tagNames.length ? this.prisma.label.findMany(byName(tagNames)) : none,
    ]);

    for (const c of byEmail) {
      if (!c.email) continue;
      this.takenEmails.add(c.email);
      this.emailIds.set(c.email, c.id);
    }
    for (const c of referrers) this.addName(c.name, c.id);
    this.companies = new NameIndex(companies);
    this.sources = new NameIndex(sources);
    this.labels = new NameIndex(labels);
  }

  private addName(name: string, id: string): void {
    const key = name.toLowerCase();
    this.nameIds.set(key, [...(this.nameIds.get(key) ?? []), id]);
  }

  /** An email must match one contact, a name exactly one, counting rows earlier in the file. */
  private findReferrer(value: string): Referrer {
    if (value.includes("@")) {
      const key = normalizeEmail(value);
      return this.emailIds.get(key) ?? this.fileEmails.get(key)?.data.id ?? { problem: "none" };
    }
    const ids = this.nameIds.get(value.toLowerCase()) ?? [];
    if (ids.length === 1) return ids[0];
    return { problem: ids.length ? "several" : "none" };
  }

  /** The row's contact, in memory; null (skipped as invalid) when its fields are rejected. */
  private prepare(p: DraftRow, referrer: Referrer | null): ImportRow | null {
    const { contact, followUpAt } = p.draft;
    let fields: ReturnType<typeof contactCreateFields>;
    let companyName: string | undefined;
    let sourceName: string | undefined;
    try {
      fields = contactCreateFields(contact);
      companyName = contact.companyName == null ? undefined : requireName(contact.companyName);
      sourceName = contact.leadSourceName == null ? undefined : requireName(contact.leadSourceName);
    } catch (e) {
      this.logger.error(`Contact import row ${p.row} failed`, e);
      this.skipped.push({ row: p.row, reason: "Invalid row" });
      return null;
    }
    const id = randomUUID();
    const row: ImportRow = {
      row: p.row,
      draft: p.draft,
      data: {
        id,
        organizationId: this.orgId,
        ...fields,
        email: contact.email,
        companyId: companyName ? this.companies.idFor(companyName) : undefined,
        leadSourceId: sourceName ? this.sources.idFor(sourceName) : undefined,
        referredById: typeof referrer === "string" ? referrer : undefined,
        // Follow-ups are stored at noon UTC of the date. A past one stays overdue on the list
        // but doesn't send a reminder for every imported row.
        ...(followUpAt
          ? {
              followUpAt: new Date(`${followUpAt}T12:00:00.000Z`),
              followUpEveryDays: p.draft.followUpEveryDays,
              followUpOwnerId: this.userId,
              followUpNotifiedAt: followUpAt < this.today ? new Date() : null,
            }
          : {}),
      },
      labelIds: [...new Set(p.draft.tags.map((t) => this.labels.idFor(t)))],
      warnings: [...p.warnings],
      skip: null,
    };
    if (referrer && typeof referrer !== "string") {
      row.warnings.push(referrerWarning(p.draft.referredBy, referrer.problem));
    }
    if (contact.email) this.fileEmails.set(contact.email, row);
    this.addName(fields.name, id);
    return row;
  }

  /** New companies, lead sources and labels, before the contacts that use them. */
  private async storeNames(): Promise<void> {
    const orgId = this.orgId;
    const find = (names: string[]) => ({
      where: { organizationId: orgId, name: { in: names } },
      select: { id: true, name: true },
    });
    const store = async (
      what: string,
      index: NameIndex,
      create: (rows: Named[]) => Promise<{ count: number }>,
      stored: (names: string[]) => Promise<Named[]>,
    ): Promise<void> => {
      const rows = index.pending.splice(0);
      if (!rows.length) return;
      try {
        // skipDuplicates: a name another request just created (same exact name) is used instead.
        const { count } = await create(rows);
        if (count < rows.length) index.settle(rows, await stored(rows.map((r) => r.name)));
      } catch (e) {
        // Not fatal: writeChunk skips (or warns about) the rows that needed these.
        this.logger.error(`Contact import: saving new ${what} failed`, e);
        index.fail(rows);
      }
    };
    const withOrg = (rows: Named[]) => rows.map((r) => ({ ...r, organizationId: orgId }));
    await store(
      "companies",
      this.companies,
      (rows) => this.prisma.company.createMany({ data: withOrg(rows), skipDuplicates: true }),
      (names) => this.prisma.company.findMany(find(names)),
    );
    await store(
      "lead sources",
      this.sources,
      (rows) => this.prisma.leadSource.createMany({ data: withOrg(rows), skipDuplicates: true }),
      (names) => this.prisma.leadSource.findMany(find(names)),
    );
    await store(
      "labels",
      this.labels,
      (rows) =>
        this.prisma.label.createMany({
          data: withOrg(rows).map((r) => ({ ...r, color: DEFAULT_LABEL_COLOR })),
          skipDuplicates: true,
        }),
      (names) => this.prisma.label.findMany(find(names)),
    );
  }

  private async writeChunk(chunk: ImportRow[]): Promise<void> {
    for (const r of chunk) {
      const { companyId, leadSourceId } = r.data;
      if ((companyId && this.companies.isFailed(companyId)) || (leadSourceId && this.sources.isFailed(leadSourceId))) {
        // As when the row's own find-or-create failed, one row at a time.
        r.skip = "Invalid row";
        continue;
      }
      if (companyId) r.data.companyId = this.companies.stored(companyId);
      if (leadSourceId) r.data.leadSourceId = this.sources.stored(leadSourceId);
      const labelIds = r.labelIds.filter((id) => !this.labels.isFailed(id));
      if (labelIds.length < r.labelIds.length) warnOnce(r, "Tags couldn't be saved");
      r.labelIds = labelIds.map((id) => this.labels.stored(id));
    }
    const toWrite = chunk.filter((r) => !r.skip);
    if (toWrite.length) {
      try {
        await this.prisma.contact.createMany({ data: toWrite.map((r) => r.data) });
      } catch (e) {
        this.logger.error("Contact import: a batch insert failed; retrying its rows one by one", e);
        for (const r of toWrite) await this.writeOne(r);
      }
    }
    const ok = chunk.filter((r) => !r.skip);
    const orgId = this.orgId;
    await this.saveExtras(
      ok,
      null,
      (r) => [{ contactId: r.data.id, organizationId: orgId, type: "contact_created", detail: "Contact created" }],
      (data) => this.prisma.contactEvent.createMany({ data }),
    );
    await this.saveExtras(
      ok,
      "Tags",
      (r) => r.labelIds.map((labelId) => ({ contactId: r.data.id, labelId })),
      (data) => this.prisma.contactLabel.createMany({ data, skipDuplicates: true }),
    );
    await this.saveExtras(
      ok,
      "The note",
      (r) =>
        r.draft.notes
          ? [{ contactId: r.data.id, organizationId: orgId, authorId: this.userId, content: r.draft.notes }]
          : [],
      (data) => this.prisma.contactNote.createMany({ data }),
    );
  }

  private async writeOne(r: ImportRow): Promise<void> {
    try {
      await this.prisma.contact.create({ data: r.data });
    } catch (e) {
      const code = errorCode(e);
      if (code === "P2003" && r.data.referredById && isReferrerFkError(e)) {
        // The referrer was an earlier row of this file that couldn't be written.
        r.data.referredById = null;
        r.warnings.push(referrerWarning(r.draft.referredBy, "none"));
        return this.writeOne(r);
      }
      if (code === "P2002") {
        r.skip = "Email already exists";
      } else {
        this.logger.error(`Contact import row ${r.row} failed`, e);
        r.skip = "Invalid row";
      }
    }
  }

  /**
   * One INSERT for every row's records of one kind; if it fails, row by row, so a failure costs
   * only that row's records, reported as "<what> couldn't be saved" when `what` is set.
   */
  private async saveExtras<T>(
    rows: ImportRow[],
    what: string | null,
    recordsOf: (r: ImportRow) => T[],
    createMany: (data: T[]) => Promise<unknown>,
  ): Promise<void> {
    const all = rows.flatMap(recordsOf);
    if (!all.length) return;
    try {
      await createMany(all);
      return;
    } catch (e) {
      this.logger.error(`Contact import: saving ${what ?? "events"} in bulk failed; retrying row by row`, e);
    }
    for (const r of rows) {
      const records = recordsOf(r);
      if (!records.length) continue;
      try {
        await createMany(records);
      } catch (e) {
        this.logger.error(`Contact import row ${r.row}: ${(what ?? "event").toLowerCase()} failed`, e);
        if (what) warnOnce(r, `${what} couldn't be saved`);
      }
    }
  }

  /**
   * For each row that failed to write (not as a duplicate), the next row with its email gets a
   * turn, as it would have had the rows been written one at a time.
   */
  private promoteStandby(batch: ImportRow[]): ImportRow[] {
    const next: ImportRow[] = [];
    for (const failed of batch) {
      const email = failed.data.email;
      if (failed.skip !== "Invalid row" || !email) continue;
      this.fileEmails.delete(email);
      const waiting = this.standby.get(email) ?? [];
      while (waiting.length) {
        const s = waiting.shift();
        const row = s && this.prepare(s.planRow, s.referrer);
        if (row) {
          next.push(row);
          break;
        }
      }
    }
    return next;
  }

  /**
   * Imported company size only fills empty fields; values typed in the app win. Per company,
   * the first written row (in file order) that has a value supplies it.
   */
  private async fillCompanySizes(written: ImportRow[]): Promise<void> {
    const columns = [
      ["annualRevenue", Prisma.raw(`"annualRevenue"`)],
      ["employeeCount", Prisma.raw(`"employeeCount"`)],
    ] as const;
    for (const [key, column] of columns) {
      const values = new Map<string, number>();
      const rowsOf = new Map<string, ImportRow[]>();
      for (const r of written) {
        const value = r.draft.company[key];
        const companyId = r.data.companyId;
        if (value === undefined || !companyId) continue;
        if (!values.has(companyId)) values.set(companyId, value);
        rowsOf.set(companyId, [...(rowsOf.get(companyId) ?? []), r]);
      }
      for (const ids of chunks([...values.keys()], SIZE_CHUNK)) {
        const rows = Prisma.join(ids.map((id) => Prisma.sql`(${id}, ${values.get(id)}::int)`));
        try {
          await this.prisma.$executeRaw`
            UPDATE company AS c SET ${column} = v.value, "updatedAt" = NOW()
            FROM (VALUES ${rows}) AS v(id, value)
            WHERE c.id = v.id AND c."organizationId" = ${this.orgId} AND c.${column} IS NULL`;
        } catch (e) {
          this.logger.error("Contact import: filling company sizes failed", e);
          for (const r of ids.flatMap((id) => rowsOf.get(id) ?? [])) {
            warnOnce(r, "The company size couldn't be saved");
          }
        }
      }
    }
  }
}
