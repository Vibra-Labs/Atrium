import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import { paginationArgs, paginatedResponse } from "../common";
import { normalizeEmail } from "../contact-sync/contact-sync.service";
import { ContactRevenueService } from "./contact-revenue.service";
import type {
  CreateContactDto,
  ListContactsQueryDto,
  UpdateContactDto,
} from "./contacts.dto";

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

type LinkFields = Pick<
  UpdateContactDto,
  "companyId" | "companyName" | "leadSourceId" | "leadSourceName" | "referredById"
>;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: ContactRevenueService,
  ) {}

  async findAll(orgId: string, query: ListContactsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
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
    return contact;
  }

  async update(id: string, dto: UpdateContactDto, orgId: string) {
    await this.getOrThrow(id, orgId);
    const email = dto.email ? normalizeEmail(dto.email) : undefined;
    if (email) await this.assertEmailFree(email, orgId, id);
    if (dto.referredById === id) {
      throw new BadRequestException("A contact cannot refer themselves");
    }
    const links = await this.resolveLinks(dto, orgId);

    try {
      return await this.prisma.contact.update({
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

    await this.prisma.projectContact.create({ data: { projectId, contactId: id } });
    await this.addEvent(
      id,
      orgId,
      "project_linked",
      `Linked to project "${project.name}"`,
      projectId,
    );
  }

  async unlinkProject(id: string, projectId: string, orgId: string): Promise<void> {
    await this.getOrThrow(id, orgId);
    await this.prisma.projectContact.deleteMany({
      where: { contactId: id, projectId, project: { organizationId: orgId } },
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

  /** Resolves company / lead source / referrer to ids, 404ing for anything outside the org. */
  private async resolveLinks(
    dto: LinkFields,
    orgId: string,
  ): Promise<{ companyId?: string; leadSourceId?: string; referredById?: string }> {
    const out: { companyId?: string; leadSourceId?: string; referredById?: string } = {};

    if (dto.companyId) {
      const company = await this.prisma.company.findFirst({
        where: { id: dto.companyId, organizationId: orgId },
      });
      if (!company) throw new NotFoundException("Company not found");
      out.companyId = company.id;
    } else if (dto.companyName) {
      out.companyId = await this.findOrCreateCompany(dto.companyName.trim(), orgId);
    }

    if (dto.leadSourceId) {
      const source = await this.prisma.leadSource.findFirst({
        where: { id: dto.leadSourceId, organizationId: orgId },
      });
      if (!source) throw new NotFoundException("Lead source not found");
      out.leadSourceId = source.id;
    } else if (dto.leadSourceName) {
      out.leadSourceId = await this.findOrCreateLeadSource(dto.leadSourceName.trim(), orgId);
    }

    if (dto.referredById) {
      const referrer = await this.prisma.contact.findFirst({
        where: { id: dto.referredById, organizationId: orgId },
      });
      if (!referrer) throw new NotFoundException("Referrer not found");
      out.referredById = referrer.id;
    }
    return out;
  }

  private findOrCreateCompany(name: string, orgId: string): Promise<string> {
    const delegate = this.prisma.company;
    return this.findOrCreate(
      name,
      orgId,
      (where) => delegate.findFirst({ where }),
      (data) => delegate.create({ data }),
    );
  }

  private findOrCreateLeadSource(name: string, orgId: string): Promise<string> {
    const delegate = this.prisma.leadSource;
    return this.findOrCreate(
      name,
      orgId,
      (where) => delegate.findFirst({ where }),
      (data) => delegate.create({ data }),
    );
  }

  private async findOrCreate(
    name: string,
    orgId: string,
    find: (where: NameWhere) => Promise<{ id: string } | null>,
    create: (data: { organizationId: string; name: string }) => Promise<{ id: string }>,
  ): Promise<string> {
    const where: NameWhere = {
      organizationId: orgId,
      name: { equals: name, mode: "insensitive" },
    };
    const existing = await find(where);
    if (existing) return existing.id;
    try {
      return (await create({ organizationId: orgId, name })).id;
    } catch (e) {
      // Lost a race with a concurrent create of the same name.
      if ((e as { code?: string })?.code === "P2002") {
        const winner = await find(where);
        if (winner) return winner.id;
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
