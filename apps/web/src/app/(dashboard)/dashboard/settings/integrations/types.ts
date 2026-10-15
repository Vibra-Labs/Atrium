import type { IntegrationEvent, IntegrationType } from "@atrium/shared";

export interface IntegrationSummary {
  id: string;
  type: IntegrationType;
  name: string;
  urlPreview: string;
  events: IntegrationEvent[];
  projectIds: string[];
  enabled: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  createdAt: string;
}

export interface CreatedIntegration extends IntegrationSummary {
  secret?: string;
}

export interface Delivery {
  id: string;
  event: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
  payload: unknown;
}

export interface TestResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
}

export interface ProjectOption {
  id: string;
  name: string;
}

export const TYPE_LABELS: Record<IntegrationType, string> = {
  slack: "Slack",
  discord: "Discord",
  webhook: "Webhook",
};

export const URL_HELP: Record<IntegrationType, { placeholder: string; help: string; link?: string }> = {
  slack: {
    placeholder: "https://hooks.slack.com/services/…",
    help: "Create an incoming webhook for the channel in Slack, then paste its URL.",
    link: "https://api.slack.com/messaging/webhooks",
  },
  discord: {
    placeholder: "https://discord.com/api/webhooks/…",
    help: "In Discord: Channel settings → Integrations → Webhooks → New webhook → Copy URL.",
    link: "https://support.discord.com/hc/en-us/articles/228383668",
  },
  webhook: {
    placeholder: "https://hooks.zapier.com/…",
    help: "Atrium POSTs signed JSON to this URL. Works with Zapier, Make, n8n or your own code.",
  },
};
