import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { BUILT_IN_STATUS_SLUGS, MAX_PROJECT_STATUSES } from "@atrium/shared";
import type { Prisma, ProjectStatus } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import { requireName } from "../contacts/require-name";
import { assertFreeName, assertSameSet, unique, uniqueSlug } from "./ordered-names";
import type { CreateProjectStatusDto, ReorderProjectStatusesDto, UpdateProjectStatusDto } from "./project-statuses.dto";

const TAKEN = "A status with this name already exists";
const DEFAULT_COLOR = "#6b7280";

type Tx = Prisma.TransactionClient;

/**
 * Serialises changes to a workspace's statuses, so checks (the cap, case-insensitive names, a
 * delete's target) hold until commit. `shared` is for writers that only need a status to keep
 * existing — setting a project's status — so they don't block one another, only a delete.
 */
export async function lockProjectStatuses(tx: Tx, orgId: string, shared: boolean = false): Promise<void> {
  const key: string = `project-statuses:${orgId}`;
  if (shared) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${key}))`;
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/**
 * A workspace's project statuses (the chips on a signed project). Any can be renamed, recolored
 * and reordered; only the workspace's own can be deleted, since the app relies on the built-in
 * slugs (completed, cancelled…). Slugs never change, so a rename never breaks that.
 */
@Injectable()
export class ProjectStatusesService {
  constructor(private prisma: PrismaService) {}

  private list(db: Tx | PrismaService, orgId: string): Promise<ProjectStatus[]> {
    return db.projectStatus.findMany({ where: { organizationId: orgId }, orderBy: { order: "asc" } });
  }

  /** Runs `work` under the workspace lock with a fresh list of its statuses. */
  private locked<T>(orgId: string, work: (tx: Tx, statuses: ProjectStatus[]) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await lockProjectStatuses(tx, orgId);
      return work(tx, await this.list(tx, orgId));
    });
  }

  private static find(statuses: ProjectStatus[], id: string): ProjectStatus {
    const found: ProjectStatus | undefined = statuses.find((s) => s.id === id);
    if (!found) throw new NotFoundException("Status not found");
    return found;
  }

  async create(dto: CreateProjectStatusDto, orgId: string): Promise<ProjectStatus> {
    const name: string = requireName(dto.name);
    return this.locked(orgId, (tx, statuses) => {
      if (statuses.length >= MAX_PROJECT_STATUSES) {
        throw new BadRequestException(`A workspace can have at most ${MAX_PROJECT_STATUSES} statuses`);
      }
      assertFreeName(statuses, name, TAKEN);
      return unique(
        () =>
          tx.projectStatus.create({
            data: {
              organizationId: orgId,
              name,
              // Built-in slugs are skipped too, so a deleted-and-re-added default can never collide.
              slug: uniqueSlug(name, [...statuses.map((s) => s.slug), ...BUILT_IN_STATUS_SLUGS], "status"),
              order: statuses.length ? Math.max(...statuses.map((s) => s.order)) + 1 : 0,
              color: dto.color ?? DEFAULT_COLOR,
            },
          }),
        TAKEN,
      );
    });
  }

  async update(id: string, dto: UpdateProjectStatusDto, orgId: string): Promise<ProjectStatus> {
    const name: string | undefined = dto.name === undefined ? undefined : requireName(dto.name);
    return this.locked(orgId, (tx, statuses) => {
      ProjectStatusesService.find(statuses, id);
      if (name !== undefined) assertFreeName(statuses, name, TAKEN, id);
      return unique(() => tx.projectStatus.update({ where: { id }, data: { name, color: dto.color } }), TAKEN);
    });
  }

  async reorder(dto: ReorderProjectStatusesDto, orgId: string): Promise<ProjectStatus[]> {
    return this.locked(orgId, async (tx, statuses) => {
      assertSameSet(dto.ids, statuses, "Send every status once");
      for (const [order, id] of dto.ids.entries()) {
        await tx.projectStatus.update({ where: { id }, data: { order } });
      }
      const byId: Map<string, ProjectStatus> = new Map(statuses.map((s) => [s.id, s]));
      return dto.ids.map((id, order) => ({ ...byId.get(id)!, order }));
    });
  }

  /** Deletes one of the workspace's own statuses after moving its projects to `moveTo`. */
  async remove(id: string, moveTo: string, orgId: string): Promise<void> {
    await this.locked(orgId, async (tx, statuses) => {
      const status: ProjectStatus = ProjectStatusesService.find(statuses, id);
      if (BUILT_IN_STATUS_SLUGS.includes(status.slug)) {
        throw new BadRequestException("Built-in statuses can't be deleted. Rename it instead.");
      }
      const target: ProjectStatus | undefined = statuses.find((s) => s.id === moveTo && s.id !== id);
      if (!target) throw new BadRequestException("Pick another status to move its projects to");
      await tx.project.updateMany({
        where: { organizationId: orgId, status: status.slug },
        data: { status: target.slug },
      });
      await tx.projectStatus.delete({ where: { id } });
    });
  }
}
