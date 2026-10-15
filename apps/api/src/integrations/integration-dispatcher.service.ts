import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type IntegrationDestination } from "@atrium/database";
import type { IntegrationEvent, IntegrationType } from "@atrium/shared";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { BillingService } from "../billing/billing.service";
import { AUTO_DISABLE_AFTER, nextStep, type NextStep, type SendResult } from "./delivery-policy";
import type { IntegrationPayload, PayloadEvent } from "./integration-payload";
import { sendDelivery, type SendTarget } from "./integration-sender";
import type { UrlPolicy } from "./url-guard";

/** Pushed onto a delivery while it is being attempted, so the retry cron leaves it alone. */
export const LEASE_MS = 2 * 60_000;
const CLAIM_BATCH = 50;
const RETENTION_MS = 30 * 24 * 3_600_000;

export interface DispatchInput {
  event: IntegrationEvent;
  organizationId: string;
  /** null for workspace-level events; those reach project-filtered destinations too. */
  projectId: string | null;
  actorId?: string | null;
  /** Used when the actor has no user id at hand. */
  actorName?: string;
  title: string;
  detail?: string | null;
  data?: Record<string, unknown>;
  /** App path the message links to, e.g. `/dashboard/projects/abc?tab=tasks`. */
  path: string;
}

@Injectable()
export class IntegrationDispatcher {
  private readonly logger = new Logger(IntegrationDispatcher.name);
  private readonly webUrl: string;
  readonly urlPolicy: UrlPolicy;
  private processing = false;

