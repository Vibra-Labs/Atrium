import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@atrium/database";
import type { Contact } from "@atrium/database";
import { DEFAULT_LABEL_COLOR, keepMentions, mentionedContactIds } from "@atrium/shared";
import type { ContactPhone, ContactRating, ContactStatus } from "@atrium/shared";
import { PrismaService } from "../prisma/prisma.service";
import { paginationArgs, paginatedResponse, toCsv } from "../common";
import type { CsvColumn } from "../common";
import { normalizeEmail } from "../contact-sync/contact-sync.service";
import { ContactRevenueService } from "./contact-revenue.service";
import { contactSortValue, rankRows } from "./contacts-sort";
import type { SortableContact } from "./contacts-sort";
import { MAX_IMPORT_ROWS, parseCsv } from "./contacts-csv";
import type { ImportMapping } from "./contacts-csv";
import { planImport } from "./contacts-import";
import type { ImportDraft, PlannedRow } from "./contacts-import";
import { TIMELINE_MAX_PAGE } from "./contacts.dto";
import type {
  ContactSort,
  CreateContactDto,
  ListContactsQueryDto,
  SetFollowUpDto,
  SortDirection,
  UpdateContactDto,
} from "./contacts.dto";
import { requireName } from "./require-name";
import {
  createNames,
  normalizeSocialLinks,
  optionalText,
  phonesOf,
  resolvePhones,
  updateNames,
} from "./contact-fields";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOO_MANY_ROWS = "CSV has more than 5,000 rows";
const IMPORT_SAMPLE_SIZE = 5;

export interface RowNote {
  row: number;
  reason: string;
}

/** One contact as the import preview shows it. */
export interface ImportSample {
  row: number;
  name: string;
  email: string | null;
  company: string | null;
  phones: ContactPhone[];
  status: string;
  rating: string | null;
  tags: string[];
  followUpAt: string | null;
  followUpEveryDays: number | null;
  referredBy: string | null;
  companyRevenue: number | null;
  companyEmployees: number | null;
}

function referrerWarning(value: string, problem: "none" | "several"): string {
  const what = problem === "none" ? "matches no contact" : "matches several contacts";
  return `Referred by "${value.slice(0, 100)}" ${what}; left out`;
}

const STATUS_LABELS: Record<ContactStatus, string> = {
  lead: "Lead",
  client: "Client",
  past_client: "Past client",
};

const PORTAL_ACCESS_LABELS: Record<PortalAccess | "none", string> = {
  portal: "Yes",
  pending: "Invite pending",
  none: "",
};

const RATING_LABELS: Record<ContactRating, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };

function formatPhones(phones: ContactPhone[]): string {
  return phones.map((p) => `${p.label}: ${p.number}`).join("; ");
}

