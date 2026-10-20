import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ContactsService } from "./contacts.service";
import type { LeadSourceDto } from "./contacts.dto";

function requireName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new BadRequestException("Name is required");
  return name;
}

@Injectable()
export class LeadSourcesService {
  constructor(
    private prisma: PrismaService,
    private contacts: ContactsService,
  ) {}

  findAll(orgId: string) {
    return this.prisma.leadSource.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
    });
  }

  // Case-insensitive find-or-create: returns the existing source on a match.
  async create(dto: LeadSourceDto, orgId: string) {
    return this.contacts.findOrCreateLeadSource(requireName(dto.name), orgId);
  }

  async update(id: string, dto: LeadSourceDto, orgId: string) {
    const source = await this.prisma.leadSource.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!source) throw new NotFoundException("Lead source not found");

    const name = requireName(dto.name);
    const clash = await this.prisma.leadSource.findFirst({
      where: { organizationId: orgId, name: { equals: name, mode: "insensitive" } },
    });
    if (clash && clash.id !== id) {
      throw new ConflictException("A lead source with this name already exists");
    }

    try {
      return await this.prisma.leadSource.update({ where: { id }, data: { name } });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2002") {
        throw new ConflictException("A lead source with this name already exists");
      }
      throw err;
    }
  }

  async remove(id: string, orgId: string): Promise<void> {
    const source = await this.prisma.leadSource.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!source) throw new NotFoundException("Lead source not found");
    // Contacts' leadSourceId is set to null by the schema (onDelete: SetNull).
    await this.prisma.leadSource.delete({ where: { id } });
  }
}
