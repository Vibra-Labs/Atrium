import { BadRequestException } from "@nestjs/common";
import { CONTACT_RATINGS } from "@atrium/shared";
import type { ContactPhone, ContactRating } from "@atrium/shared";

/** First and last name each; joined with a space they stay within the 200-char name. */
export const NAME_PART_MAX = 99;
export const MAX_PHONES = 10;
export const PHONE_LABEL_MAX = 30;
export const PHONE_NUMBER_MAX = 50;
export const MAX_SOCIAL_LINKS = 10;
/** Cheap DTO guard before each entry is parsed; duplicates may bring it down to 10. */
export const MAX_SOCIAL_LINKS_INPUT = 50;
export const SOCIAL_LINK_MAX = 500;
export const LEGACY_PHONE_LABEL = "Phone";
const NAME_REQUIRED = "Name is required";

export interface ContactNames {
  name: string;
  firstName: string | null;
  lastName: string | null;
}

interface NameInput {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

interface PhoneInput {
  phone?: string | null;
  phones?: ContactPhone[] | null;
}

/** First whitespace token is the first name, the rest the last name. */
export function splitName(raw: string): { firstName: string | null; lastName: string | null } {
  const [first, ...rest] = raw.trim().split(/\s+/).filter(Boolean);
  return { firstName: first ?? null, lastName: rest.length ? rest.join(" ") : null };
}

function joinName(first: string, last: string | null): string {
  return `${first} ${last ?? ""}`.trim();
}

function fromName(raw: string): ContactNames {
  const name = raw.trim();
  if (!name) throw new BadRequestException(NAME_REQUIRED);
  return { name, ...splitName(name) };
}

/** Names for a new contact: first (+ last) builds the name; a name alone is split. */
export function createNames(dto: NameInput): ContactNames {
  const first = dto.firstName?.trim();
  if (first) {
    const last = dto.lastName?.trim() || null;
    return { name: joinName(first, last), firstName: first, lastName: last };
  }
  return fromName(dto.name ?? "");
}

/**
 * Name changes for an update. First/last are merged with what is stored and rebuild the name;
 * a name alone is re-split. The last name can be cleared, the first name cannot.
 */
export function updateNames(dto: NameInput, stored: ContactNames): Partial<ContactNames> {
  if (dto.firstName !== undefined || dto.lastName !== undefined) {
    const current = stored.firstName == null ? splitName(stored.name) : stored;
    const first = (dto.firstName === undefined ? current.firstName : dto.firstName)?.trim();
    if (!first) throw new BadRequestException(NAME_REQUIRED);
    const last = dto.lastName === undefined ? current.lastName : dto.lastName?.trim() || null;
    return { name: joinName(first, last), firstName: first, lastName: last };
  }
  if (dto.name !== undefined) return fromName(dto.name ?? "");
  return {};
}

/** Reads the stored phones Json defensively. */
export function readPhones(value: unknown): ContactPhone[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is ContactPhone =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as ContactPhone).label === "string" &&
      typeof (p as ContactPhone).number === "string",
  );
}

function normalizePhones(phones: ContactPhone[]): ContactPhone[] {
  if (phones.length > MAX_PHONES) {
    throw new BadRequestException(`At most ${MAX_PHONES} phone numbers`);
  }
  return phones.map((p) => {
    const label = String(p.label ?? "").trim();
    const number = String(p.number ?? "").trim();
    if (!label || label.length > PHONE_LABEL_MAX) {
      throw new BadRequestException(`Phone labels must be 1-${PHONE_LABEL_MAX} characters`);
    }
    if (!number || number.length > PHONE_NUMBER_MAX) {
      throw new BadRequestException(`Phone numbers must be 1-${PHONE_NUMBER_MAX} characters`);
    }
    return { label, number };
  });
}

/**
 * Phones to write, with `phone` kept as a mirror of the first number. `phones` wins over the
 * legacy `phone` input, which replaces (or, blank, removes) the first number. {} = leave alone.
 */
