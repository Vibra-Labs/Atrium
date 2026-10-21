import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { isEmail } from "class-validator";
import { Prisma } from "@atrium/database";
import type { Contact } from "@atrium/database";
import { DEFAULT_LABEL_COLOR } from "@atrium/shared";
import type { ContactPhone, ContactRating, ContactStatus } from "@atrium/shared";
import { PrismaService } from "../prisma/prisma.service";
import { paginationArgs, paginatedResponse, toCsv } from "../common";
import type { CsvColumn } from "../common";
import { normalizeEmail } from "../contact-sync/contact-sync.service";
import { ContactRevenueService, rankByPaid } from "./contact-revenue.service";
import { MAX_IMPORT_ROWS, parseCsv } from "./contacts-csv";
import type { ImportField, ImportMapping } from "./contacts-csv";
import { LEAD_SOURCE_NAME_MAX, TIMELINE_MAX_PAGE } from "./contacts.dto";
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
  NAME_PART_MAX,
  createNames,
  importSocialLinks,
  normalizeSocialLinks,
  optionalText,
  parseRating,
  phonesOf,
  resolvePhones,
  updateNames,
} from "./contact-fields";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOO_MANY_ROWS = "CSV has more than 5,000 rows";

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

function parseStatus(value: string): ContactStatus {
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return v === "client" || v === "past_client" ? v : "lead";
}

