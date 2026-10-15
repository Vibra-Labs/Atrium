import type { IntegrationType } from "@atrium/shared";
import type { IntegrationPayload } from "./integration-payload";

const DETAIL_LIMIT = 1000;
const DISCORD_COLOR = 0x6366f1;

function truncate(text: string, limit: number = DETAIL_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Slack treats <...> as links and mentions, so user text must be escaped. */
function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function joinParts(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}

function slackBody(p: IntegrationPayload): object {
  const context: string = joinParts([p.project?.name, p.actor?.name, p.workspace.name]);
  const blocks: object[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${slackEscape(p.title)}*` } },
  ];
  if (p.detail) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: slackEscape(truncate(p.detail)) } });
  }
  blocks.push(
    { type: "context", elements: [{ type: "mrkdwn", text: slackEscape(context) }] },
    {
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "View in Atrium" }, url: p.url }],
    },
  );
  return { text: slackEscape(p.title), blocks };
}

function discordBody(p: IntegrationPayload): object {
  return {
    username: "Atrium",
    // Client-written text must never turn into @everyone or role pings.
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: truncate(p.title, 256),
        url: p.url,
        description: p.detail ? truncate(p.detail) : undefined,
        color: DISCORD_COLOR,
        author: p.actor ? { name: truncate(p.actor.name, 256) } : undefined,
        footer: { text: truncate(joinParts([p.project?.name, p.workspace.name]), 2048) },
        timestamp: p.createdAt,
      },
    ],
  };
}

export function formatBody(type: IntegrationType, payload: IntegrationPayload): string {
  if (type === "slack") return JSON.stringify(slackBody(payload));
  if (type === "discord") return JSON.stringify(discordBody(payload));
  return JSON.stringify(payload);
}
