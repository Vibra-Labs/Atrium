// Shared rules for a workspace's named, ordered lists (project statuses, pursuit stages and pipelines).

import { BadRequestException, ConflictException } from "@nestjs/common";
import { isPrismaUniqueViolation } from "../common/helpers/prisma-errors";

/** "Client review!" → "client_review"; adds _2, _3… when taken. Names with no a–z/0–9 use `fallback`. */
export function uniqueSlug(name: string, taken: string[], fallback: string): string {
  const base: string = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
  let slug: string = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}_${n}`;
  return slug;
}

/** Names are unique per list, ignoring case. */
export function assertFreeName(rows: { id: string; name: string }[], name: string, message: string, exceptId?: string): void {
  const lower: string = name.toLowerCase();
  if (rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === lower)) throw new ConflictException(message);
}

/** Exactly these ids, once each, or 400. */
export function assertSameSet(ids: string[], rows: { id: string }[], message: string): void {
  const set: Set<string> = new Set(ids);
  if (ids.length !== rows.length || set.size !== rows.length || rows.some((r) => !set.has(r.id))) {
    throw new BadRequestException(message);
  }
}

/** Turns a unique-constraint violation into a 409 with `message`. */
export async function unique<T>(write: () => Promise<T>, message: string): Promise<T> {
  try {
    return await write();
  } catch (err: unknown) {
    if (isPrismaUniqueViolation(err)) throw new ConflictException(message);
    throw err;
  }
}
