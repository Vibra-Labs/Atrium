import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../../prisma/prisma.service";

const PRIVILEGED_ROLES = new Set(["owner", "admin"]);

export async function assertProjectAccess(
  prisma: PrismaService,
  projectId: string,
  userId: string,
  role: string,
  organizationId?: string,
): Promise<void> {
  if (PRIVILEGED_ROLES.has(role)) return;

  const assignment = await prisma.projectClient.findFirst({
    where: {
      projectId,
      userId,
      ...(organizationId ? { project: { organizationId } } : {}),
    },
  });
  if (!assignment) {
    throw new ForbiddenException("You do not have access to this project");
  }
}
