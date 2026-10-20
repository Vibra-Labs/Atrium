import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { isEmail } from "class-validator";
import { Prisma } from "@atrium/database";
import { DEFAULT_LABEL_COLOR } from "@atrium/shared";
import type { ContactStatus } from "@atrium/shared";
import { PrismaService } from "../prisma/prisma.service";
import { paginationArgs, paginatedResponse, toCsv } from "../common";
import type { CsvColumn } from "../common";
import { normalizeEmail } from "../contact-sync/contact-sync.service";
import { ContactRevenueService } from "./contact-revenue.service";
import { MAX_IMPORT_ROWS, parseCsv } from "./contacts-csv";
import type { ImportField, ImportMapping } from "./contacts-csv";
import type {
  CreateContactDto,
  ListContactsQueryDto,
  SetFollowUpDto,
  UpdateContactDto,
} from "./contacts.dto";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOO_MANY_ROWS = "CSV has more than 5,000 rows";

const STATUS_LABELS: Record<ContactStatus, string> = {
  lead: "Lead",
  client: "Client",
  past_client: "Past client",
};

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

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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

function omitImportMarker<T extends { profileImportedAt?: Date | null }>(
  contact: T,
): Omit<T, "profileImportedAt"> {
  const { profileImportedAt: _imported, ...rest } = contact;
  return rest;
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
    const where = this.buildWhere(orgId, query);

    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: { name: "asc" },
        include: {
          company: { select: { id: true, name: true } },
          labels: { include: { label: true } },
        },
        ...paginationArgs(page, limit),
      }),
      this.prisma.contact.count({ where }),
    ]);

    const paid = await this.revenue.paidTotals(
      contacts.map((c) => c.id),
      orgId,
    );
    const data = contacts.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
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
    }));
    return paginatedResponse(data, total, page, limit);
  }

  private buildWhere(orgId: string, query: ListContactsQueryDto): Prisma.ContactWhereInput {
    const where: Prisma.ContactWhereInput = { organizationId: orgId };
    if (query.status) where.status = query.status;
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
  ): Promise<{ created: number; skipped: { row: number; reason: string }[] }> {
    const [headers = [], ...data] = parseCsv(dto.csv);
    if (data.length > MAX_IMPORT_ROWS) throw new BadRequestException(TOO_MANY_ROWS);

    const columns = new Map<ImportField, number>();
    headers.forEach((h, i) => {
      if (!Object.hasOwn(dto.mapping, h)) return;
      const field = dto.mapping[h];
      if (field !== "skip" && !columns.has(field)) columns.set(field, i);
    });
    const cell = (row: string[], field: ImportField): string => {
      const i = columns.get(field);
      return i === undefined ? "" : (row[i] ?? "").trim();
    };

    const skipped: { row: number; reason: string }[] = [];
    const seen = new Set<string>();
    let created = 0;

    for (const [i, row] of data.entries()) {
      const rowNumber = i + 2; // 1-based, header is row 1
      const name = cell(row, "name");
      if (!name) {
        skipped.push({ row: rowNumber, reason: "Missing name" });
        continue;
      }
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
            name: name.slice(0, 200),
            email,
            phone: cell(row, "phone").slice(0, 50) || undefined,
            website: cell(row, "website").slice(0, 500) || undefined,
            address: cell(row, "address").slice(0, 500) || undefined,
            status: parseStatus(cell(row, "status")),
            companyName: cell(row, "company").slice(0, 200) || undefined,
            leadSourceName: cell(row, "source").slice(0, 200) || undefined,
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
    return { created, skipped };
  }

  async exportCsv(orgId: string, query: ListContactsQueryDto): Promise<string> {
    const contacts = await this.prisma.contact.findMany({
      where: this.buildWhere(orgId, query),
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
    const columns: CsvColumn<(typeof contacts)[number]>[] = [
      { header: "Name", value: (c) => c.name },
      { header: "Email", value: (c) => c.email },
      { header: "Phone", value: (c) => c.phone },
      { header: "Company", value: (c) => c.company?.name },
      { header: "Website", value: (c) => c.website },
      { header: "Address", value: (c) => c.address },
      { header: "Status", value: (c) => STATUS_LABELS[c.status as ContactStatus] ?? c.status },
      { header: "Source", value: (c) => c.leadSource?.name },
      { header: "Tags", value: (c) => c.labels.map((l) => l.label.name).join("; ") },
      { header: "Next follow-up", value: (c) => c.followUpAt?.toISOString().slice(0, 10) },
      { header: "Paid all time", value: (c) => ((paid.get(c.id) ?? 0) / 100).toFixed(2) },
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

    const { projects, labels, profileImportedAt: _imported, ...rest } = contact;
    return {
      ...rest,
      hasLogin: contact.userId != null,
      labels: labels.map((l) => ({
        id: l.label.id,
        name: l.label.name,
        color: l.label.color,
      })),
      projects: projects.map((p) => p.project),
      revenue: await this.revenue.forContact(id, orgId, new Date()),
    };
  }

  async create(dto: CreateContactDto, orgId: string) {
    const email = dto.email ? normalizeEmail(dto.email) : undefined;
    if (email) await this.assertEmailFree(email, orgId);
    const links = await this.resolveLinks(dto, orgId);

    let contact;
    try {
      contact = await this.prisma.contact.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          email,
          phone: dto.phone,
          website: dto.website,
          address: dto.address,
          status: dto.status,
          ...links,
        },
      });
    } catch (e) {
      throw this.mapDuplicate(e);
    }
    await this.addEvent(contact.id, orgId, "contact_created", "Contact created");
    return omitImportMarker(contact);
  }

  async update(id: string, dto: UpdateContactDto, orgId: string) {
    await this.getOrThrow(id, orgId);
    // undefined = leave alone, null = clear.
    const email = dto.email == null ? dto.email : normalizeEmail(dto.email);
    if (email) await this.assertEmailFree(email, orgId, id);
    if (dto.referredById === id) {
      throw new BadRequestException("A contact cannot refer themselves");
    }
    const links = await this.resolveLinks(dto, orgId);

    try {
      const updated = await this.prisma.contact.update({
        where: { id },
        data: {
          name: dto.name,
          email,
          phone: dto.phone,
          website: dto.website,
          address: dto.address,
          status: dto.status,
          ...links,
        },
      });
      return omitImportMarker(updated);
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

  async setFollowUp(id: string, dto: SetFollowUpDto, orgId: string, userId: string) {
    await this.getOrThrow(id, orgId);
    const followUpAt = dto.followUpAt ? new Date(dto.followUpAt) : null;
    return this.prisma.contact.update({
      where: { id },
      data: {
        followUpAt,
        followUpEveryDays: followUpAt ? (dto.everyDays ?? null) : null,
        followUpOwnerId: followUpAt ? userId : null,
        followUpNotifiedAt: null,
      },
    });
  }

  async completeFollowUp(id: string, orgId: string, now: Date = new Date()) {
    const contact = await this.getOrThrow(id, orgId);
    const every = contact.followUpEveryDays;
    return this.prisma.contact.update({
      where: { id },
      data: {
        followUpAt: every ? new Date(startOfUtcDay(now).getTime() + every * DAY_MS) : null,
        followUpEveryDays: every ?? null,
        followUpNotifiedAt: null,
      },
    });
  }

  async snoozeFollowUp(id: string, days: number, orgId: string, now: Date = new Date()) {
    await this.getOrThrow(id, orgId);
    return this.prisma.contact.update({
      where: { id },
      data: { followUpAt: new Date(now.getTime() + days * DAY_MS), followUpNotifiedAt: null },
    });
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
    } else if (dto.companyName) {
      out.companyId = (await this.findOrCreateCompany(dto.companyName.trim(), orgId)).id;
    }

    if (dto.leadSourceId === null) {
      out.leadSourceId = null;
    } else if (dto.leadSourceId) {
      const source = await this.prisma.leadSource.findFirst({
        where: { id: dto.leadSourceId, organizationId: orgId },
      });
      if (!source) throw new NotFoundException("Lead source not found");
      out.leadSourceId = source.id;
    } else if (dto.leadSourceName) {
      out.leadSourceId = (await this.findOrCreateLeadSource(dto.leadSourceName.trim(), orgId)).id;
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
