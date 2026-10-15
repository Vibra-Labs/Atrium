import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type IntegrationDestination } from "@atrium/database";
import type { IntegrationType } from "@atrium/shared";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { assertHostnameIsPublic } from "../embeds/safe-fetch";
import { paginationArgs, paginatedResponse } from "../common";
import { IntegrationDispatcher, LEASE_MS } from "./integration-dispatcher.service";
import type { SendResult } from "./delivery-policy";
import type { IntegrationPayload } from "./integration-payload";
import { validateDestinationUrl } from "./url-guard";
import type { CreateIntegrationDto, UpdateIntegrationDto } from "./integrations.dto";

export interface IntegrationSummary {
  id: string;
  type: string;
  name: string;
  urlPreview: string;
  events: string[];
  projectIds: string[];
  enabled: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  createdAt: Date;
}

export interface CreatedIntegration extends IntegrationSummary {
  /** Webhook signing secret. Only returned here and from rotate-secret. */
  secret?: string;
}

export interface DeliverySummary {
  id: string;
  event: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
  deliveredAt: Date | null;
  payload: unknown;
}

export interface DeliveryPage {
  data: DeliverySummary[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface TestResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
}

function newSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

@Injectable()
export class IntegrationsService {
  /** Swappable in tests. */
  checkHost: (hostname: string) => Promise<void> = assertHostnameIsPublic;

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private dispatcher: IntegrationDispatcher,
  ) {}

  private maskUrl(encrypted: string): string {
    try {
      return `${new URL(this.settings.decrypt(encrypted)).origin}/••••`;
    } catch {
      return "••••";
    }
  }

  private toSummary(row: IntegrationDestination): IntegrationSummary {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      urlPreview: this.maskUrl(row.url),
      events: row.events,
      projectIds: row.projectIds,
      enabled: row.enabled,
      disabledReason: row.disabledReason,
      consecutiveFailures: row.consecutiveFailures,
      createdAt: row.createdAt,
    };
  }

  private async findOwned(id: string, organizationId: string): Promise<IntegrationDestination> {
    const row = await this.prisma.integrationDestination.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException("Integration not found");
    return row;
  }

  private async assertUrl(type: IntegrationType, url: string): Promise<void> {
    const error: string | null = await validateDestinationUrl(type, url, this.dispatcher.urlPolicy, this.checkHost);
    if (error) throw new BadRequestException(error);
  }

  private async assertProjects(projectIds: string[] | undefined, organizationId: string): Promise<void> {
    if (!projectIds?.length) return;
    const found = await this.prisma.project.findMany({
      where: { id: { in: projectIds }, organizationId },
      select: { id: true },
    });
    if (found.length !== new Set(projectIds).size) throw new BadRequestException("Unknown project");
  }

  async list(organizationId: string): Promise<IntegrationSummary[]> {
    const rows = await this.prisma.integrationDestination.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => this.toSummary(r));
  }

  async create(dto: CreateIntegrationDto, organizationId: string, userId: string): Promise<CreatedIntegration> {
    await this.assertUrl(dto.type, dto.url);
    await this.assertProjects(dto.projectIds, organizationId);
    const secret: string | undefined = dto.type === "webhook" ? newSecret() : undefined;
    const row = await this.prisma.integrationDestination.create({
      data: {
        organizationId,
        type: dto.type,
        name: dto.name,
        url: this.settings.encrypt(dto.url),
        secret: secret ? this.settings.encrypt(secret) : null,
        events: [...new Set(dto.events)],
        projectIds: [...new Set(dto.projectIds ?? [])],
        createdById: userId,
      },
    });
    return { ...this.toSummary(row), ...(secret && { secret }) };
  }

  async update(id: string, dto: UpdateIntegrationDto, organizationId: string): Promise<IntegrationSummary> {
    const existing = await this.findOwned(id, organizationId);
    if (dto.url !== undefined) await this.assertUrl(existing.type as IntegrationType, dto.url);
    await this.assertProjects(dto.projectIds, organizationId);

    const reEnabling: boolean = dto.enabled === true && !existing.enabled;
    const row = await this.prisma.integrationDestination.update({
      where: { id },
      data: {
        name: dto.name,
        url: dto.url !== undefined ? this.settings.encrypt(dto.url) : undefined,
        events: dto.events ? [...new Set(dto.events)] : undefined,
        projectIds: dto.projectIds ? [...new Set(dto.projectIds)] : undefined,
        enabled: dto.enabled,
        ...(reEnabling && { disabledReason: null, consecutiveFailures: 0 }),
      },
    });
    return this.toSummary(row);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.findOwned(id, organizationId);
    await this.prisma.integrationDestination.delete({ where: { id } });
  }

  async rotateSecret(id: string, organizationId: string): Promise<{ secret: string }> {
    const existing = await this.findOwned(id, organizationId);
    if (existing.type !== "webhook") throw new BadRequestException("Only webhooks have a signing secret");
    const secret: string = newSecret();
    await this.prisma.integrationDestination.update({
      where: { id },
      data: { secret: this.settings.encrypt(secret) },
    });
    return { secret };
  }

  /** Sends a `test.ping` right away, outside the delivery log and retry queue. */
  async test(id: string, organizationId: string, userId: string): Promise<TestResult> {
    const destination = await this.findOwned(id, organizationId);
    const payload: IntegrationPayload = await this.dispatcher.buildPayload({
      event: "test.ping",
      organizationId,
      projectId: null,
      actorId: userId,
      title: "Test message from Atrium",
      detail: `If you can see this, "${destination.name}" is connected.`,
      path: "/dashboard/settings/integrations",
    });
    const result: SendResult = await this.dispatcher.send(
      this.dispatcher.targetFor(destination),
      payload,
      `test_${payload.id}`,
      this.dispatcher.urlPolicy,
    );
    return { ok: result.ok, statusCode: result.statusCode, error: result.error };
  }

  async listDeliveries(id: string, organizationId: string, page: number, limit: number): Promise<DeliveryPage> {
    await this.findOwned(id, organizationId);
    const where = { destinationId: id };
    const [data, total] = await Promise.all([
      this.prisma.integrationDelivery.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...paginationArgs(page, limit),
      }),
      this.prisma.integrationDelivery.count({ where }),
    ]);
    return paginatedResponse(data, total, page, limit);
  }

  async resend(deliveryId: string, organizationId: string): Promise<DeliverySummary | null> {
    const original = await this.prisma.integrationDelivery.findFirst({
      where: { id: deliveryId, destination: { organizationId } },
    });
    if (!original) throw new NotFoundException("Delivery not found");
    const created = await this.prisma.integrationDelivery.create({
      data: {
        destinationId: original.destinationId,
        event: original.event,
        payload: original.payload as Prisma.InputJsonValue,
        status: "pending",
        nextAttemptAt: new Date(Date.now() + LEASE_MS),
      },
    });
    await this.dispatcher.attempt(created.id);
    return this.prisma.integrationDelivery.findUnique({ where: { id: created.id } });
  }
}
