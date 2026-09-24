import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { MCP_ACTOR_ROLES } from "../common";
import type { Actor } from "../common";

export const API_KEY_PREFIX = "atr_";
const KEY_PREFIX_LENGTH = 12;
const LAST_USED_THROTTLE_MS = 60_000;

export interface CreatedApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  key: string;
  createdAt: Date;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  createdBy: string;
}

export type ResolvedApiKey = Actor & { apiKeyId: string };

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(private prisma: PrismaService) {}

  async create(name: string, userId: string, organizationId: string): Promise<CreatedApiKey> {
    const member = await this.prisma.member.findFirst({ where: { userId, organizationId } });
    if (!member || !MCP_ACTOR_ROLES.includes(member.role)) {
      throw new ForbiddenException("Only owners and admins can create API keys");
    }
    const key: string = API_KEY_PREFIX + randomBytes(32).toString("base64url");
    const keyPrefix: string = key.slice(0, KEY_PREFIX_LENGTH);
    const row = await this.prisma.apiKey.create({
      data: { name, keyHash: hashApiKey(key), keyPrefix, userId, organizationId, memberId: member.id },
    });
    return { id: row.id, name, keyPrefix, key, createdAt: row.createdAt };
  }

  async list(organizationId: string): Promise<ApiKeySummary[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { organizationId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, keyPrefix: true, createdAt: true, lastUsedAt: true,
        user: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id, name: r.name, keyPrefix: r.keyPrefix,
      createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, createdBy: r.user.name,
    }));
  }

  async revoke(id: string, organizationId: string): Promise<void> {
    const row = await this.prisma.apiKey.findFirst({
      where: { id, organizationId, revokedAt: null },
    });
    if (!row) throw new NotFoundException("API key not found");
    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async resolve(token: string): Promise<ResolvedApiKey | null> {
    if (!token.startsWith(API_KEY_PREFIX)) return null;

    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(token) },
      include: { user: true, organization: true },
    });
    if (!key || key.revokedAt) return null;

    const member = await this.prisma.member.findFirst({
      where: { id: key.memberId, userId: key.userId, organizationId: key.organizationId },
    });
    if (!member || !MCP_ACTOR_ROLES.includes(member.role)) return null;

    this.touch(key.id, key.lastUsedAt);
    return { apiKeyId: key.id, user: key.user, organization: key.organization, member };
  }

  /** Fire-and-forget; at most one write per key per minute. */
  private touch(id: string, lastUsedAt: Date | null): void {
    if (lastUsedAt && Date.now() - lastUsedAt.getTime() < LAST_USED_THROTTLE_MS) return;
    this.prisma.apiKey
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) => this.logger.error("Failed to update lastUsedAt", err));
  }
}
