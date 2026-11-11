import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
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
import { isPrismaUniqueViolation } from "../common/helpers/prisma-errors";
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

/** "Verbal yes!" → "verbal_yes"; adds _2, _3… when taken. */
function uniqueSlug(name: string, taken: string[]): string {
  const base: string = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "stage";
  let slug: string = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}_${n}`;
  return slug;
}

function assertFreeName(rows: { id: string; name: string }[], name: string, message: string, exceptId?: string): void {
  const lower: string = name.toLowerCase();
  if (rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === lower)) throw new ConflictException(message);
}

/** Exactly these ids, once each, or 400. */
function assertSameSet(ids: string[], rows: { id: string }[], message: string): void {
  const set: Set<string> = new Set(ids);
  if (ids.length !== rows.length || set.size !== rows.length || rows.some((r) => !set.has(r.id))) {
    throw new BadRequestException(message);
  }
}

async function unique<T>(write: () => Promise<T>, message: string): Promise<T> {
  try {
    return await write();
  } catch (err: unknown) {
    if (isPrismaUniqueViolation(err)) throw new ConflictException(message);
    throw err;
  }
}

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

/** Gives a new workspace the default pipelines, each with the default stages. */
export async function seedDefaultPipelines(db: Db, orgId: string): Promise<void> {
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
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pursuit-pipelines:${id}`}))`;
        if (await tx.pursuitPipeline.findFirst({ where: { organizationId: id } })) return;
        await seedDefaultPipelines(tx, id);
      });
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

  /** A contract's pipeline: the given one, or the first when null. 400 when the id isn't this workspace's. */
  async pipelineFor(orgId: string, pipelineId: string | null): Promise<PipelineWithStages> {
    const found: PipelineWithStages | null = await this.prisma.pursuitPipeline.findFirst({
      where: pipelineId === null ? { organizationId: orgId } : { id: pipelineId, organizationId: orgId },
      orderBy: BY_ORDER,
      include: WITH_STAGES,
    });
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
    const pipelines: PursuitPipeline[] = await this.prisma.pursuitPipeline.findMany({ where: { organizationId: orgId } });
    if (pipelines.length >= MAX_PURSUIT_PIPELINES) {
      throw new BadRequestException(`A workspace can have at most ${MAX_PURSUIT_PIPELINES} pipelines`);
    }
    assertFreeName(pipelines, name, PIPELINE_TAKEN);
    const order: number = pipelines.length ? Math.max(...pipelines.map((p) => p.order)) + 1 : 0;
    return unique(() => createWithDefaultStages(this.prisma, orgId, name, order), PIPELINE_TAKEN);
  }

  async renamePipeline(id: string, dto: PursuitNameDto, orgId: string): Promise<PursuitPipeline> {
    await this.pipelineOrThrow(id, orgId);
    const name: string = requireName(dto.name);
    assertFreeName(await this.prisma.pursuitPipeline.findMany({ where: { organizationId: orgId } }), name, PIPELINE_TAKEN, id);
    return unique(() => this.prisma.pursuitPipeline.update({ where: { id }, data: { name } }), PIPELINE_TAKEN);
  }

  async reorderPipelines(dto: ReorderPursuitPipelinesDto, orgId: string): Promise<PipelineWithStages[]> {
    const pipelines: PursuitPipeline[] = await this.prisma.pursuitPipeline.findMany({ where: { organizationId: orgId } });
    assertSameSet(dto.ids, pipelines, "Send every pipeline once");
    await this.prisma.$transaction(
      dto.ids.map((id, order) => this.prisma.pursuitPipeline.update({ where: { id }, data: { order } })),
    );
    return this.findAll(orgId);
  }

  /**
   * Deletes a pipeline after moving its contracts (any outcome) to `moveTo`: each keeps its stage
   * when the target has the same one, else goes to the target's first stage.
   */
  async removePipeline(id: string, moveTo: string, orgId: string): Promise<void> {
    await this.pipelineOrThrow(id, orgId);
    await this.prisma.$transaction(async (tx) => {
      // One pipeline delete per workspace at a time, so two can't empty it between them.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pursuit-pipelines:${orgId}`}))`;
      const pipelines: PipelineWithStages[] = await tx.pursuitPipeline.findMany({
        where: { organizationId: orgId },
        orderBy: BY_ORDER,
        include: WITH_STAGES,
      });
      if (!pipelines.some((p) => p.id === id)) throw new NotFoundException("Pipeline not found");
      if (pipelines.length <= 1) throw new BadRequestException("A workspace needs at least one pipeline");
      const target: PipelineWithStages | undefined = pipelines.find((p) => p.id === moveTo && p.id !== id);
      if (!target) throw new BadRequestException("Pick another pipeline to move its contracts to");

      // Unassigned contracts belong to the first pipeline.
      const owned = pipelines[0].id === id ? [{ pipelineId: id }, { pipelineId: null }] : [{ pipelineId: id }];
      for (const where of owned) {
        await tx.projectPursuit.updateMany({
          where: { organizationId: orgId, ...where, stage: { in: target.stages.map((s) => s.slug) } },
          data: { pipelineId: target.id },
        });
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
    const pipeline: PipelineWithStages = await this.pipelineFor(orgId, dto.pipelineId);
    const stages: PursuitStage[] = pipeline.stages;
    if (stages.length >= MAX_PURSUIT_STAGES) {
      throw new BadRequestException(`A pipeline can have at most ${MAX_PURSUIT_STAGES} stages`);
    }
    assertFreeName(stages, name, STAGE_TAKEN);
    return unique(
      () =>
        this.prisma.pursuitStage.create({
          data: {
            organizationId: orgId,
            pipelineId: pipeline.id,
            name,
            slug: uniqueSlug(name, stages.map((s) => s.slug)),
            order: stages.length ? Math.max(...stages.map((s) => s.order)) + 1 : 0,
          },
        }),
      STAGE_TAKEN,
    );
  }

  async renameStage(id: string, dto: PursuitNameDto, orgId: string): Promise<PursuitStage> {
    const stage: PursuitStage = await this.stageOrThrow(id, orgId);
    const name: string = requireName(dto.name);
    assertFreeName(await this.stagesOf(this.prisma, stage.pipelineId), name, STAGE_TAKEN, id);
    return unique(() => this.prisma.pursuitStage.update({ where: { id }, data: { name } }), STAGE_TAKEN);
  }

  async reorderStages(dto: ReorderPursuitStagesDto, orgId: string): Promise<PursuitStage[]> {
    const pipeline: PipelineWithStages = await this.pipelineFor(orgId, dto.pipelineId);
    assertSameSet(dto.ids, pipeline.stages, "Send every stage once");
    await this.prisma.$transaction(
      dto.ids.map((id, order) => this.prisma.pursuitStage.update({ where: { id }, data: { order } })),
    );
    return this.stagesOf(this.prisma, pipeline.id);
  }

  /** Deletes a stage after moving every contract in it (any outcome) to `moveTo`. */
  async removeStage(id: string, moveTo: string, orgId: string): Promise<void> {
    const stage: PursuitStage = await this.stageOrThrow(id, orgId);
    const first: PursuitPipeline = await this.pipelineFor(orgId, null);
    await this.prisma.$transaction(async (tx) => {
      // One remove per pipeline at a time, so two admins can't each delete the other's target
      // or empty the pipeline between them. Checks below read the state after the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pursuit-stages:${stage.pipelineId}`}))`;
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
