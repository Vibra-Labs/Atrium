import { describe, expect, it } from "bun:test";
import { validateDestinationUrl } from "./url-guard";

const strict = { allowPrivate: false, allowHttp: false };
const resolvePublic = async (): Promise<void> => {};
const resolvePrivate = async (): Promise<void> => {
  throw new Error("Hostname internal.example resolves to private address 10.0.0.5");
};

describe("validateDestinationUrl", () => {
  it("accepts a Slack incoming webhook URL", async () => {
    expect(
      await validateDestinationUrl("slack", "https://hooks.slack.com/services/T0/B0/xyz", strict, resolvePrivate),
    ).toBeNull();
  });

  it("rejects a Slack URL on another host", async () => {
    expect(
      await validateDestinationUrl("slack", "https://evil.com/services/T0/B0/xyz", strict, resolvePublic),
    ).toContain("hooks.slack.com");
  });

  it("accepts Discord webhook URLs on discord.com and discordapp.com", async () => {
    for (const host of ["discord.com", "discordapp.com"]) {
      expect(
        await validateDestinationUrl("discord", `https://${host}/api/webhooks/1/abc`, strict, resolvePrivate),
      ).toBeNull();
    }
  });

  it("rejects a Discord URL that is not a webhook path", async () => {
    expect(
      await validateDestinationUrl("discord", "https://discord.com/channels/1/2", strict, resolvePublic),
    ).not.toBeNull();
  });

  it("rejects non-https Slack/Discord URLs even when http is allowed", async () => {
    const loose = { allowPrivate: true, allowHttp: true };
    expect(
      await validateDestinationUrl("slack", "http://hooks.slack.com/services/a", loose, resolvePublic),
    ).not.toBeNull();
  });

  it("accepts a public https webhook URL", async () => {
    expect(
      await validateDestinationUrl("webhook", "https://hooks.zapier.com/x", strict, resolvePublic),
    ).toBeNull();
  });

  it("rejects http webhook URLs unless http is allowed", async () => {
    expect(await validateDestinationUrl("webhook", "http://example.com/x", strict, resolvePublic)).toContain("https");
    expect(
      await validateDestinationUrl("webhook", "http://example.com/x", { ...strict, allowHttp: true }, resolvePublic),
    ).toBeNull();
  });

  it("rejects webhook hosts that resolve to private addresses", async () => {
    expect(
      await validateDestinationUrl("webhook", "https://internal.example/x", strict, resolvePrivate),
    ).toContain("private");
  });

  it("skips the private-address check when private URLs are allowed", async () => {
    expect(
      await validateDestinationUrl(
        "webhook", "http://127.0.0.1:9000/hook", { allowPrivate: true, allowHttp: true }, resolvePrivate,
      ),
    ).toBeNull();
  });

  it("rejects URLs with credentials and malformed URLs", async () => {
    expect(await validateDestinationUrl("webhook", "https://u:p@example.com/x", strict, resolvePublic)).not.toBeNull();
    expect(await validateDestinationUrl("webhook", "not a url", strict, resolvePublic)).toBe("Enter a valid URL");
  });
});