function splitTags(value: string): string[] {
  const names = value
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return names.filter((n, i) => names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);
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
function contactOrderBy(sort: Exclude<ContactSort, "paid">, dir: SortDirection): Prisma.ContactOrderByWithRelationInput[] {
  const tiebreak: Prisma.ContactOrderByWithRelationInput[] = [{ name: "asc" }, { id: "asc" }];
  switch (sort) {
    case "name":
      return [{ name: dir }, { id: "asc" }];
    case "company":
      return [{ company: { name: dir } }, ...tiebreak];
    case "status":
      return [{ status: dir }, ...tiebreak];
    case "followUp":
      return [{ followUpAt: { sort: dir, nulls: "last" } }, ...tiebreak];
  }
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

    let contacts;
    let total: number;
    let paid: Map<string, number>;
    if (query.sort === "paid") {
      // Paid totals come from invoices, so rank every match here and fetch only this page.
      const [matches, allPaid] = await Promise.all([
        this.prisma.contact.findMany({ where, select: { id: true, name: true } }),
        this.revenue.paidTotals(null, orgId),
      ]);
      const pageIds = rankByPaid(matches, allPaid, query.dir ?? "desc").slice((page - 1) * limit, page * limit);
      const rows = await this.prisma.contact.findMany({ where: { id: { in: pageIds } }, include });
      const byId = new Map(rows.map((r) => [r.id, r]));
      contacts = pageIds.flatMap((id) => byId.get(id) ?? []);
      total = matches.length;
      paid = allPaid;
    } else {
      [contacts, total] = await Promise.all([
        this.prisma.contact.findMany({
          where,
          orderBy: contactOrderBy(query.sort ?? "name", query.dir ?? "asc"),
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
  ): Promise<{
    created: number;
    skipped: { row: number; reason: string }[];
    warnings: { row: number; reason: string }[];
  }> {
    const [headers = [], ...data] = parseCsv(dto.csv);
    if (data.length > MAX_IMPORT_ROWS) throw new BadRequestException(TOO_MANY_ROWS);

    const columns = new Map<ImportField, number>();
    // Exports often split links over several columns (LinkedIn, Twitter...), so all are read.
    const linkColumns: { header: string; index: number }[] = [];
    headers.forEach((h, i) => {
      if (!Object.hasOwn(dto.mapping, h)) return;
      const field = dto.mapping[h];
      if (field === "socialLinks") linkColumns.push({ header: h, index: i });
      else if (field !== "skip" && !columns.has(field)) columns.set(field, i);
    });
    const cell = (row: string[], field: ImportField): string => {
      const i = columns.get(field);
      return i === undefined ? "" : (row[i] ?? "").trim();
    };

    const skipped: { row: number; reason: string }[] = [];
    // Non-fatal: the contact was imported, but something in the row was left out.
    const warnings: { row: number; reason: string }[] = [];
    const seen = new Set<string>();
    let created = 0;

    for (const [i, row] of data.entries()) {
      const rowNumber = i + 2; // 1-based, header is row 1
      const name = cell(row, "name");
      const firstName = cell(row, "firstName");
      if (!name && !firstName) {
        skipped.push({ row: rowNumber, reason: "Missing name" });
        continue;
      }
      const rating = parseRating(cell(row, "rating"));
      if (rating === null) {
        skipped.push({ row: rowNumber, reason: "Invalid rating" });
        continue;
      }
      // A link never costs the row: unusable ones are dropped with a warning.
      const { links: socialLinks, dropped } = importSocialLinks(
        linkColumns.map((c) => ({ header: c.header, value: row[c.index] ?? "" })),
      );
      const rawEmail = cell(row, "email");
      if (rawEmail && !isEmail(rawEmail)) {
        skipped.push({ row: rowNumber, reason: "Invalid email" });
        continue;
      }
      const email = rawEmail ? normalizeEmail(rawEmail) : undefined;
      if (email && seen.has(email)) {
        skipped.push({ row: rowNumber, reason: "Email already exists" });
        continue;
      }
      let contact: { id: string };
      try {
        contact = await this.create(
          {
            name: name.slice(0, 200) || undefined,
            firstName: firstName.slice(0, NAME_PART_MAX) || undefined,
            lastName: cell(row, "lastName").slice(0, NAME_PART_MAX) || undefined,
            jobTitle: cell(row, "jobTitle").slice(0, 200) || undefined,
            department: cell(row, "department").slice(0, 100) || undefined,
            socialLinks,
            rating,
            email,
            phone: cell(row, "phone").slice(0, 50) || undefined,
            website: cell(row, "website").slice(0, 500) || undefined,
            address: cell(row, "address").slice(0, 500) || undefined,
            status: parseStatus(cell(row, "status")),
            companyName: cell(row, "company").slice(0, 200) || undefined,
            leadSourceName: cell(row, "source").slice(0, LEAD_SOURCE_NAME_MAX) || undefined,
          },
          orgId,
        );
      } catch (e) {
        if (e instanceof ConflictException) {
          skipped.push({ row: rowNumber, reason: "Email already exists" });
        } else {
          this.logger.error(`Contact import row ${rowNumber} failed`, e);
          skipped.push({ row: rowNumber, reason: "Invalid row" });
        }
        continue;
      }
      if (email) seen.add(email);
      created++;
      for (const link of dropped) {
        warnings.push({ row: rowNumber, reason: `Social link "${link.slice(0, 100)}" isn't a web address; left out` });
      }
      try {
        await this.attachTags(contact.id, splitTags(cell(row, "tags")), orgId);
        const notes = cell(row, "notes");
        if (notes) {
          await this.prisma.contactNote.create({
            data: { contactId: contact.id, organizationId: orgId, authorId: userId, content: notes },
          });
        }
      } catch (e) {
        // The contact exists; losing its tags or note shouldn't discard it.
        this.logger.error(`Contact import row ${rowNumber}: tags/notes failed`, e);
      }
    }
    return { created, skipped, warnings };
  }

  async exportCsv(orgId: string, query: ListContactsQueryDto): Promise<string> {
    const pending = await this.pendingInviteEmails(orgId);
    const contacts = await this.prisma.contact.findMany({
      where: this.buildWhere(orgId, query, pending),
      orderBy: { name: "asc" },
      include: {
        company: { select: { name: true } },
        leadSource: { select: { name: true } },
        labels: { include: { label: { select: { name: true } } } },
      },
    });
    const paid = await this.revenue.paidTotals(
      contacts.map((c) => c.id),
      orgId,
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
      { header: "Paid all time", value: (c) => ((paid.get(c.id) ?? 0) / 100).toFixed(2) },
      { header: "About", value: (c) => c.description },
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
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const start = (page - 1) * limit;
    return paginatedResponse(items.slice(start, start + limit), noteCount + eventCount, page, limit);
  }

  async addNote(id: string, content: string, orgId: string, authorId: string) {
    await this.getOrThrow(id, orgId);
    return this.prisma.contactNote.create({
      data: { contactId: id, organizationId: orgId, authorId, content },
    });
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
