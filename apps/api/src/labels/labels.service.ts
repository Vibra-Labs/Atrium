import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateLabelDto, UpdateLabelDto, AssignLabelDto } from "./labels.dto";
import { DEFAULT_LABEL_COLOR } from "@atrium/shared";
import { ContactSyncService } from "../contact-sync/contact-sync.service";

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

@Injectable()
export class LabelsService {
  constructor(
    private prisma: PrismaService,
    private contactSync: ContactSyncService,
  ) {}

  async findAll(orgId: string) {
    return this.prisma.label.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
    });
  }

  async create(dto: CreateLabelDto, orgId: string) {
    try {
      return await this.prisma.label.create({
        data: {
          name: dto.name,
          color: dto.color ?? DEFAULT_LABEL_COLOR,
          organizationId: orgId,
        },
      });
    } catch (err: unknown) {
      if (isPrismaUniqueViolation(err)) {
        throw new ConflictException("A label with this name already exists");
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateLabelDto, orgId: string) {
    const label = await this.prisma.label.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!label) throw new NotFoundException("Label not found");

    try {
      return await this.prisma.label.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
        },
      });
    } catch (err: unknown) {
      if (isPrismaUniqueViolation(err)) {
        throw new ConflictException("A label with this name already exists");
      }
      throw err;
    }
  }

  async remove(id: string, orgId: string) {
    const label = await this.prisma.label.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!label) throw new NotFoundException("Label not found");

    await this.prisma.label.delete({ where: { id } });
  }

  async assign(labelId: string, dto: AssignLabelDto, orgId: string) {
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, organizationId: orgId },
    });
    if (!label) throw new NotFoundException("Label not found");

    try {
      switch (dto.entityType) {
        case "project": {
          const project = await this.prisma.project.findFirst({
            where: { id: dto.entityId, organizationId: orgId },
          });
          if (!project) throw new BadRequestException("Project not found");
          return await this.prisma.projectLabel.create({
            data: { projectId: dto.entityId, labelId },
          });
        }
        case "task": {
          const task = await this.prisma.task.findFirst({
            where: { id: dto.entityId, organizationId: orgId },
          });
          if (!task) throw new BadRequestException("Task not found");
          return await this.prisma.taskLabel.create({
            data: { taskId: dto.entityId, labelId },
          });
        }
        case "file": {
          const file = await this.prisma.file.findFirst({
            where: { id: dto.entityId, organizationId: orgId },
          });
          if (!file) throw new BadRequestException("File not found");
          return await this.prisma.fileLabel.create({
            data: { fileId: dto.entityId, labelId },
          });
        }
        case "member": {
          const member = await this.prisma.member.findFirst({
            where: { id: dto.entityId, organizationId: orgId },
          });
          if (!member) throw new BadRequestException("Member not found");
          // Member tags live on the member's contact now.
          const contact = await this.contactSync.ensureForMember(orgId, member.userId);
          return await this.prisma.contactLabel.create({
            data: { contactId: contact.id, labelId },
          });
        }
        case "contact": {
          const contact = await this.prisma.contact.findFirst({
            where: { id: dto.entityId, organizationId: orgId },
            select: { id: true },
          });
          if (!contact) throw new BadRequestException("Contact not found");
          return await this.prisma.contactLabel.create({
            data: { contactId: dto.entityId, labelId },
          });
        }
        default:
          throw new BadRequestException("Invalid entity type");
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      if (isPrismaUniqueViolation(err)) {
        throw new ConflictException("Label is already assigned to this entity");
      }
      throw err;
    }
  }

  async unassign(labelId: string, dto: AssignLabelDto, orgId: string) {
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, organizationId: orgId },
    });
    if (!label) throw new NotFoundException("Label not found");

    switch (dto.entityType) {
      case "project": {
        const project = await this.prisma.project.findFirst({
          where: { id: dto.entityId, organizationId: orgId },
        });
        if (!project) throw new BadRequestException("Project not found");
        await this.prisma.projectLabel.deleteMany({
          where: { projectId: dto.entityId, labelId },
        });
        break;
      }
      case "task": {
        const task = await this.prisma.task.findFirst({
          where: { id: dto.entityId, organizationId: orgId },
        });
        if (!task) throw new BadRequestException("Task not found");
        await this.prisma.taskLabel.deleteMany({
          where: { taskId: dto.entityId, labelId },
        });
        break;
      }
      case "file": {
        const file = await this.prisma.file.findFirst({
          where: { id: dto.entityId, organizationId: orgId },
        });
        if (!file) throw new BadRequestException("File not found");
        await this.prisma.fileLabel.deleteMany({
          where: { fileId: dto.entityId, labelId },
        });
        break;
      }
      case "member": {
        const member = await this.prisma.member.findFirst({
          where: { id: dto.entityId, organizationId: orgId },
        });
        if (!member) throw new BadRequestException("Member not found");
        const contact = await this.prisma.contact.findFirst({
          where: { organizationId: orgId, userId: member.userId },
          select: { id: true },
        });
        if (contact) {
          await this.prisma.contactLabel.deleteMany({
            where: { contactId: contact.id, labelId },
          });
        }
        break;
      }
      case "contact": {
        const contact = await this.prisma.contact.findFirst({
          where: { id: dto.entityId, organizationId: orgId },
          select: { id: true },
        });
        if (!contact) throw new BadRequestException("Contact not found");
        await this.prisma.contactLabel.deleteMany({
          where: { contactId: dto.entityId, labelId },
        });
        break;
      }
      default:
        throw new BadRequestException("Invalid entity type");
    }
  }
}