  /** Swappable in tests. */
  send: (target: SendTarget, payload: IntegrationPayload, deliveryId: string, policy: UrlPolicy) => Promise<SendResult> =
    sendDelivery;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private settings: SettingsService,
    private billing: BillingService,
  ) {
    this.webUrl = this.config.get("WEB_URL", "http://localhost:3000").replace(/\/+$/, "");
    const allowPrivate: boolean = this.config.get("INTEGRATIONS_ALLOW_PRIVATE_URLS", "false") === "true";
    // LAN services (n8n on a home server) rarely have TLS, so opting into private URLs allows http too.
    this.urlPolicy = {
      allowPrivate,
      allowHttp: allowPrivate || this.config.get("NODE_ENV", "development") !== "production",
    };
  }

  /** Fire-and-forget entry point for NotificationsService. Never throws. */
  dispatch(input: DispatchInput): void {
    this.run(input).catch((err) => {
      this.logger.error(
        `Failed to dispatch ${input.event} for ${input.organizationId}`,
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  async run(input: DispatchInput): Promise<void> {
    const destinations = await this.prisma.integrationDestination.findMany({
      where: { organizationId: input.organizationId, enabled: true, events: { has: input.event } },
      select: { id: true, projectIds: true },
    });
    const matching = destinations.filter(
      (d) => !input.projectId || d.projectIds.length === 0 || d.projectIds.includes(input.projectId),
    );
    if (matching.length === 0) return;
    if (!(await this.billing.hasFeature(input.organizationId, "integrations"))) return;

    const payload: IntegrationPayload = await this.buildPayload(input);
    const deliveries = await this.prisma.$transaction(
      matching.map((d) =>
        this.prisma.integrationDelivery.create({
          data: {
            destinationId: d.id,
            event: input.event,
            payload: payload as unknown as Prisma.InputJsonValue,
            status: "pending",
            nextAttemptAt: new Date(Date.now() + LEASE_MS),
          },
          select: { id: true },
        }),
      ),
    );
    await Promise.allSettled(deliveries.map((d) => this.attempt(d.id)));
  }

  async buildPayload(
    input: Omit<DispatchInput, "event"> & { event: PayloadEvent },
  ): Promise<IntegrationPayload> {
    const [org, project, actor] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } }),
      input.projectId
        ? this.prisma.project.findUnique({ where: { id: input.projectId }, select: { name: true } })
        : null,
      input.actorId
        ? this.prisma.user.findUnique({ where: { id: input.actorId }, select: { name: true } })
        : null,
    ]);

    let actorField: IntegrationPayload["actor"] = null;
    if (input.actorId) actorField = { id: input.actorId, name: actor?.name ?? input.actorName ?? "Someone" };
    else if (input.actorName) actorField = { id: null, name: input.actorName };

    return {
      id: `evt_${randomUUID()}`,
      event: input.event,
      createdAt: new Date().toISOString(),
      workspace: { id: input.organizationId, name: org?.name ?? "" },
      project: input.projectId && project ? { id: input.projectId, name: project.name } : null,
      actor: actorField,
      title: input.title,
      detail: input.detail ?? null,
      data: input.data ?? {},
      url: `${this.webUrl}${input.path}`,
    };
  }

  targetFor(destination: Pick<IntegrationDestination, "type" | "url" | "secret">): SendTarget {
    return {
      type: destination.type as IntegrationType,
      url: this.settings.decrypt(destination.url),
      secret: destination.secret ? this.settings.decrypt(destination.secret) : null,
    };
  }

  /** One attempt at a pending delivery, then record the outcome. */
  async attempt(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.integrationDelivery.findUnique({
      where: { id: deliveryId },
      include: { destination: true },
    });
    if (!delivery || delivery.status !== "pending") return;
    const destination: IntegrationDestination = delivery.destination;

    if (!destination.enabled) {
      await this.prisma.integrationDelivery.update({
        where: { id: deliveryId },
        data: { status: "failed", nextAttemptAt: null, lastError: "Destination is disabled" },
      });
      return;
    }

    let result: SendResult;
    try {
      result = await this.send(
        this.targetFor(destination),
        delivery.payload as unknown as IntegrationPayload,
        delivery.id,
        this.urlPolicy,
      );
    } catch (err) {
      // e.g. the URL can't be decrypted after BETTER_AUTH_SECRET changed. Recording it as a
      // failed attempt keeps the retry count moving, so the delivery can't loop forever.
      this.logger.error(`Delivery ${deliveryId} could not be sent`, err instanceof Error ? err.stack : String(err));
      result = { ok: false, statusCode: null, error: "Could not prepare the request", retryAfterMs: null };
    }
    const attempts: number = delivery.attempts + 1;
    const step: NextStep = nextStep(destination.type as IntegrationType, attempts, result);

    await this.prisma.integrationDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts,
        status: step.status,
        lastStatusCode: result.statusCode,
        lastError: result.error,
        nextAttemptAt: step.status === "pending" ? new Date(Date.now() + step.delayMs) : null,
        deliveredAt: step.status === "success" ? new Date() : undefined,
      },
    });

    if (step.status === "success" && destination.consecutiveFailures > 0) {
      await this.prisma.integrationDestination.update({
        where: { id: destination.id },
        data: { consecutiveFailures: 0 },
      });
    } else if (step.status === "failed") {
      await this.recordFinalFailure(destination);
    }
  }

  private async recordFinalFailure(destination: IntegrationDestination): Promise<void> {
    const updated = await this.prisma.integrationDestination.update({
      where: { id: destination.id },
      data: { consecutiveFailures: { increment: 1 } },
    });
    if (updated.consecutiveFailures < AUTO_DISABLE_AFTER) return;

    // Conditional on `enabled` so concurrent final failures disable (and notify) only once.
    const { count } = await this.prisma.integrationDestination.updateMany({
      where: { id: destination.id, enabled: true },
      data: {
        enabled: false,
        disabledReason: `Turned off after ${AUTO_DISABLE_AFTER} failed deliveries in a row`,
      },
    });
    if (count === 0) return;
    this.logger.warn(`Disabled integration ${destination.id} after repeated failures`);

    const admins = await this.prisma.member.findMany({
      where: { organizationId: destination.organizationId, role: { in: ["owner", "admin"] } },
      select: { userId: true },
    });
    await this.prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.userId,
        organizationId: destination.organizationId,
        type: "integration_disabled",
        title: `Integration "${destination.name}" was turned off`,
        message: "Deliveries kept failing. Check the URL and turn it back on in Settings.",
        link: "/dashboard/settings/integrations",
      })),
    });
  }

  /**
   * Claim due retries and attempt them. The claim pushes `nextAttemptAt`
   * forward under SKIP LOCKED, so other API replicas pick different rows.
   */
  async processDue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE integration_delivery
        SET "nextAttemptAt" = NOW() + make_interval(secs => ${LEASE_MS / 1000})
        WHERE id IN (
          SELECT id FROM integration_delivery
          WHERE status = 'pending' AND "nextAttemptAt" <= NOW()
          ORDER BY "nextAttemptAt"
          LIMIT ${CLAIM_BATCH}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`;
      for (const { id } of claimed) {
        await this.attempt(id).catch((err) => {
          this.logger.error(`Delivery ${id} attempt crashed`, err instanceof Error ? err.stack : String(err));
        });
      }
    } finally {
      this.processing = false;
    }
  }

  async pruneOld(): Promise<number> {
    const result = await this.prisma.integrationDelivery.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) }, status: { not: "pending" } },
    });
    return result.count;
  }
}
