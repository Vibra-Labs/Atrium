import type { IntegrationEvent } from "@atrium/shared";

export type PayloadEvent = IntegrationEvent | "test.ping";

/** What generic webhooks receive. Slack and Discord messages are rendered from it. */
export interface IntegrationPayload {
  id: string;
  event: PayloadEvent;
  createdAt: string;
  workspace: { id: string; name: string };
  project: { id: string; name: string } | null;
  actor: { id: string | null; name: string } | null;
  title: string;
  detail: string | null;
  data: Record<string, unknown>;
  url: string;
}