export function resolvePhones(
  dto: PhoneInput,
  stored: ContactPhone[],
): { phones?: ContactPhone[]; phone?: string | null } {
  let phones: ContactPhone[];
  if (dto.phones !== undefined) {
    phones = normalizePhones(dto.phones ?? []);
  } else if (dto.phone !== undefined) {
    const number = dto.phone?.trim() ?? "";
    if (!number) phones = stored.slice(1);
    else if (stored.length === 0) phones = [{ label: LEGACY_PHONE_LABEL, number }];
    else phones = [{ ...stored[0], number }, ...stored.slice(1)];
  } else {
    return {};
  }
  return { phones, phone: phones[0]?.number ?? null };
}

const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const HANDLE = /^@?([a-z\d_]{1,15})$/i;

/**
 * One social link as typed: trimmed; a bare domain ("linkedin.com/in/x") gets https:// in front.
 * Returns null unless the result is an http(s) URL of at most 500 chars (a bare value must
 * also have a dotted host, so a stray word isn't taken for a site).
 */
export function normalizeSocialLink(raw: string): string | null {
  const value = String(raw).trim();
  if (!value) return null;
  const bare = !HAS_SCHEME.test(value);
  const link = bare ? `https://${value}` : value;
  if (link.length > SOCIAL_LINK_MAX) return null;
  try {
    const url = new URL(link);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (bare && !url.hostname.includes(".")) return null;
  } catch {
    return null;
  }
  return link;
}

/** Trims, drops blanks, de-duplicates; every link must be (or become) an http(s) URL. */
export function normalizeSocialLinks(links: string[] | null): string[] {
  const out: string[] = [];
  for (const raw of links ?? []) {
    if (!String(raw).trim()) continue;
    const link = normalizeSocialLink(raw);
    if (!link) throw new BadRequestException("Social links must be http(s) URLs");
    if (!out.includes(link)) out.push(link);
  }
  if (out.length > MAX_SOCIAL_LINKS) {
    throw new BadRequestException(`At most ${MAX_SOCIAL_LINKS} social links`);
  }
  return out;
}

/**
 * Social links from a CSV row, never rejecting the row: `cells` are the values of every column
 * mapped to social links, with their headers. A handle (@acme or acme) under a Twitter / X
 * header becomes https://x.com/acme; values that still aren't http(s) URLs are returned in
 * `dropped`. Keeps at most 10.
 */
export function importSocialLinks(cells: { header: string; value: string }[]): {
  links: string[];
  dropped: string[];
} {
  const links: string[] = [];
  const dropped: string[] = [];
  for (const { header, value } of cells) {
    const isX = /twitter|^\s*x\s*$/i.test(header);
    for (const token of value.split(/[\s,;]+/).filter(Boolean)) {
      const handle = isX ? HANDLE.exec(token) : null;
      const link = handle ? `https://x.com/${handle[1]}` : normalizeSocialLink(token);
      if (!link) dropped.push(token);
      else if (!links.includes(link)) links.push(link);
    }
  }
  return { links: links.slice(0, MAX_SOCIAL_LINKS), dropped };
}

/** Stored phones, or the legacy phone as one "Phone" entry for a row the backfill hasn't reached. */
export function phonesOf(phones: unknown, phone: string | null | undefined): ContactPhone[] {
  const list = readPhones(phones);
  const legacy = phone?.trim();
  return list.length === 0 && legacy ? [{ label: LEGACY_PHONE_LABEL, number: legacy }] : list;
}

/** CSV rating: blank = undefined, unknown = null, else the lowercase rating. */
export function parseRating(value: string): ContactRating | null | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  return (CONTACT_RATINGS as readonly string[]).includes(v) ? (v as ContactRating) : null;
}

/** undefined = leave alone; null or blank = clear; else trimmed. */
export function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}
