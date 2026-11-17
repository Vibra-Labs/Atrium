import type { ConfigService } from "@nestjs/config";

/** The two accounts a visitor can enter the demo as. */
export type DemoKind = "owner" | "client";

/**
 * Demo accounts must live on this domain. Belt and braces: a mistyped
 * DEMO_OWNER_EMAIL pointing at a real administrator would otherwise let anyone
 * sign in as them without a password.
 */
export const DEMO_EMAIL_DOMAIN = "@demo.invalid";

export interface DemoSettings {
  enabled: boolean;
  orgSlug: string | null;
  ownerEmail: string | null;
  clientEmail: string | null;
}

function address(config: ConfigService, key: string): string | null {
  const value: string | undefined = config.get<string>(key);
  if (!value || value.length === 0) return null;
  // Lowercased, because the seed stores addresses lowercased: returning the raw
  // value would sign in an address the seeded user does not have.
  const normalized: string = value.trim().toLowerCase();
  return normalized.endsWith(DEMO_EMAIL_DOMAIN) ? normalized : null;
}

/**
 * Reads demo mode from configuration. Shared by DemoService and AuthService so
 * the rules about which addresses may be signed in to anonymously have one
 * definition, without AuthService taking a new dependency.
 */
export function demoSettings(config: ConfigService): DemoSettings {
  const enabled: boolean = config.get("DEMO_MODE") === "true";
  if (!enabled) {
    return { enabled: false, orgSlug: null, ownerEmail: null, clientEmail: null };
  }
  const slug: string | undefined = config.get<string>("DEMO_ORG_SLUG");
  return {
    enabled: true,
    orgSlug: slug && slug.length > 0 ? slug : null,
    ownerEmail: address(config, "DEMO_OWNER_EMAIL"),
    clientEmail: address(config, "DEMO_CLIENT_EMAIL"),
  };
}

export function demoAddressFor(settings: DemoSettings, kind: DemoKind): string | null {
  return kind === "owner" ? settings.ownerEmail : settings.clientEmail;
}
