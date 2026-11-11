import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { OnApplicationBootstrap } from "@nestjs/common";
import {
  DEFAULT_PURSUIT_PIPELINES,
  DEFAULT_PURSUIT_STAGES,
  MAX_PURSUIT_PIPELINES,
  MAX_PURSUIT_STAGES,
} from "@atrium/shared";
import type { Prisma, PursuitPipeline, PursuitStage } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import { requireName } from "../contacts/require-name";
import { assertFreeName, assertSameSet, unique, uniqueSlug } from "./ordered-names";
import type {
  CreatePursuitStageDto,
  PursuitNameDto,
  ReorderPursuitPipelinesDto,
  ReorderPursuitStagesDto,
} from "./pursuit-stages.dto";

export type PipelineWithStages = PursuitPipeline & { stages: PursuitStage[] };

type Db = PrismaService | Prisma.TransactionClient;

const STAGE_TAKEN = "A stage with this name already exists";
const PIPELINE_TAKEN = "A pipeline with this name already exists";
const BY_ORDER = { order: "asc" } as const;
const WITH_STAGES = { stages: { orderBy: BY_ORDER } } as const;

function createWithDefaultStages(db: Db, orgId: string, name: string, order: number): Promise<PipelineWithStages> {
  return db.pursuitPipeline.create({
    data: {
      organizationId: orgId,
      name,
      order,
      stages: {
        create: DEFAULT_PURSUIT_STAGES.map((s, i) => ({ organizationId: orgId, name: s.name, slug: s.slug, order: i })),
      },
    },
    include: WITH_STAGES,
  });
}

const lockPipelines = (db: Db, orgId: string): Promise<unknown> =>
  db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pursuit-pipelines:${orgId}`}))`;
export const lockStages = (db: Db, pipelineId: string): Promise<unknown> =>
  db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pursuit-stages:${pipelineId}`}))`;

/** A deleted row in a write: Prisma's P2025. */
const isNotFound = (err: unknown): boolean => typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2025";

/**
 * Gives a workspace with no pipelines the default ones, each with the default stages. Call it in a
 * transaction: it takes the workspace's pipeline lock, so a signup and a boot seed can't both create them.
 */
export async function seedDefaultPipelines(db: Prisma.TransactionClient, orgId: string): Promise<void> {
  await lockPipelines(db, orgId);
  if (await db.pursuitPipeline.findFirst({ where: { organizationId: orgId }, select: { id: true } })) return;
  for (const [order, name] of DEFAULT_PURSUIT_PIPELINES.entries()) {
    await createWithDefaultStages(db, orgId, name, order);
  }
}

/** A workspace's pipelines for potential contracts, and each pipeline's stages. */
@Injectable()
export class PursuitStagesService implements OnApplicationBootstrap {
  private readonly logger: Logger = new Logger(PursuitStagesService.name);

  constructor(private prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    // Don't hold up boot; new workspaces get their pipelines when they're created.
    void this.seedMissing().catch((err: unknown) => {
      this.logger.error("Failed to seed pipelines", err);
    });
  }

  /**
   * Workspaces made before pipelines existed: gives them the stock pipeline, then files their
   * contracts in the first pipeline. Safe to run on every boot.
   */
  async seedMissing(): Promise<void> {
    const orgs: { id: string }[] = await this.prisma.organization.findMany({
      where: { pursuitPipelines: { none: {} } },
      select: { id: true },
    });
    for (const { id } of orgs) {
      await this.prisma.$transaction((tx) => seedDefaultPipelines(tx, id));
    }

    const unfiled: { organizationId: string }[] = await this.prisma.projectPursuit.findMany({
      where: { pipelineId: null },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });
    for (const orgId of new Set(unfiled.map((p) => p.organizationId))) {
      const first: PursuitPipeline | null = await this.prisma.pursuitPipeline.findFirst({
        where: { organizationId: orgId },
        orderBy: BY_ORDER,
      });
      if (!first) continue;
      await this.prisma.projectPursuit.updateMany({
        where: { organizationId: orgId, pipelineId: null },
        data: { pipelineId: first.id },
      });
    }
  }

  /* ------------------------------ Pipelines ------------------------------ */

  findAll(orgId: string): Promise<PipelineWithStages[]> {
    return this.prisma.pursuitPipeline.findMany({ where: { organizationId: orgId }, orderBy: BY_ORDER, include: WITH_STAGES });
  }

