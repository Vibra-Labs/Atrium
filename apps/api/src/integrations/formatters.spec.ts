import { describe, expect, it } from "bun:test";
import { formatBody } from "./formatters";
import type { IntegrationPayload } from "./integration-payload";

const payload: IntegrationPayload = {
  id: "evt_1",
  event: "comment.created",
  createdAt: "2026-10-15T12:00:00.000Z",
  workspace: { id: "org1", name: "Acme Studio" },
  project: { id: "p1", name: "Website <redesign>" },
  actor: { id: "u1", name: "Jane & Co" },
  title: "New comment on Website <redesign>",
  detail: "Looks great <!channel> @everyone",
  data: { targetType: "task" },
  url: "https://app.test/dashboard/projects/p1",
};

describe("formatBody", () => {
  it("sends the canonical payload unchanged to generic webhooks", () => {
    expect(JSON.parse(formatBody("webhook", payload))).toEqual(payload);
  });

  it("builds Slack blocks with escaped text and a link button", () => {
    const body = JSON.parse(formatBody("slack", payload));
    expect(body.text).toBe("New comment on Website &lt;redesign&gt;");
    const json = JSON.stringify(body.blocks);
    expect(json).not.toContain("<!channel>");
    expect(json).toContain("&lt;!channel&gt;");
    expect(json).toContain("Jane &amp; Co");
    const actions = body.blocks.find((b: { type: string }) => b.type === "actions");
    expect(actions.elements[0].url).toBe(payload.url);
  });

  it("builds a Discord embed that cannot ping anyone", () => {
    const body = JSON.parse(formatBody("discord", payload));
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].title).toBe(payload.title);
    expect(body.embeds[0].url).toBe(payload.url);
    expect(body.embeds[0].description).toBe(payload.detail);
    expect(body.embeds[0].footer.text).toContain("Website <redesign>");
  });

  it("omits optional parts when project, actor and detail are missing", () => {
    const bare: IntegrationPayload = { ...payload, project: null, actor: null, detail: null };
    const slack = JSON.parse(formatBody("slack", bare));
    expect(slack.blocks.some((b: { type: string }) => b.type === "context")).toBe(true);
    const discord = JSON.parse(formatBody("discord", bare));
    expect(discord.embeds[0].description).toBeUndefined();
    expect(discord.embeds[0].author).toBeUndefined();
  });

  it("truncates long detail text", () => {
    const long: IntegrationPayload = { ...payload, detail: "x".repeat(5000) };
    const discord = JSON.parse(formatBody("discord", long));
    expect(discord.embeds[0].description.length).toBeLessThanOrEqual(1000);
  });
});
