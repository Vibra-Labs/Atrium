import { Logger } from "@nestjs/common";
import { isLoopbackHost } from "./mcp-oauth";

type ConfigLike = { get: (key: string) => string | undefined };

const DEFAULT_WEB_URL: string = "http://localhost:3000";

function webUrl(config: ConfigLike): string {
  return config.get("WEB_URL") || DEFAULT_WEB_URL;
}

/**
 * Why passkeys are off, or null when they are on. WebAuthn needs a secure
 * origin (https, or localhost), and the Firebase Hosting workaround keeps only
 * the session cookie, which drops the passkey challenge cookie.
 */
export function passkeyUnavailableReason(config: ConfigLike): string | null {
  if (config.get("FIREBASE_HOSTING") === "true") return "FIREBASE_HOSTING keeps only the session cookie";
  let url: URL;
  try {
    url = new URL(webUrl(config));
  } catch (err) {
    Logger.warn(`WEB_URL is not a valid URL: ${err instanceof Error ? err.message : String(err)}`, "Passkeys");
    return "WEB_URL is not a valid URL";
  }
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname))) return null;
  return "they need an https:// WEB_URL";
}

export function passkeysEnabled(config: ConfigLike): boolean {
  return passkeyUnavailableReason(config) === null;
}

/**
 * Passkeys belong to the main web address only, never the API host or an
 * agency's custom portal domain.
 */
export function passkeyRelyingParty(config: ConfigLike): { rpID: string; origin: string } {
  const url: URL = new URL(webUrl(config));
  return { rpID: url.hostname, origin: url.origin };
}