  /**
   * A contract's pipeline: the given one, or the first when null. 400 when the id isn't this
   * workspace's. A workspace the boot job hasn't reached yet gets its default pipelines here.
   */
  async pipelineFor(orgId: string, pipelineId: string | null): Promise<PipelineWithStages> {
    const find = (): Promise<PipelineWithStages | null> =>
      this.prisma.pursuitPipeline.findFirst({
        where: pipelineId === null ? { organizationId: orgId } : { id: pipelineId, organizationId: orgId },
        orderBy: BY_ORDER,
        include: WITH_STAGES,
      });
    let found: PipelineWithStages | null = await find();
    if (!found) {
      await this.prisma.$transaction((tx) => seedDefaultPipelines(tx, orgId));
      found = await find();
    }
    if (!found) throw new BadRequestException("Unknown pipeline");
    return found;
  }

  private async pipelineOrThrow(id: string, orgId: string): Promise<PursuitPipeline> {
    const found: PursuitPipeline | null = await this.prisma.pursuitPipeline.findFirst({ where: { id, organizationId: orgId } });
    if (!found) throw new NotFoundException("Pipeline not found");
    return found;
  }

  async createPipeline(dto: PursuitNameDto, orgId: string): Promise<PipelineWithStages> {
    const name: string = requireName(dto.name);
    return this.prisma.$transaction(async (tx) => {
      await lockPipelines(tx, orgId);
      const pipelines: PursuitPipeline[] = await tx.pursuitPipeline.findMany({ where: { organizationId: orgId } });
      if (pipelines.length >= MAX_PURSUIT_PIPELINES) {
        throw new BadRequestException(`A workspace can have at most ${MAX_PURSUIT_PIPELINES} pipelines`);
      }
      assertFreeName(pipelines, name, PIPELINE_TAKEN);
      const order: number = pipelines.length ? Math.max(...pipelines.map((p) => p.order)) + 1 : 0;
      return unique(() => createWithDefaultStages(tx, orgId, name, order), PIPELINE_TAKEN);
    });
  }

  async renamePipeline(id: string, dto: PursuitNameDto, orgId: string): Promise<PursuitPipeline> {
    const name: string = requireName(dto.name);
    return this.prisma.$transaction(async (tx) => {
      await lockPipelines(tx, orgId);
      const pipelines: PursuitPipeline[] = await tx.pursuitPipeline.findMany({ where: { organizationId: orgId } });
      if (!pipelines.some((p) => p.id === id)) throw new NotFoundException("Pipeline not found");
      assertFreeName(pipelines, name, PIPELINE_TAKEN, id);
      return unique(() => tx.pursuitPipeline.update({ where: { id }, data: { name } }), PIPELINE_TAKEN);
    });
  }

  async reorderPipelines(dto: ReorderPursuitPipelinesDto, orgId: string): Promise<PipelineWithStages[]> {
    await this.prisma.$transaction(async (tx) => {
      await lockPipelines(tx, orgId);
      const pipelines: PursuitPipeline[] = await tx.pursuitPipeline.findMany({ where: { organizationId: orgId } });
      assertSameSet(dto.ids, pipelines, "Send every pipeline once");
      for (const [order, id] of dto.ids.entries()) await tx.pursuitPipeline.update({ where: { id }, data: { order } });
    });
    return this.findAll(orgId);
  }

  /**
   * Deletes a pipeline after moving its contracts (any outcome) to `moveTo`: each keeps its stage
   * when the target has one with the same name (ignoring case), else goes to the target's first stage.
   */
  async removePipeline(id: string, moveTo: string, orgId: string): Promise<void> {
    await this.pipelineOrThrow(id, orgId);
    await this.prisma.$transaction(async (tx) => {
      // One pipeline delete per workspace at a time, so two can't empty it between them.
      await lockPipelines(tx, orgId);
      const pipelines: PipelineWithStages[] = await tx.pursuitPipeline.findMany({
        where: { organizationId: orgId },
        orderBy: BY_ORDER,
        include: WITH_STAGES,
      });
      const source: PipelineWithStages | undefined = pipelines.find((p) => p.id === id);
      if (!source) throw new NotFoundException("Pipeline not found");
      if (pipelines.length <= 1) throw new BadRequestException("A workspace needs at least one pipeline");
      const target: PipelineWithStages | undefined = pipelines.find((p) => p.id === moveTo && p.id !== id);
      if (!target) throw new BadRequestException("Pick another pipeline to move its contracts to");

      // Unassigned contracts belong to the first pipeline.
      const owned = pipelines[0].id === id ? [{ pipelineId: id }, { pipelineId: null }] : [{ pipelineId: id }];
      for (const where of owned) {
        for (const from of source.stages) {
          const same: PursuitStage | undefined = target.stages.find((s) => s.name.toLowerCase() === from.name.toLowerCase());
          await tx.projectPursuit.updateMany({
            where: { organizationId: orgId, ...where, stage: from.slug },
            data: { pipelineId: target.id, stage: (same ?? target.stages[0]).slug },
          });
        }
        await tx.projectPursuit.updateMany({
          where: { organizationId: orgId, ...where },
          data: { pipelineId: target.id, stage: target.stages[0].slug },
        });
      }
      await tx.pursuitPipeline.delete({ where: { id } });
    });
  }

