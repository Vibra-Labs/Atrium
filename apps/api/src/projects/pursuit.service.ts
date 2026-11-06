import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PROJECT_STATUSES, PURSUIT_STAGE_LABELS } from "@atrium/shared";
import type { PursuitStage } from "@atrium/shared";
import type { Prisma, ProjectPursuit } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import { ContactSyncService } from "../contact-sync/contact-sync.service";
import { ContactsService } from "../contacts/contacts.service";
import { LosePursuitDto, UpdatePursuitDto, WinPursuitDto } from "./pursuit.dto";

export interface PipelineRow {
  projectId: string;
  name: string;
  stage: string;
  valueCents: number | null;
  closeDate: Date | null;
  nextStep: string | null;
  nextStepAt: Date | null;
  isBid: boolean;
  questionsDueAt: Date | null;
}

export interface WinResult {
  projectId: string;
  /** Set when the client still needs a portal invite; the caller sends it. */
  inviteEmail: string | null;
}

/** Statuses a won project can't move to: it's becoming active work. */
const CLOSED_STATUSES: string[] = [PROJECT_STATUSES.CANCELLED, PROJECT_STATUSES.COMPLETED];

const toDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

@Injectable()
export class PursuitService {
  constructor(
    private prisma: PrismaService,
    private contactSync: ContactSyncService,
    private contacts: ContactsService,
  ) {}

  private async getOrThrow(projectId: string, orgId: string) {
    const pursuit = await this.prisma.projectPursuit.findFirst({
      where: { projectId, organizationId: orgId },
      include: { project: { select: { name: true, archivedAt: true } } },
    });
    if (!pursuit) throw new NotFoundException("Potential contract not found");
    return pursuit;
  }

  private log(tx: Prisma.TransactionClient | PrismaService, projectId: string, text: string): Promise<unknown> {
    return tx.projectPursuitEvent.create({ data: { projectId, text } });
  }

  async update(projectId: string, dto: UpdatePursuitDto, orgId: string): Promise<ProjectPursuit> {
    const pursuit = await this.getOrThrow(projectId, orgId);
    if (pursuit.outcome !== "open") throw new BadRequestException("Reopen it to make changes");
    if (dto.companyId) {
      const company = await this.prisma.company.findFirst({ where: { id: dto.companyId, organizationId: orgId } });
      if (!company) throw new BadRequestException("Company not found");
    }

    const updated: ProjectPursuit = await this.prisma.projectPursuit.update({
      where: { projectId },
      data: {
        stage: dto.stage,
        valueCents: dto.valueCents,
        closeDate: toDate(dto.closeDate),
        nextStep: dto.nextStep,
        nextStepAt: toDate(dto.nextStepAt),
        isBid: dto.isBid,
        solicitationNumber: dto.solicitationNumber,
        questionsDueAt: toDate(dto.questionsDueAt),
        sourceUrl: dto.sourceUrl === "" ? null : dto.sourceUrl,
        companyId: dto.companyId,
      },
    });
    if (dto.stage && dto.stage !== pursuit.stage) {
      await this.log(this.prisma, projectId, `Moved to ${PURSUIT_STAGE_LABELS[dto.stage as PursuitStage]}`);
    }
    return updated;
  }

  async win(projectId: string, dto: WinPursuitDto, orgId: string): Promise<WinResult> {
    const pursuit = await this.getOrThrow(projectId, orgId);
    if (pursuit.outcome !== "open") throw new BadRequestException("Only an open potential contract can be won");
    if (CLOSED_STATUSES.includes(dto.status)) {
      throw new BadRequestException("A won project needs an active status");
    }
    const status = await this.prisma.projectStatus.findFirst({ where: { slug: dto.status, organizationId: orgId } });
    if (!status) throw new BadRequestException(`Invalid status: ${dto.status}`);
    const contact = await this.prisma.contact.findFirst({ where: { id: dto.contactId, organizationId: orgId } });
    if (!contact) throw new NotFoundException("Contact not found");
    if (dto.giveAccess && !contact.userId && !contact.email) {
      throw new BadRequestException("This contact has no email");
    }
    const name: string = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

    // Idempotent, so it's safe before the transaction.
    await this.contacts.linkProject(contact.id, projectId, orgId);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.projectPursuit.updateMany({
        where: { projectId, outcome: "open" },
        data: { outcome: "won", wonAt: new Date() },
      });
      if (claimed.count === 0) throw new BadRequestException("Only an open potential contract can be won");
      await tx.project.update({ where: { id: projectId }, data: { status: dto.status } });
      // Everything made while chasing it stays internal; staff can share items later.
      const where = { projectId };
      const data = { internal: true };
      await tx.projectUpdate.updateMany({ where, data });
      await tx.file.updateMany({ where, data });
      await tx.task.updateMany({ where, data });
      await tx.document.updateMany({ where, data });
      await tx.activityLog.updateMany({ where, data });
      await tx.contact.update({ where: { id: contact.id }, data: { status: "client" } });
      await this.log(tx, projectId, `Won. ${name} is now a client`);
    });

    if (!dto.giveAccess) return { projectId, inviteEmail: null };
    if (contact.userId) {
      await this.prisma.projectClient.createMany({
        data: [{ projectId, userId: contact.userId }],
        skipDuplicates: true,
      });
      await this.contactSync.linkProjectClients(projectId, orgId, [contact.userId]);
      return { projectId, inviteEmail: null };
    }
    const email: string = contact.email!.toLowerCase();
    await this.prisma.pendingProjectAccess.upsert({
      where: { projectId_email: { projectId, email } },
      create: { organizationId: orgId, projectId, email },
      update: {},
    });
    return { projectId, inviteEmail: email };
  }

  async lose(projectId: string, dto: LosePursuitDto, orgId: string): Promise<void> {
    const pursuit = await this.getOrThrow(projectId, orgId);
    if (pursuit.outcome !== "open") throw new BadRequestException("Only an open potential contract can be lost");
    const reason: string | null = dto.reason?.trim() || null;
    // Archived, never Cancelled, so lost deals don't mix with cancelled work.
    await this.prisma.project.update({ where: { id: projectId }, data: { archivedAt: new Date() } });
    await this.prisma.projectPursuit.update({ where: { projectId }, data: { outcome: "lost", lostReason: reason } });
    await this.log(this.prisma, projectId, reason ? `Lost: ${reason}` : "Lost");
  }

  async reopen(projectId: string, orgId: string): Promise<void> {
    const pursuit = await this.getOrThrow(projectId, orgId);
    if (pursuit.outcome !== "lost") throw new BadRequestException("Only a lost potential contract can be reopened");
    await this.prisma.project.update({ where: { id: projectId }, data: { archivedAt: null } });
    await this.prisma.projectPursuit.update({
      where: { projectId },
      data: { outcome: "open", stage: "found", lostReason: null },
    });
    await this.log(this.prisma, projectId, "Reopened");
  }

  async pipeline(orgId: string): Promise<PipelineRow[]> {
    const rows = await this.prisma.projectPursuit.findMany({
      where: { organizationId: orgId, outcome: "open", project: { archivedAt: null } },
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((p) => ({
      projectId: p.projectId,
      name: p.project.name,
      stage: p.stage,
      valueCents: p.valueCents,
      closeDate: p.closeDate,
      nextStep: p.nextStep,
      nextStepAt: p.nextStepAt,
      isBid: p.isBid,
      questionsDueAt: p.questionsDueAt,
    }));
  }
}
