import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PROJECT_STATUSES } from "@atrium/shared";
import type { Prisma, ProjectPursuit, PursuitStage } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import { ContactSyncService } from "../contact-sync/contact-sync.service";
import { ContactsService } from "../contacts/contacts.service";
import { PursuitStagesService, lockStages } from "./pursuit-stages.service";
import type { PipelineWithStages } from "./pursuit-stages.service";
import { LosePursuitDto, UpdatePursuitDto, WinPursuitDto } from "./pursuit.dto";

export interface PipelineRow {
  projectId: string;
  name: string;
  pipelineId: string | null;
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
  /** The win stands, but linking the contact or giving them access failed; staff add them by hand. */
  accessFailed: boolean;
}

/** Statuses a won project can't move to: it's becoming active work. */
const CLOSED_STATUSES: string[] = [PROJECT_STATUSES.CANCELLED, PROJECT_STATUSES.COMPLETED];

const toDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

@Injectable()
export class PursuitService {
  private readonly logger: Logger = new Logger(PursuitService.name);

  constructor(
    private prisma: PrismaService,
    private contactSync: ContactSyncService,
    private contacts: ContactsService,
    private stages: PursuitStagesService,
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

  /**
   * The pipeline and stage to save. A null pipeline means the workspace's first one. Moving to
   * another pipeline keeps the stage when the target has one with the same name (ignoring case),
   * otherwise goes to its first stage.
   */
  private async resolveStage(
    pursuit: ProjectPursuit,
    dto: UpdatePursuitDto,
    orgId: string,
  ): Promise<{ targetId: string | null; pipelineId?: string; pipelineName: string | null; stage?: string; stageName: string | null }> {
    const target = await this.stages.pipelineFor(orgId, dto.pipelineId ?? pursuit.pipelineId);
    const moved: boolean = target.id !== pursuit.pipelineId;
    const pipelineId: string | undefined = moved ? target.id : undefined;
    // Only worth a history line when someone picked it, not when an unassigned contract is filed.
    const pipelineName: string | null = dto.pipelineId !== undefined && moved ? target.name : null;
    if (dto.stage !== undefined) {
      const found = target.stages.find((s) => s.slug === dto.stage);
      if (!found) throw new BadRequestException("Unknown stage");
      return { targetId: target.id, pipelineId, pipelineName, stage: found.slug, stageName: found.name };
    }
    if (!moved) return { targetId: target.id, pipelineId, pipelineName, stage: undefined, stageName: null };
    const source: PipelineWithStages = await this.stages.pipelineFor(orgId, pursuit.pipelineId);
    const currentName: string | undefined = source.stages.find((s) => s.slug === pursuit.stage)?.name.toLowerCase();
    const match: PursuitStage = target.stages.find((s) => s.name.toLowerCase() === currentName) ?? target.stages[0];
    const stage: string | undefined = match.slug === pursuit.stage ? undefined : match.slug;
    return { targetId: target.id, pipelineId, pipelineName, stage, stageName: stage ? match.name : null };
  }

  /** Under the pipeline's stage lock (so a stage delete can't slip in), confirms the stage still exists. */
  private async lockStage(tx: Prisma.TransactionClient, pipelineId: string, slug: string): Promise<void> {
    await lockStages(tx, pipelineId);
    if (!(await tx.pursuitStage.findFirst({ where: { pipelineId, slug }, select: { id: true } }))) {
      throw new BadRequestException("Unknown stage");
    }
  }

  async update(projectId: string, dto: UpdatePursuitDto, orgId: string): Promise<ProjectPursuit> {
    const pursuit = await this.getOrThrow(projectId, orgId);
    if (pursuit.outcome === "won") {
      // The price can still change after signing; the rest is history.
      if (pursuit.project.archivedAt) throw new BadRequestException("Unarchive it to make changes");
      const fields: string[] = Object.keys(dto).filter((k) => dto[k as keyof UpdatePursuitDto] !== undefined);
      if (fields.some((k) => k !== "valueCents")) {
        throw new BadRequestException("Only the value can change on a won contract");
      }
    } else if (pursuit.outcome !== "open") {
      throw new BadRequestException("Reopen it to make changes");
    }
    const { targetId, pipelineId, pipelineName, stage, stageName } =
      pursuit.outcome === "open"
        ? await this.resolveStage(pursuit, dto, orgId)
        : { targetId: null, pipelineId: undefined, pipelineName: null, stage: undefined, stageName: null };
    let companyName: string | null = null;
    if (dto.companyId) {
      const company = await this.prisma.company.findFirst({ where: { id: dto.companyId, organizationId: orgId } });
      if (!company) throw new BadRequestException("Company not found");
      companyName = company.name;
    }

    const updated: ProjectPursuit = await this.prisma.$transaction(async (tx) => {
      if (targetId && (stage !== undefined || pipelineId !== undefined)) {
        await this.lockStage(tx, targetId, stage ?? pursuit.stage);
      }
      return tx.projectPursuit.update({
        where: { projectId },
        data: {
          pipelineId,
          stage,
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
    });
    if (pipelineName) await this.log(this.prisma, projectId, `Moved to the ${pipelineName} pipeline`);
    if (stage && stage !== pursuit.stage) {
      await this.log(this.prisma, projectId, `Moved to ${stageName}`);
    }
    if (dto.companyId !== undefined && dto.companyId !== pursuit.companyId) {
      await this.log(this.prisma, projectId, companyName ? `Company set to ${companyName}` : "Company cleared");
    }
    return updated;
  }

  async win(projectId: string, dto: WinPursuitDto, orgId: string): Promise<WinResult> {
    const pursuit = await this.getOrThrow(projectId, orgId);
    if (pursuit.outcome !== "open") throw new BadRequestException("Only an open potential contract can be won");
    if (pursuit.project.archivedAt) throw new BadRequestException("Unarchive it before marking it won");
    if (CLOSED_STATUSES.includes(dto.status)) {
      throw new BadRequestException("A won project needs an active status");
    }
    const status = await this.prisma.projectStatus.findFirst({ where: { slug: dto.status, organizationId: orgId } });
    if (!status) throw new BadRequestException(`Invalid status: ${dto.status}`);
    if (dto.giveAccess && !dto.contactId) throw new BadRequestException("Pick a contact to give portal access");
    const contact = dto.contactId
      ? await this.prisma.contact.findFirst({ where: { id: dto.contactId, organizationId: orgId } })
      : null;
    if (dto.contactId && !contact) throw new NotFoundException("Contact not found");
    if (dto.giveAccess && contact && !contact.userId && !contact.email) {
      throw new BadRequestException("This contact has no email");
    }

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
      await tx.comment.updateMany({
        where: { OR: [{ update: { projectId } }, { task: { projectId } }] },
        data,
      });
      if (contact) {
        const name: string = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
        await tx.contact.update({ where: { id: contact.id }, data: { status: "client" } });
        await this.log(tx, projectId, `Won. ${name} is now a client`);
      } else {
        await this.log(tx, projectId, "Won");
      }
    });

    if (!contact) return { projectId, inviteEmail: null, accessFailed: false };
    // The win is committed. Linking and access run after it, so a failure here is reported in the
    // result rather than as an error: retrying would fail, since the contract is no longer open.
    try {
      return await this.linkWonContact(projectId, contact, dto.giveAccess === true, orgId);
    } catch (err) {
      this.logger.error(
        `Won ${projectId}, but linking contact ${contact.id} or granting access failed`,
        err instanceof Error ? err.stack : String(err),
      );
      return { projectId, inviteEmail: null, accessFailed: true };
    }
  }

  private async linkWonContact(
    projectId: string,
    contact: { id: string; userId: string | null; email: string | null },
    giveAccess: boolean,
    orgId: string,
  ): Promise<WinResult> {
    // Only once the win is ours, so a lost race doesn't leave the contact linked.
    await this.contacts.linkProject(contact.id, projectId, orgId);
    if (!giveAccess) return { projectId, inviteEmail: null, accessFailed: false };

    // Only a current portal client of this workspace gets access: the contact's own login, or one
    // with the same email that isn't linked yet. A removed user or a staff login gets an invite instead.
    const loginMatch = contact.userId
      ? [{ userId: contact.userId }]
      : [];
    const client: { userId: string } | null = await this.prisma.member.findFirst({
      where: {
        organizationId: orgId,
        role: "member",
        OR: [
          ...loginMatch,
          ...(contact.email ? [{ user: { email: { equals: contact.email, mode: "insensitive" as const } } }] : []),
        ],
      },
      select: { userId: true },
    });
    const userId: string | null = client?.userId ?? null;
    if (userId) {
      await this.prisma.projectClient.createMany({
        data: [{ projectId, userId }],
        skipDuplicates: true,
      });
      await this.contactSync.linkProjectClients(projectId, orgId, [userId]);
      return { projectId, inviteEmail: null, accessFailed: false };
    }
    if (!contact.email) return { projectId, inviteEmail: null, accessFailed: true };
    const email: string = contact.email.toLowerCase();
    await this.prisma.pendingProjectAccess.upsert({
      where: { projectId_email: { projectId, email } },
      create: { organizationId: orgId, projectId, email },
      update: {},
    });
    return { projectId, inviteEmail: email, accessFailed: false };
  }

  async lose(projectId: string, dto: LosePursuitDto, orgId: string): Promise<void> {
    const pursuit = await this.getOrThrow(projectId, orgId);
    if (pursuit.outcome !== "open") throw new BadRequestException("Only an open potential contract can be lost");
    const reason: string | null = dto.reason?.trim() || null;
    await this.prisma.$transaction(async (tx) => {
      // Claimed like win, so a concurrent win can't leave a lost project with portal clients.
      const claimed = await tx.projectPursuit.updateMany({
        where: { projectId, outcome: "open" },
        data: { outcome: "lost", lostReason: reason },
      });
      if (claimed.count === 0) throw new BadRequestException("Only an open potential contract can be lost");
      // Archived, never Cancelled, so lost deals don't mix with cancelled work.
      await tx.project.update({ where: { id: projectId }, data: { archivedAt: new Date() } });
      await this.log(tx, projectId, reason ? `Lost: ${reason}` : "Lost");
    });
  }

  async reopen(projectId: string, orgId: string): Promise<void> {
    const pursuit = await this.getOrThrow(projectId, orgId);
    if (pursuit.outcome !== "lost") throw new BadRequestException("Only a lost potential contract can be reopened");
    const pipeline: PipelineWithStages = await this.stages.pipelineFor(orgId, pursuit.pipelineId);
    const stage: string = pipeline.stages[0].slug;
    await this.prisma.$transaction(async (tx) => {
      await this.lockStage(tx, pipeline.id, stage);
      const claimed = await tx.projectPursuit.updateMany({
        where: { projectId, outcome: "lost" },
        data: { outcome: "open", stage, lostReason: null },
      });
      if (claimed.count === 0) throw new BadRequestException("Only a lost potential contract can be reopened");
      await tx.project.update({ where: { id: projectId }, data: { archivedAt: null } });
      await this.log(tx, projectId, "Reopened");
    });
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
      pipelineId: p.pipelineId,
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