  /* ------------------------------ Stages ------------------------------ */

  private async stageOrThrow(id: string, orgId: string): Promise<PursuitStage> {
    const stage: PursuitStage | null = await this.prisma.pursuitStage.findFirst({ where: { id, organizationId: orgId } });
    if (!stage) throw new NotFoundException("Stage not found");
    return stage;
  }

  private stagesOf(db: Db, pipelineId: string): Promise<PursuitStage[]> {
    return db.pursuitStage.findMany({ where: { pipelineId }, orderBy: BY_ORDER });
  }

  async createStage(dto: CreatePursuitStageDto, orgId: string): Promise<PursuitStage> {
    const name: string = requireName(dto.name);
    const { id: pipelineId }: PipelineWithStages = await this.pipelineFor(orgId, dto.pipelineId);
    return this.prisma.$transaction(async (tx) => {
      // The pipeline lock keeps a pipeline delete from landing between the check and the write.
      await lockPipelines(tx, orgId);
      await lockStages(tx, pipelineId);
      if (!(await tx.pursuitPipeline.findFirst({ where: { id: pipelineId, organizationId: orgId } }))) {
        throw new NotFoundException("Pipeline not found");
      }
      const stages: PursuitStage[] = await this.stagesOf(tx, pipelineId);
      if (stages.length >= MAX_PURSUIT_STAGES) {
        throw new BadRequestException(`A pipeline can have at most ${MAX_PURSUIT_STAGES} stages`);
      }
      assertFreeName(stages, name, STAGE_TAKEN);
      return unique(
        () =>
          tx.pursuitStage.create({
            data: {
              organizationId: orgId,
              pipelineId,
              name,
              slug: uniqueSlug(name, stages.map((s) => s.slug), "stage"),
              order: stages.length ? Math.max(...stages.map((s) => s.order)) + 1 : 0,
            },
          }),
        STAGE_TAKEN,
      );
    });
  }

  async renameStage(id: string, dto: PursuitNameDto, orgId: string): Promise<PursuitStage> {
    const { pipelineId }: PursuitStage = await this.stageOrThrow(id, orgId);
    const name: string = requireName(dto.name);
    return this.prisma.$transaction(async (tx) => {
      await lockStages(tx, pipelineId);
      const stages: PursuitStage[] = await this.stagesOf(tx, pipelineId);
      if (!stages.some((s) => s.id === id)) throw new NotFoundException("Stage not found");
      assertFreeName(stages, name, STAGE_TAKEN, id);
      return unique(() => tx.pursuitStage.update({ where: { id }, data: { name } }), STAGE_TAKEN);
    });
  }

  async reorderStages(dto: ReorderPursuitStagesDto, orgId: string): Promise<PursuitStage[]> {
    const { id: pipelineId }: PipelineWithStages = await this.pipelineFor(orgId, dto.pipelineId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockStages(tx, pipelineId);
        assertSameSet(dto.ids, await this.stagesOf(tx, pipelineId), "Send every stage once");
        for (const [order, id] of dto.ids.entries()) await tx.pursuitStage.update({ where: { id }, data: { order } });
      });
    } catch (err: unknown) {
      if (isNotFound(err)) throw new BadRequestException("Send every stage once");
      throw err;
    }
    return this.stagesOf(this.prisma, pipelineId);
  }

  /** Deletes a stage after moving every contract in it (any outcome) to `moveTo`. */
  async removeStage(id: string, moveTo: string, orgId: string): Promise<void> {
    const stage: PursuitStage = await this.stageOrThrow(id, orgId);
    const first: PursuitPipeline = await this.pipelineFor(orgId, null);
    await this.prisma.$transaction(async (tx) => {
      // One remove per pipeline at a time, so two admins can't each delete the other's target
      // or empty the pipeline between them. Checks below read the state after the lock.
      await lockStages(tx, stage.pipelineId);
      const stages: PursuitStage[] = await this.stagesOf(tx, stage.pipelineId);
      if (!stages.some((s) => s.id === id)) throw new NotFoundException("Stage not found");
      if (stages.length <= 1) throw new BadRequestException("A pipeline needs at least one stage");
      const target: PursuitStage | undefined = stages.find((s) => s.id === moveTo && s.id !== id);
      if (!target) throw new BadRequestException("Pick another stage in this pipeline to move its contracts to");

      // Unassigned contracts belong to the first pipeline.
      const owned = first.id === stage.pipelineId ? [stage.pipelineId, null] : [stage.pipelineId];
      for (const pipelineId of owned) {
        await tx.projectPursuit.updateMany({
          where: { organizationId: orgId, pipelineId, stage: stage.slug },
          data: { stage: target.slug },
        });
      }
      await tx.pursuitStage.delete({ where: { id } });
    });
  }
}
