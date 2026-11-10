import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { OnApplicationBootstrap } from "@nestjs/common";
import { DEFAULT_PURSUIT_STAGES, MAX_PURSUIT_STAGES, PURSUIT_PIPELINES } from "@atrium/shared";
import type { PursuitPipeline } from "@atrium/shared";
import type { PursuitStage } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import { requireName } from "../contacts/require-name";
import { isPrismaUniqueViolation } from "../common/helpers/prisma-errors";
import type { CreatePursuitStageDto, RenamePursuitStageDto, ReorderPursuitStagesDto } from "./pursuit-stages.dto";

const DUPLICATE = "A stage with this name already exists";

/** "Verbal yes!" → "verbal_yes"; adds _2, _3… when taken. */
function uniqueSlug(name: string, taken: string[]): string {
  const base: string = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "stage";
  let slug: string = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}_${n}`;
  return slug;
}

/** The stages of a workspace's two pipelines, Bids and Commercial. */
@Injectable()
export class PursuitStagesService implements OnApplicationBootstrap {
  private readonly logger: Logger = new Logger(PursuitStagesService.name);

  constructor(private prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    // Don't hold up boot; new workspaces get their stages when they're created.
    void this.seedMissing().catch((err: unknown) => {
      this.logger.error("Failed to seed pipeline stages", err);
    });
  }

  /**
   * Gives every pipeline with no stages the defaults: workspaces made before stages existed.
   * A pipeline can't be emptied by hand, so an edited one is never re-seeded. Safe to run on every boot.
   */
  async seedMissing(): Promise<void> {
    const orgs: { id: string }[] = await this.prisma.organization.findMany({
      where: { OR: PURSUIT_PIPELINES.map((pipeline) => ({ pursuitStages: { none: { pipeline } } })) },
      select: { id: true },
    });
    for (const { id } of orgs) {
      for (const pipeline of PURSUIT_PIPELINES) {
        if ((await this.prisma.pursuitStage.count({ where: { organizationId: id, pipeline } })) > 0) continue;
        await this.prisma.pursuitStage.createMany({
          data: DEFAULT_PURSUIT_STAGES.map((s, order) => ({ organizationId: id, pipeline, slug: s.slug, name: s.name, order })),
          skipDuplicates: true,
        });
      }
    }
  }

  findAll(orgId: string): Promise<PursuitStage[]> {
    return this.prisma.pursuitStage.findMany({
      where: { organizationId: orgId },
      orderBy: [{ pipeline: "asc" }, { order: "asc" }],
    });
  }

  private list(orgId: string, pipeline: string): Promise<PursuitStage[]> {
    return this.prisma.pursuitStage.findMany({
      where: { organizationId: orgId, pipeline },
      orderBy: [{ pipeline: "asc" }, { order: "asc" }],
    });
  }

  private async getOrThrow(id: string, orgId: string): Promise<PursuitStage> {
    const stage: PursuitStage | null = await this.prisma.pursuitStage.findFirst({ where: { id, organizationId: orgId } });
    if (!stage) throw new NotFoundException("Stage not found");
    return stage;
  }

  private static assertFreeName(stages: PursuitStage[], name: string, exceptId?: string): void {
    const lower: string = name.toLowerCase();
    if (stages.some((s) => s.id !== exceptId && s.name.toLowerCase() === lower)) throw new ConflictException(DUPLICATE);
  }

  async create(dto: CreatePursuitStageDto, orgId: string): Promise<PursuitStage> {
    const name: string = requireName(dto.name);
    const stages: PursuitStage[] = await this.list(orgId, dto.pipeline);
    if (stages.length >= MAX_PURSUIT_STAGES) {
      throw new BadRequestException(`A pipeline can have at most ${MAX_PURSUIT_STAGES} stages`);
    }
    PursuitStagesService.assertFreeName(stages, name);
    try {
      return await this.prisma.pursuitStage.create({
        data: {
          organizationId: orgId,
          pipeline: dto.pipeline,
          name,
          slug: uniqueSlug(name, stages.map((s) => s.slug)),
          order: stages.length ? Math.max(...stages.map((s) => s.order)) + 1 : 0,
        },
      });
    } catch (err: unknown) {
      if (isPrismaUniqueViolation(err)) throw new ConflictException(DUPLICATE);
      throw err;
    }
  }

  async rename(id: string, dto: RenamePursuitStageDto, orgId: string): Promise<PursuitStage> {
    const stage: PursuitStage = await this.getOrThrow(id, orgId);
    const name: string = requireName(dto.name);
    PursuitStagesService.assertFreeName(await this.list(orgId, stage.pipeline), name, id);
    try {
      return await this.prisma.pursuitStage.update({ where: { id }, data: { name } });
    } catch (err: unknown) {
      if (isPrismaUniqueViolation(err)) throw new ConflictException(DUPLICATE);
      throw err;
    }
  }

  async reorder(dto: ReorderPursuitStagesDto, orgId: string): Promise<PursuitStage[]> {
    const stages: PursuitStage[] = await this.list(orgId, dto.pipeline);
    const ids: Set<string> = new Set(dto.ids);
    if (dto.ids.length !== stages.length || ids.size !== stages.length || stages.some((s) => !ids.has(s.id))) {
      throw new BadRequestException("Send every stage once");
    }
    await this.prisma.$transaction(
      dto.ids.map((id, order) => this.prisma.pursuitStage.update({ where: { id }, data: { order } })),
    );
    return this.list(orgId, dto.pipeline);
  }

  /** Deletes a stage after moving every contract in it (any outcome) to `moveTo`. */
  async remove(id: string, moveTo: string, orgId: string): Promise<void> {
    const stage: PursuitStage = await this.getOrThrow(id, orgId);
    await this.prisma.$transaction(async (tx) => {
      // One remove per pipeline at a time, so two admins can't each delete the other's target
      // or empty the pipeline between them. Checks below read the state after the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pursuit-stages:${orgId}:${stage.pipeline}`}))`;
      const stages: PursuitStage[] = await tx.pursuitStage.findMany({
        where: { organizationId: orgId, pipeline: stage.pipeline },
      });
      if (!stages.some((s) => s.id === id)) throw new NotFoundException("Stage not found");
      if (stages.length <= 1) throw new BadRequestException("A pipeline needs at least one stage");
      const target: PursuitStage | undefined = stages.find((s) => s.id === moveTo && s.id !== id);
      if (!target) throw new BadRequestException("Pick another stage in this pipeline to move its contracts to");

      await tx.projectPursuit.updateMany({
        where: { organizationId: orgId, isBid: stage.pipeline === "bid", stage: stage.slug },
        data: { stage: target.slug },
      });
      await tx.pursuitStage.delete({ where: { id } });
    });
  }

  async firstSlug(orgId: string, pipeline: PursuitPipeline): Promise<string> {
    const first: PursuitStage | null = await this.prisma.pursuitStage.findFirst({
      where: { organizationId: orgId, pipeline },
      orderBy: [{ pipeline: "asc" }, { order: "asc" }],
    });
    // A pipeline always has a stage once seeded; the default covers a workspace not yet backfilled.
    return first?.slug ?? DEFAULT_PURSUIT_STAGES[0].slug;
  }

  find(orgId: string, pipeline: PursuitPipeline, slug: string): Promise<PursuitStage | null> {
    return this.prisma.pursuitStage.findFirst({ where: { organizationId: orgId, pipeline, slug } });
  }
}
