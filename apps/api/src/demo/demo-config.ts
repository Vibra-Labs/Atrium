import type { ConfigService } from "@nestjs/config";

/** The two accounts a visitor can enter the demo as. */
export type DemoKind = "owner" | "client";

/**
 * Demo accounts must live on this domain. Belt and braces: a mistyped
 * DEMO_OWNER_EMAIL pointing at a real administrator would otherwise let anyone
 * sign in as them without a password.
 */
export const DEMO_EMAIL_DOMAIN = "@demo.invalid";

/**
 * What the demo is configured as when only `DEMO_MODE=true` is set. These are
 * the values `bun run db:seed:demo` writes, so the one variable whose name says
 * "demo mode on" is the whole configuration. The overrides exist for an
 * operator running two demos off one database, which is nobody so far.
 */
export const DEMO_DEFAULT_ORG_SLUG = "demo";
export const DEMO_DEFAULT_OWNER_EMAIL = "owner@demo.invalid";
export const DEMO_DEFAULT_CLIENT_EMAIL = "client@demo.invalid";

export interface DemoSettings {
  enabled: boolean;
  orgSlug: string | null;
  ownerEmail: string | null;
  clientEmail: string | null;
}

/**
 * An explicitly configured demo address, or `fallback` when it is unset.
 *
 * Unset defaults; set and outside `@demo.invalid` throws. The asymmetry is the
 * point: silently returning null for a bad address produced a 404 identical to
 * demo mode being switched off, so a typo and a deliberate "off" were
 * indistinguishable from the outside and from the logs.
 */
function address(config: ConfigService, key: string, fallback: string): string {
  const value: string | undefined = config.get<string>(key);
  if (!value || value.trim().length === 0) return fallback;
  // Lowercased, because the seed stores addresses lowercased: returning the raw
  // value would sign in an address the seeded user does not have.
  const normalized: string = value.trim().toLowerCase();
  if (!normalized.endsWith(DEMO_EMAIL_DOMAIN)) {
    throw new Error(
      `${key} must end in ${DEMO_EMAIL_DOMAIN}, but is "${value}". Demo mode signs ` +
        `visitors in to this address with no password, so it must not be an address ` +
        `anyone really uses. Leave ${key} unset to use ${fallback}.`,
    );
  }
  return normalized;
}

/**
 * Reads demo mode from configuration. Shared by DemoService and AuthService so
 * the rules about which addresses may be signed in to anonymously have one
 * definition, without AuthService taking a new dependency.
 *
 * While demo mode is off every field is null and nothing is validated, so an
 * ordinary install boots with a leftover DEMO_* variable in its environment.
 */
export function demoSettings(config: ConfigService): DemoSettings {
  const enabled: boolean = config.get("DEMO_MODE") === "true";
  if (!enabled) {
    return { enabled: false, orgSlug: null, ownerEmail: null, clientEmail: null };
  }
  const slug: string | undefined = config.get<string>("DEMO_ORG_SLUG");
  return {
    enabled: true,
    orgSlug: slug && slug.trim().length > 0 ? slug.trim() : DEMO_DEFAULT_ORG_SLUG,
    ownerEmail: address(config, "DEMO_OWNER_EMAIL", DEMO_DEFAULT_OWNER_EMAIL),
    clientEmail: address(config, "DEMO_CLIENT_EMAIL", DEMO_DEFAULT_CLIENT_EMAIL),
  };
}

export function demoAddressFor(settings: DemoSettings, kind: DemoKind): string | null {
  return kind === "owner" ? settings.ownerEmail : settings.clientEmail;
}
