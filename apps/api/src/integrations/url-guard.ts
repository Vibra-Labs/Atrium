import type { IntegrationType } from "@atrium/shared";
import { assertHostnameIsPublic } from "../embeds/safe-fetch";

export interface UrlPolicy {
  /** Self-hosters may point webhooks at their LAN (`INTEGRATIONS_ALLOW_PRIVATE_URLS=true`). */
  allowPrivate: boolean;
  /** Plain http is allowed outside production, or when private URLs are allowed. */
  allowHttp: boolean;
}

type HostCheck = (hostname: string) => Promise<void>;

const SLACK_HOSTS: ReadonlySet<string> = new Set(["hooks.slack.com"]);
const DISCORD_HOSTS: ReadonlySet<string> = new Set([
  "discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com",
]);

/**
 * Returns a user-facing error, or null when the URL may receive deliveries.
 * Called on save and again before every send, since DNS can change underneath us.
 */
export async function validateDestinationUrl(
  type: IntegrationType,
  raw: string,
  policy: UrlPolicy,
  checkHost: HostCheck = assertHostnameIsPublic,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a valid URL";
  }
  if (url.username || url.password) return "URLs with embedded credentials are not allowed";

  if (type === "slack") {
    if (url.protocol !== "https:" || !SLACK_HOSTS.has(url.hostname)) {
      return "Slack webhook URLs start with https://hooks.slack.com/";
    }
    return null;
  }

  if (type === "discord") {
    if (url.protocol !== "https:" || !DISCORD_HOSTS.has(url.hostname) || !url.pathname.startsWith("/api/webhooks/")) {
      return "Discord webhook URLs start with https://discord.com/api/webhooks/";
    }
    return null;
  }

  if (url.protocol !== "https:" && !(policy.allowHttp && url.protocol === "http:")) {
    return "Webhook URLs must use https";
  }
  if (policy.allowPrivate) return null;
  try {
    // URL keeps brackets around IPv6 literals; the resolver wants them bare.
    await checkHost(url.hostname.replace(/^\[|\]$/g, ""));
  } catch (err) {
    const reason: string = err instanceof Error ? err.message : String(err);
    return `This URL points to a private network address and can't receive webhooks (${reason})`;
  }
  return null;
}