function readLinks(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * "About" text to store: blank or null becomes "" (cleared), never null, because null marks a
 * contact the legacy client-profile import may still fill in.
 */
function aboutText(value: string | null | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value?.trim() ?? "";
}

function portalAccessOf(
  contact: { userId: string | null; email: string | null },
  pendingEmails: Set<string>,
): PortalAccess | null {
  if (contact.userId) return "portal";
  return contact.email && pendingEmails.has(contact.email) ? "pending" : null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Follow-ups are calendar dates, stored at noon UTC of the date so whole-day steps never cross
 * a day boundary and the UTC date reads the same in every time zone.
 */
function noonUtc(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

/** Noon UTC of now's UTC date plus `days`. */
function noonUtcInDays(now: Date, days: number): Date {
  return new Date(noonUtc(now.toISOString().slice(0, 10)).getTime() + days * DAY_MS);
}

/** "YYYY-MM-DD" -> noon UTC; a full ISO timestamp (API/MCP callers) is kept as sent. */
function parseFollowUpAt(value: string): Date {
  return DATE_ONLY.test(value) ? noonUtc(value) : new Date(value);
}

/**
 * Next date of a repeating follow-up: the previous date stepped forward by whole days until it
 * is after now. With no previous date, noon UTC today + the interval.
 */
function nextRepeat(previous: Date | null, everyDays: number, now: Date): Date {
  const step = everyDays * DAY_MS;
  if (!previous) return noonUtcInDays(now, everyDays);
  const behind = Math.max(0, now.getTime() - previous.getTime());
  return new Date(previous.getTime() + (Math.floor(behind / step) + 1) * step);
}

export type PortalAccess = "portal" | "pending";

/** What a portal client sees and edits about themselves (the old ClientProfile shape). */
export interface PortalProfile {
  company: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  description: string | null;
}

export interface PortalProfileInput {
  company?: string;
  phone?: string;
  address?: string;
  website?: string;
  description?: string;
}

export interface TimelineItem {
  kind: "note" | "event";
  id: string;
  createdAt: Date;
  content?: string;
  detail?: string;
  type?: string;
  /** For a "mentioned" event: the contact whose note mentioned this one. */
  refId?: string | null;
  author?: { id: string; name: string };
}

interface NameWhere {
  organizationId: string;
  name: { equals: string; mode: "insensitive" };
}

interface ResolvedLinks {
  companyId?: string | null;
  leadSourceId?: string | null;
  referredById?: string | null;
}

interface StoredContact {
  profileImportedAt?: Date | null;
  phone?: string | null;
  phones?: unknown;
  socialLinks?: unknown;
}

type ContactResponse<T> = Omit<T, "profileImportedAt" | "phones" | "socialLinks"> & {
  phones: ContactPhone[];
  socialLinks: string[];
};

export type ContactRecord = ContactResponse<Contact>;

/**
 * Drops the import marker and narrows the Json columns: Prisma's JsonValue can't be named
 * across packages, so it would make the controllers' inferred return types unportable.
 */
function toResponse<T extends StoredContact>(contact: T): ContactResponse<T> {
  const { profileImportedAt: _imported, phones, socialLinks, ...rest } = contact;
  // Until the backfill reaches a row, its legacy phone stands in for the phones list.
  return { ...rest, phones: phonesOf(phones, contact.phone), socialLinks: readLinks(socialLinks) };
}

/** Database order for a contacts list sort; name then id keep pages stable. */
function contactOrderBy(sort: "name" | "followUp", dir: SortDirection): Prisma.ContactOrderByWithRelationInput[] {
  if (sort === "name") return [{ name: dir }, { id: "asc" }];
  return [{ followUpAt: { sort: dir, nulls: "last" } }, { name: "asc" }, { id: "asc" }];
}

/** Just what ranking a contact by a list column needs. */
const SORTABLE_SELECT = {
  id: true,
  name: true,
  status: true,
  followUpAt: true,
  company: { select: { name: true } },
} as const;

function sortableOf(c: {
  id: string;
  name: string;
  status: string;
  followUpAt: Date | null;
  company: { name: string } | null;
}): SortableContact {
  return { id: c.id, name: c.name, status: c.status, followUpAt: c.followUpAt, companyName: c.company?.name ?? null };
}

type LinkFields = Pick<
  UpdateContactDto,
  "companyId" | "companyName" | "leadSourceId" | "leadSourceName" | "referredById"
>;

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: ContactRevenueService,
  ) {}

  async findAll(orgId: string, query: ListContactsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const pending = await this.pendingInviteEmails(orgId);
    const where = this.buildWhere(orgId, query, pending);
    const include = {
      company: { select: { id: true, name: true } },
      labels: { include: { label: true } },
    } as const;

    const sort: ContactSort = query.sort ?? "name";
    let contacts;
    let total: number;
    let paid: Map<string, number>;
    if (sort === "paid" || sort === "status" || sort === "company") {
      // The database can't order these the way the list shows them (paid comes from invoices,
      // status follows the pipeline, blank companies go last), so rank every match here.
      const [matches, allPaid] = await Promise.all([
        this.prisma.contact.findMany({ where, select: SORTABLE_SELECT }),
        sort === "paid" ? this.revenue.paidTotals(null, orgId) : Promise.resolve(new Map<string, number>()),
      ]);
      const dir = query.dir ?? (sort === "paid" ? "desc" : "asc");
      const pageIds = rankRows(matches.map(sortableOf), dir, (r) => contactSortValue(sort, r, allPaid)).slice(
        (page - 1) * limit,
        page * limit,
      );
      const rows = await this.prisma.contact.findMany({ where: { id: { in: pageIds } }, include });
      const byId = new Map(rows.map((r) => [r.id, r]));
      contacts = pageIds.flatMap((id) => byId.get(id) ?? []);
      total = matches.length;
      paid = sort === "paid" ? allPaid : await this.revenue.paidTotals(pageIds, orgId);
    } else {
      [contacts, total] = await Promise.all([
        this.prisma.contact.findMany({
          where,
          orderBy: contactOrderBy(sort, query.dir ?? "asc"),
          include,
          ...paginationArgs(page, limit),
        }),
        this.prisma.contact.count({ where }),
      ]);
      paid = await this.revenue.paidTotals(
        contacts.map((c) => c.id),
        orgId,
      );
    }
    const pendingSet = new Set(pending);
    const data = contacts.map((c) => ({
      id: c.id,
      name: c.name,
      firstName: c.firstName,
      lastName: c.lastName,
      jobTitle: c.jobTitle,
      department: c.department,
      email: c.email,
      phones: phonesOf(c.phones, c.phone),
      socialLinks: readLinks(c.socialLinks),
      rating: c.rating,
      status: c.status,
      company: c.company,
      followUpAt: c.followUpAt,
      followUpEveryDays: c.followUpEveryDays,
      paidCents: paid.get(c.id) ?? 0,
      labels: c.labels.map((l) => ({
        id: l.label.id,
        name: l.label.name,
        color: l.label.color,
      })),
      hasLogin: c.userId != null,
      portalAccess: portalAccessOf(c, pendingSet),
    }));
    return paginatedResponse(data, total, page, limit);
  }

  /**
   * Lowercased emails with an open portal invitation (role "member", pending, unexpired) in this
   * workspace. Contact emails are stored lowercased, so matching them is case-insensitive.
   */
  async pendingInviteEmails(orgId: string, now: Date = new Date()): Promise<string[]> {
    const rows = await this.prisma.invitation.findMany({
      where: { organizationId: orgId, role: "member", status: "pending", expiresAt: { gt: now } },
      select: { email: true },
    });
    return [...new Set(rows.map((r) => normalizeEmail(r.email)))];
  }

  private buildWhere(
    orgId: string,
    query: ListContactsQueryDto,
    pendingEmails: string[],
  ): Prisma.ContactWhereInput {
    const where: Prisma.ContactWhereInput = { organizationId: orgId };
    if (query.access === "portal") where.userId = { not: null };
    if (query.access === "pending") {
      where.userId = null;
      where.email = { in: pendingEmails };
    }
    if (query.access === "none") {
      where.userId = null;
      // NOT IN drops null emails in SQL, so contacts without an email are let through explicitly.
      if (pendingEmails.length > 0) {
        where.AND = [{ OR: [{ email: null }, { email: { notIn: pendingEmails } }] }];
      }
    }
    if (query.status) where.status = query.status;
    if (query.rating) where.rating = query.rating;
    if (query.leadSourceId) where.leadSourceId = query.leadSourceId;
    if (query.companyId) where.companyId = query.companyId;
    if (query.labelId) where.labels = { some: { labelId: query.labelId } };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { company: { name: { contains: search, mode: "insensitive" } } },
      ];
    }
    return where;
  }

  previewCsv(csv: string): { headers: string[]; rows: string[][]; total: number } {
    const [headers = [], ...data] = parseCsv(csv);
    if (data.length > MAX_IMPORT_ROWS) throw new BadRequestException(TOO_MANY_ROWS);
    return { headers, rows: data.slice(0, 5), total: data.length };
  }

  async importCsv(
    dto: { csv: string; mapping: ImportMapping },
    orgId: string,
    userId: string,
  ): Promise<{ created: number; skipped: RowNote[]; warnings: RowNote[] }> {
    const planned = this.planCsv(dto.csv, dto.mapping);
    const skipped: RowNote[] = [];
    // Non-fatal: the contact was imported, but something in the row was left out.
    const warnings: RowNote[] = [];
    let created = 0;
    // Only emails this import actually wrote make a later row a duplicate.
    const createdEmails = new Set<string>();

    for (const planRow of planned) {
      if ("skip" in planRow) {
        skipped.push({ row: planRow.row, reason: planRow.skip });
        continue;
      }
      const { row, draft } = planRow;
      const email = draft.contact.email;
      if (email && createdEmails.has(email)) {
        skipped.push({ row, reason: "Email already exists" });
        continue;
      }
      // Rows are written in order, so a referrer added earlier in the file is found here.
      const referrer = draft.referredBy ? await this.findReferrer(draft.referredBy, orgId) : null;
      let contact: ContactRecord;
      try {
        contact = await this.create(
          { ...draft.contact, referredById: typeof referrer === "string" ? referrer : undefined },
          orgId,
        );
      } catch (e) {
        if (e instanceof ConflictException) {
          skipped.push({ row, reason: "Email already exists" });
        } else {
          this.logger.error(`Contact import row ${row} failed`, e);
          skipped.push({ row, reason: "Invalid row" });
        }
        continue;
      }
      created++;
      if (email) createdEmails.add(email);
      for (const reason of planRow.warnings) warnings.push({ row, reason });
      if (referrer && typeof referrer !== "string") {
        warnings.push({ row, reason: referrerWarning(draft.referredBy, referrer.problem) });
      }
      // The contact exists; each extra is saved on its own so one failure doesn't drop the rest.
      const extras: [string, () => Promise<unknown>][] = [
        ["Tags", () => this.attachTags(contact.id, draft.tags, orgId)],
        [
          "The note",
          async () => {
            if (!draft.notes) return;
            await this.prisma.contactNote.create({
              data: { contactId: contact.id, organizationId: orgId, authorId: userId, content: draft.notes },
            });
          },
        ],
        ["The follow-up", () => this.importFollowUp(contact.id, draft, orgId, userId)],
        [
          "The company size",
          async () => {
            if (contact.companyId) await this.fillCompanySize(contact.companyId, draft.company, orgId);
          },
        ],
      ];
      for (const [what, save] of extras) {
        try {
          await save();
        } catch (e) {
          this.logger.error(`Contact import row ${row}: ${what.toLowerCase()} failed`, e);
          warnings.push({ row, reason: `${what} couldn't be saved` });
        }
      }
    }
    return { created, skipped, warnings };
  }

  /** A past date stays overdue on the list but doesn't send a reminder for every imported row. */
  private async importFollowUp(contactId: string, draft: ImportDraft, orgId: string, userId: string): Promise<void> {
    if (!draft.followUpAt) return;
    await this.setFollowUp(
      contactId,
      { followUpAt: draft.followUpAt, everyDays: draft.followUpEveryDays ?? undefined },
      orgId,
      userId,
    );
    if (draft.followUpAt < new Date().toISOString().slice(0, 10)) {
      await this.prisma.contact.updateMany({
        where: { id: contactId, organizationId: orgId },
        data: { followUpNotifiedAt: new Date() },
      });
    }
  }

  /** Dry run of importCsv: what would be created, skipped and left out, with nothing written. */
  async checkImport(
    dto: { csv: string; mapping: ImportMapping },
    orgId: string,
  ): Promise<{ total: number; toCreate: number; skipped: RowNote[]; warnings: RowNote[]; sample: ImportSample[] }> {
    const planned = this.planCsv(dto.csv, dto.mapping);
    const drafts = planned.flatMap((p) => ("draft" in p ? [p.draft] : []));
    const emails = drafts.flatMap((d) => (d.contact.email ? [d.contact.email] : []));
    const refs = drafts.map((d) => d.referredBy).filter(Boolean);
    const refNames = refs.filter((r) => !r.includes("@"));
    const refEmails = refs.filter((r) => r.includes("@")).map(normalizeEmail);

    const [taken, knownNames, knownEmails] = await Promise.all([
      this.existingEmails(emails, orgId),
      refNames.length
        ? this.prisma.contact
            .findMany({
              where: { organizationId: orgId, name: { in: refNames, mode: "insensitive" } },
              select: { name: true },
            })
            .then((rows) => rows.map((c) => c.name.toLowerCase()))
        : Promise.resolve([] as string[]),
      this.existingEmails(refEmails, orgId),
    ]);

    const skipped: RowNote[] = [];
    const warnings: RowNote[] = [];
    const sample: ImportSample[] = [];
    // Contacts this import creates before a given row, so a later row can name them as referrer.
    const earlierNames: string[] = [];
    const earlierEmails = new Set<string>();
    for (const p of planned) {
      if ("skip" in p) {
        skipped.push({ row: p.row, reason: p.skip });
        continue;
      }
      const { contact } = p.draft;
      if (contact.email && (taken.has(contact.email) || earlierEmails.has(contact.email))) {
        skipped.push({ row: p.row, reason: "Email already exists" });
        continue;
      }
      const name = createNames(contact).name;
      for (const reason of p.warnings) warnings.push({ row: p.row, reason });
      const ref = p.draft.referredBy;
      if (ref) {
        const key = ref.includes("@") ? normalizeEmail(ref) : ref.toLowerCase();
        const matches = ref.includes("@")
          ? Number(knownEmails.has(key) || earlierEmails.has(key))
          : [...knownNames, ...earlierNames].filter((n) => n === key).length;
        if (matches !== 1) warnings.push({ row: p.row, reason: referrerWarning(ref, matches ? "several" : "none") });
      }
      earlierNames.push(name.toLowerCase());
      if (contact.email) earlierEmails.add(contact.email);
      if (sample.length < IMPORT_SAMPLE_SIZE) {
        sample.push({
          row: p.row,
          name,
          email: contact.email ?? null,
          company: contact.companyName ?? null,
          phones: contact.phones ?? [],
          status: contact.status ?? "lead",
          rating: contact.rating ?? null,
          tags: p.draft.tags,
          followUpAt: p.draft.followUpAt,
          followUpEveryDays: p.draft.followUpEveryDays,
          referredBy: ref || null,
          // Shown so a misread number (e.g. a European "2.500") is caught before importing.
          companyRevenue: p.draft.company.annualRevenue ?? null,
          companyEmployees: p.draft.company.employeeCount ?? null,
        });
      }
    }
    return { total: planned.length, toCreate: planned.length - skipped.length, skipped, warnings, sample };
  }

  private async existingEmails(emails: string[], orgId: string): Promise<Set<string>> {
    if (emails.length === 0) return new Set();
    const rows = await this.prisma.contact.findMany({
      where: { organizationId: orgId, email: { in: emails } },
      select: { email: true },
    });
    return new Set(rows.flatMap((c) => (c.email ? [c.email] : [])));
  }

  private planCsv(csv: string, mapping: ImportMapping): PlannedRow[] {
    const [headers = [], ...data] = parseCsv(csv);
    if (data.length > MAX_IMPORT_ROWS) throw new BadRequestException(TOO_MANY_ROWS);
    return planImport(headers, data, mapping);
  }

  /** A contact id, or why none was used: an email must match one contact, a name exactly one. */
  private async findReferrer(value: string, orgId: string): Promise<string | { problem: "none" | "several" }> {
    if (value.includes("@")) {
      const byEmail = await this.prisma.contact.findFirst({
        where: { organizationId: orgId, email: normalizeEmail(value) },
        select: { id: true },
      });
      return byEmail ? byEmail.id : { problem: "none" };
    }
    const byName = await this.prisma.contact.findMany({
      where: { organizationId: orgId, name: { equals: value, mode: "insensitive" } },
      select: { id: true },
      take: 2,
    });
    if (byName.length === 1) return byName[0].id;
    return { problem: byName.length ? "several" : "none" };
  }

  /** Imported size only fills a company's empty fields; values typed in the app win. */
  private async fillCompanySize(companyId: string, size: ImportDraft["company"], orgId: string): Promise<void> {
    if (size.annualRevenue !== undefined) {
      await this.prisma.company.updateMany({
        where: { id: companyId, organizationId: orgId, annualRevenue: null },
        data: { annualRevenue: size.annualRevenue },
      });
    }
    if (size.employeeCount !== undefined) {
      await this.prisma.company.updateMany({
        where: { id: companyId, organizationId: orgId, employeeCount: null },
        data: { employeeCount: size.employeeCount },
      });
    }
  }

  async exportCsv(orgId: string, query: ListContactsQueryDto): Promise<string> {
    const pending = await this.pendingInviteEmails(orgId);
    const found = await this.prisma.contact.findMany({
      where: this.buildWhere(orgId, query, pending),
      orderBy: { name: "asc" },
      include: {
        company: { select: { name: true, annualRevenue: true, employeeCount: true } },
        leadSource: { select: { name: true } },
        referredBy: { select: { name: true, email: true } },
        labels: { include: { label: { select: { name: true } } } },
      },
    });
    const paid = await this.revenue.paidTotals(
      found.map((c) => c.id),
      orgId,
    );
    // Same order as the list the export was started from.
    const sort: ContactSort = query.sort ?? "name";
    const dir = query.dir ?? (sort === "paid" ? "desc" : "asc");
    const byId = new Map(found.map((c) => [c.id, c]));
    const contacts = rankRows(found.map(sortableOf), dir, (r) => contactSortValue(sort, r, paid)).flatMap(
      (id) => byId.get(id) ?? [],
    );
    const pendingSet = new Set(pending);
    const columns: CsvColumn<(typeof contacts)[number]>[] = [
      { header: "Name", value: (c) => c.name },
      { header: "First name", value: (c) => c.firstName },
      { header: "Last name", value: (c) => c.lastName },
      { header: "Email", value: (c) => c.email },
      { header: "Phone", value: (c) => c.phone },
      { header: "All phones", value: (c) => formatPhones(phonesOf(c.phones, c.phone)) },
      { header: "Company", value: (c) => c.company?.name },
      { header: "Job title", value: (c) => c.jobTitle },
      { header: "Department", value: (c) => c.department },
      { header: "Website", value: (c) => c.website },
      { header: "Address", value: (c) => c.address },
      { header: "Status", value: (c) => STATUS_LABELS[c.status as ContactStatus] ?? c.status },
      { header: "Rating", value: (c) => (c.rating ? (RATING_LABELS[c.rating as ContactRating] ?? c.rating) : null) },
      { header: "Source", value: (c) => c.leadSource?.name },
      { header: "Tags", value: (c) => c.labels.map((l) => l.label.name).join("; ") },
      { header: "Social links", value: (c) => readLinks(c.socialLinks).join(" ") },
      { header: "Next follow-up", value: (c) => c.followUpAt?.toISOString().slice(0, 10) },
      { header: "Follow-up repeats (days)", value: (c) => (c.followUpAt ? c.followUpEveryDays : null) },
      { header: "Paid all time", value: (c) => ((paid.get(c.id) ?? 0) / 100).toFixed(2) },
      { header: "About", value: (c) => c.description },
      // Email when there is one, so a re-import finds the same person.
      { header: "Referred by", value: (c) => c.referredBy?.email ?? c.referredBy?.name },
      { header: "Company annual revenue", value: (c) => c.company?.annualRevenue },
      { header: "Company employees", value: (c) => c.company?.employeeCount },
      { header: "Portal access", value: (c) => PORTAL_ACCESS_LABELS[portalAccessOf(c, pendingSet) ?? "none"] },
    ];
    return toCsv(columns, contacts);
  }

  private async attachTags(contactId: string, names: string[], orgId: string): Promise<void> {
    if (names.length === 0) return;
    const labelIds: string[] = [];
    for (const name of names) {
      const where = { organizationId: orgId, name: { equals: name, mode: "insensitive" as const } };
      let label = await this.prisma.label.findFirst({ where });
      if (!label) {
        try {
          label = await this.prisma.label.create({
            data: { organizationId: orgId, name, color: DEFAULT_LABEL_COLOR },
          });
        } catch (e) {
          if ((e as { code?: string })?.code !== "P2002") throw e;
          label = await this.prisma.label.findFirst({ where });
        }
      }
      if (label && !labelIds.includes(label.id)) labelIds.push(label.id);
    }
    await this.prisma.contactLabel.createMany({
      data: labelIds.map((labelId) => ({ contactId, labelId })),
      skipDuplicates: true,
    });
  }

  async findOne(id: string, orgId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId: orgId },
      include: {
        company: { select: { id: true, name: true } },
        leadSource: { select: { id: true, name: true } },
        referredBy: { select: { id: true, name: true } },
        labels: { include: { label: true } },
        projects: {
          include: { project: { select: { id: true, name: true, status: true } } },
        },
      },
    });
    if (!contact) throw new NotFoundException("Contact not found");

    const member = contact.userId
      ? await this.prisma.member.findFirst({
          where: { organizationId: orgId, userId: contact.userId, role: "member" },
          select: { id: true, createdAt: true, lastSeenAt: true },
        })
      : null;

    const { projects, labels, ...rest } = contact;
    return {
      ...toResponse(rest),
      hasLogin: contact.userId != null,
      portal: member ? { memberId: member.id, joinedAt: member.createdAt, lastSeenAt: member.lastSeenAt } : null,
      labels: labels.map((l) => ({
        id: l.label.id,
        name: l.label.name,
        color: l.label.color,
      })),
      projects: projects.map((p) => p.project),
      revenue: await this.revenue.forContact(id, orgId, new Date()),
    };
  }

  async create(dto: CreateContactDto, orgId: string): Promise<ContactRecord> {
    const names = createNames(dto);
    const socialLinks = dto.socialLinks === undefined ? undefined : normalizeSocialLinks(dto.socialLinks);
    const phones = resolvePhones(dto, []);
    const email = dto.email ? normalizeEmail(dto.email) : undefined;
    if (email) await this.assertEmailFree(email, orgId);
    const links = await this.resolveLinks(dto, orgId);

    let contact;
    try {
      contact = await this.prisma.contact.create({
        data: {
          organizationId: orgId,
          ...names,
          email,
          ...phones,
          socialLinks,
          jobTitle: optionalText(dto.jobTitle),
          department: optionalText(dto.department),
          rating: dto.rating,
          website: dto.website,
          address: dto.address,
          description: aboutText(dto.description),
          status: dto.status,
          ...links,
        },
      });
    } catch (e) {
      throw this.mapDuplicate(e);
    }
    await this.addEvent(contact.id, orgId, "contact_created", "Contact created");
    return toResponse(contact);
  }

  async update(id: string, dto: UpdateContactDto, orgId: string): Promise<ContactRecord> {
    const contact = await this.getOrThrow(id, orgId);
    // undefined = leave alone, null = clear.
    const email = dto.email == null ? dto.email : normalizeEmail(dto.email);
    if (contact.userId && email !== undefined && email !== contact.email) {
      throw new BadRequestException("This contact's email comes from their portal account");
    }
    if (email) await this.assertEmailFree(email, orgId, id);
    if (dto.referredById === id) {
      throw new BadRequestException("A contact cannot refer themselves");
    }
    const names = updateNames(dto, contact);
    const phones = resolvePhones(dto, phonesOf(contact.phones, contact.phone));
    const socialLinks = dto.socialLinks === undefined ? undefined : normalizeSocialLinks(dto.socialLinks);
    const links = await this.resolveLinks(dto, orgId);

    try {
      const updated = await this.prisma.contact.update({
        where: { id },
        data: {
          ...names,
          email,
          ...phones,
          socialLinks,
          jobTitle: optionalText(dto.jobTitle),
          department: optionalText(dto.department),
          rating: dto.rating,
          website: dto.website,
          address: dto.address,
          description: aboutText(dto.description),
          status: dto.status,
          ...links,
        },
      });
      return toResponse(updated);
    } catch (e) {
      throw this.mapDuplicate(e);
    }
  }

  async remove(id: string, orgId: string): Promise<void> {
    const contact = await this.getOrThrow(id, orgId);
    if (contact.userId) {
      throw new BadRequestException("Remove this client from the workspace first");
    }
    await this.prisma.contact.delete({ where: { id } });
  }

  async timeline(id: string, orgId: string, page = 1, limit = 20) {
    // Each source is fetched up to page * limit rows, so the page must stay bounded.
    if (page > TIMELINE_MAX_PAGE) {
      throw new BadRequestException(`page must not be greater than ${TIMELINE_MAX_PAGE}`);
    }
    await this.getOrThrow(id, orgId);
    const where = { contactId: id, organizationId: orgId };
    const take = page * limit;
    const [notes, events, noteCount, eventCount] = await Promise.all([
      this.prisma.contactNote.findMany({ where, orderBy: { createdAt: "desc" }, take }),
      this.prisma.contactEvent.findMany({ where, orderBy: { createdAt: "desc" }, take }),
      this.prisma.contactNote.count({ where }),
      this.prisma.contactEvent.count({ where }),
    ]);

    const authorIds = [...new Set(notes.map((n) => n.authorId))];
    const authors = authorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, name: true },
        })
      : [];
    const authorMap = new Map(authors.map((a) => [a.id, a]));

    const items: TimelineItem[] = [
      ...notes.map((n): TimelineItem => ({
        kind: "note",
        id: n.id,
        createdAt: n.createdAt,
        content: n.content,
        author: authorMap.get(n.authorId) ?? { id: n.authorId, name: "Unknown" },
      })),
      ...events.map((e): TimelineItem => ({
        kind: "event",
        id: e.id,
        createdAt: e.createdAt,
        detail: e.detail,
        type: e.type,
        refId: e.refId,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const start = (page - 1) * limit;
    return paginatedResponse(items.slice(start, start + limit), noteCount + eventCount, page, limit);
  }

  /**
   * Adds a note. "@[Name](contact:id)" mentions stay links only for contacts in this workspace
   * (others become plain "@Name"), and each mentioned contact gets a timeline entry pointing back.
   */
  async addNote(id: string, content: string, orgId: string, authorId: string) {
    const contact = await this.getOrThrow(id, orgId);
    const ids = mentionedContactIds(content);
    const known = ids.length
      ? new Set(
          (
            await this.prisma.contact.findMany({
              where: { id: { in: ids }, organizationId: orgId },
              select: { id: true },
            })
          ).map((c) => c.id),
        )
      : new Set<string>();
    const note = await this.prisma.contactNote.create({
      data: { contactId: id, organizationId: orgId, authorId, content: keepMentions(content, known) },
    });
    for (const mentionedId of ids) {
      if (mentionedId === id || !known.has(mentionedId)) continue;
      try {
        await this.addEvent(mentionedId, orgId, "mentioned", `Mentioned in a note on ${contact.name}`, id);
      } catch (e) {
        // The note is saved; a missing back-reference shouldn't fail it.
        this.logger.error(`Mention event for contact ${mentionedId} failed`, e);
      }
    }
    return note;
  }

  async removeNote(id: string, noteId: string, orgId: string): Promise<void> {
    const note = await this.prisma.contactNote.findFirst({
      where: { id: noteId, contactId: id, organizationId: orgId },
    });
    if (!note) throw new NotFoundException("Note not found");
    await this.prisma.contactNote.delete({ where: { id: noteId } });
  }

  async linkProject(id: string, projectId: string, orgId: string): Promise<void> {
    await this.getOrThrow(id, orgId);
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
    });
    if (!project) throw new NotFoundException("Project not found");

    const existing = await this.prisma.projectContact.findUnique({
      where: { projectId_contactId: { projectId, contactId: id } },
    });
    if (existing) return;

    try {
      await this.prisma.projectContact.create({ data: { projectId, contactId: id } });
    } catch (e) {
      // A concurrent request linked it first; the link exists, which is the goal.
      if ((e as { code?: string })?.code === "P2002") return;
      throw e;
    }
    await this.addEvent(
      id,
      orgId,
      "project_linked",
      `Linked to project "${project.name}"`,
      projectId,
    );
  }

  async unlinkProject(id: string, projectId: string, orgId: string): Promise<void> {
    const contact = await this.getOrThrow(id, orgId);
    // Project edits relink every client, so the link would quietly come back.
    if (contact.userId) {
      const client = await this.prisma.projectClient.findFirst({
        where: { projectId, userId: contact.userId, project: { organizationId: orgId } },
      });
      if (client) throw new BadRequestException("Remove them as a client on the project first");
    }
    await this.prisma.projectContact.deleteMany({
      where: { contactId: id, projectId, project: { organizationId: orgId } },
    });
  }

  async setFollowUp(id: string, dto: SetFollowUpDto, orgId: string, userId: string): Promise<ContactRecord> {
    await this.getOrThrow(id, orgId);
    const followUpAt = dto.followUpAt ? parseFollowUpAt(dto.followUpAt) : null;
    const updated = await this.prisma.contact.update({
      where: { id },
      data: {
        followUpAt,
        followUpEveryDays: followUpAt ? (dto.everyDays ?? null) : null,
        followUpOwnerId: followUpAt ? userId : null,
        followUpNotifiedAt: null,
      },
    });
    return toResponse(updated);
  }

  async completeFollowUp(id: string, orgId: string, now: Date = new Date()): Promise<ContactRecord> {
    const contact = await this.getOrThrow(id, orgId);
    const every = contact.followUpEveryDays;
    const updated = await this.prisma.contact.update({
      where: { id },
      data: {
        followUpAt: every ? nextRepeat(contact.followUpAt, every, now) : null,
        followUpEveryDays: every ?? null,
        followUpNotifiedAt: null,
      },
    });
    return toResponse(updated);
  }

  async snoozeFollowUp(id: string, days: number, orgId: string, now: Date = new Date()): Promise<ContactRecord> {
    await this.getOrThrow(id, orgId);
    const updated = await this.prisma.contact.update({
      where: { id },
      data: { followUpAt: noonUtcInDays(now, days), followUpNotifiedAt: null },
    });
    return toResponse(updated);
  }

  async portalProfile(id: string, orgId: string): Promise<PortalProfile> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId: orgId },
      include: { company: { select: { name: true } } },
    });
    if (!contact) throw new NotFoundException("Contact not found");
    return {
      company: contact.company?.name ?? null,
      phone: contact.phone ?? null,
      address: contact.address || null,
      website: contact.website || null,
      description: contact.description || null,
    };
  }

  /**
   * A portal client's self-service edit. Only these five fields are writable: status, notes,
   * tags, rating, follow-ups and the lead source stay the workspace's. undefined = leave alone,
   * blank = clear. Company is found or created by name; phone sets the first number.
   */
  async updatePortalProfile(id: string, dto: PortalProfileInput, orgId: string): Promise<PortalProfile> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId: orgId },
      include: { company: { select: { name: true } } },
    });
    if (!contact) throw new NotFoundException("Contact not found");
    // The form sends every field back; unchanged ones are left alone so a round trip is a no-op.
    const phone = dto.phone?.trim();
    const data: Prisma.ContactUncheckedUpdateInput =
      phone === undefined || phone === (contact.phone ?? "")
        ? {}
        : resolvePhones({ phone }, phonesOf(contact.phones, contact.phone));
    const companyName = dto.company?.trim();
    if (companyName !== undefined && companyName.toLowerCase() !== (contact.company?.name ?? "").toLowerCase()) {
      data.companyId = companyName ? (await this.findOrCreateCompany(companyName, orgId)).id : null;
    }
    if (dto.address !== undefined) data.address = dto.address.trim() || null;
    if (dto.website !== undefined) data.website = dto.website.trim() || null;
    if (dto.description !== undefined) data.description = aboutText(dto.description);
    await this.prisma.contact.update({ where: { id }, data });
    return this.portalProfile(id, orgId);
  }

  private async getOrThrow(id: string, orgId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!contact) throw new NotFoundException("Contact not found");
    return contact;
  }

  private async assertEmailFree(email: string, orgId: string, selfId?: string): Promise<void> {
    const existing = await this.prisma.contact.findFirst({
      where: { organizationId: orgId, email, ...(selfId ? { id: { not: selfId } } : {}) },
    });
    if (existing) throw new ConflictException("A contact with this email already exists");
  }

  private mapDuplicate(e: unknown): unknown {
    if ((e as { code?: string })?.code === "P2002") {
      return new ConflictException("A contact with this email already exists");
    }
    return e;
  }

  /**
   * Resolves company / lead source / referrer to ids, 404ing for anything outside the org.
   * undefined = leave alone, null = clear.
   */
  private async resolveLinks(dto: LinkFields, orgId: string): Promise<ResolvedLinks> {
    const out: ResolvedLinks = {};

    if (dto.companyId === null) {
      out.companyId = null;
    } else if (dto.companyId) {
      const company = await this.prisma.company.findFirst({
        where: { id: dto.companyId, organizationId: orgId },
      });
      if (!company) throw new NotFoundException("Company not found");
      out.companyId = company.id;
    } else if (dto.companyName != null) {
      out.companyId = (await this.findOrCreateCompany(requireName(dto.companyName), orgId)).id;
    }

    if (dto.leadSourceId === null) {
      out.leadSourceId = null;
    } else if (dto.leadSourceId) {
      const source = await this.prisma.leadSource.findFirst({
        where: { id: dto.leadSourceId, organizationId: orgId },
      });
      if (!source) throw new NotFoundException("Lead source not found");
      out.leadSourceId = source.id;
    } else if (dto.leadSourceName != null) {
      out.leadSourceId = (await this.findOrCreateLeadSource(requireName(dto.leadSourceName), orgId)).id;
    }

    if (dto.referredById === null) {
      out.referredById = null;
    } else if (dto.referredById) {
      const referrer = await this.prisma.contact.findFirst({
        where: { id: dto.referredById, organizationId: orgId },
      });
      if (!referrer) throw new NotFoundException("Referrer not found");
      out.referredById = referrer.id;
    }
    return out;
  }

  private findOrCreateCompany(name: string, orgId: string): Promise<{ id: string; name: string }> {
    const delegate = this.prisma.company;
    return this.findOrCreate(
      name,
      orgId,
      (where) => delegate.findFirst({ where }),
      (data) => delegate.create({ data }),
    );
  }

  findOrCreateLeadSource(name: string, orgId: string): Promise<{ id: string; name: string }> {
    const delegate = this.prisma.leadSource;
    return this.findOrCreate(
      name,
      orgId,
      (where) => delegate.findFirst({ where }),
      (data) => delegate.create({ data }),
    );
  }

  private async findOrCreate<T extends { id: string }>(
    name: string,
    orgId: string,
    find: (where: NameWhere) => Promise<T | null>,
    create: (data: { organizationId: string; name: string }) => Promise<T>,
  ): Promise<T> {
    const where: NameWhere = {
      organizationId: orgId,
      name: { equals: name, mode: "insensitive" },
    };
    const existing = await find(where);
    if (existing) return existing;
    try {
      return await create({ organizationId: orgId, name });
    } catch (e) {
      // Lost a race with a concurrent create of the same name.
      if ((e as { code?: string })?.code === "P2002") {
        const winner = await find(where);
        if (winner) return winner;
      }
      throw e;
    }
  }

  private async addEvent(
    contactId: string,
    organizationId: string,
    type: string,
    detail: string,
    refId?: string,
  ): Promise<void> {
    await this.prisma.contactEvent.create({
      data: { contactId, organizationId, type, detail, ...(refId ? { refId } : {}) },
    });
  }
}
