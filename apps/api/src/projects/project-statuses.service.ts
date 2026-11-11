import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { BUILT_IN_STATUS_SLUGS, MAX_PROJECT_STATUSES } from "@atrium/shared";
import type { ProjectStatus } from "@atrium/database";
import { PrismaService } from "../prisma/prisma.service";
import { requireName } from "../contacts/require-name";
import { isPrismaUniqueViolation } from "../common/helpers/prisma-errors";
import type { CreateProjectStatusDto, ReorderProjectStatusesDto, UpdateProjectStatusDto } from "./project-statuses.dto";

const TAKEN = "A status with this name already exists";
const DEFAULT_COLOR = "#6b7280";

/** "Client review!" → "client_review"; adds _2, _3… when taken. */
function uniqueSlug(name: string, taken: string[]): string {
  const base: string = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "status";
  let slug: string = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}_${n}`;
  return slug;
}

async function unique<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err: unknown) {
    if (isPrismaUniqueViolation(err)) throw new ConflictException(TAKEN);
    throw err;
  }
}

/**
 * A workspace's project statuses (the chips on a signed project). Any can be renamed, recolored
 * and reordered; only the workspace's own can be deleted, since the app relies on the built-in
 * slugs (completed, cancelled…). Slugs never change, so a rename never breaks that.
 */
@Injectable()
export class ProjectStatusesService {
  constructor(private prisma: PrismaService) {}

  private list(orgId: string): Promise<ProjectStatus[]> {
    return this.prisma.projectStatus.findMany({ where: { organizationId: orgId }, orderBy: { order: "asc" } });
  }

  private async getOrThrow(id: string, orgId: string): Promise<ProjectStatus> {
    const found: ProjectStatus | null = await this.prisma.projectStatus.findFirst({ where: { id, organizationId: orgId } });
    if (!found) throw new NotFoundException("Status not found");
    return found;
  }

  private static assertFreeName(statuses: ProjectStatus[], name: string, exceptId?: string): void {
    const lower: string = name.toLowerCase();
    if (statuses.some((s) => s.id !== exceptId && s.name.toLowerCase() === lower)) throw new ConflictException(TAKEN);
  }

  async create(dto: CreateProjectStatusDto, orgId: string): Promise<ProjectStatus> {
    const name: string = requireName(dto.name);
    const statuses: ProjectStatus[] = await this.list(orgId);
    if (statuses.length >= MAX_PROJECT_STATUSES) {
      throw new BadRequestException(`A workspace can have at most ${MAX_PROJECT_STATUSES} statuses`);
    }
    ProjectStatusesService.assertFreeName(statuses, name);
    return unique(() =>
      this.prisma.projectStatus.create({
        data: {
          organizationId: orgId,
          name,
          // Built-in slugs are skipped too, so a deleted-and-re-added default can never collide.
          slug: uniqueSlug(name, [...statuses.map((s) => s.slug), ...BUILT_IN_STATUS_SLUGS]),
          order: statuses.length ? Math.max(...statuses.map((s) => s.order)) + 1 : 0,
          color: dto.color ?? DEFAULT_COLOR,
        },
      }),
    );
  }

  async update(id: string, dto: UpdateProjectStatusDto, orgId: string): Promise<ProjectStatus> {
    await this.getOrThrow(id, orgId);
    const name: string | undefined = dto.name === undefined ? undefined : requireName(dto.name);
    if (name !== undefined) ProjectStatusesService.assertFreeName(await this.list(orgId), name, id);
    return unique(() => this.prisma.projectStatus.update({ where: { id }, data: { name, color: dto.color } }));
  }

  async reorder(dto: ReorderProjectStatusesDto, orgId: string): Promise<ProjectStatus[]> {
    const statuses: ProjectStatus[] = await this.list(orgId);
    const ids: Set<string> = new Set(dto.ids);
    if (dto.ids.length !== statuses.length || ids.size !== statuses.length || statuses.some((s) => !ids.has(s.id))) {
      throw new BadRequestException("Send every status once");
    }
    await this.prisma.$transaction(
      dto.ids.map((id, order) => this.prisma.projectStatus.update({ where: { id }, data: { order } })),
    );
    return this.list(orgId);
  }

  /** Deletes one of the workspace's own statuses after moving its projects to `moveTo`. */
  async remove(id: string, moveTo: string, orgId: string): Promise<void> {
    const status: ProjectStatus = await this.getOrThrow(id, orgId);
    if (BUILT_IN_STATUS_SLUGS.includes(status.slug)) {
      throw new BadRequestException("Built-in statuses can't be deleted. Rename it instead.");
    }
    await this.prisma.$transaction(async (tx) => {
      // One delete per workspace at a time, so two admins can't each delete the other's target.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-statuses:${orgId}`}))`;
      const statuses: ProjectStatus[] = await tx.projectStatus.findMany({ where: { organizationId: orgId } });
      if (!statuses.some((s) => s.id === id)) throw new NotFoundException("Status not found");
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
