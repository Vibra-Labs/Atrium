import { Injectable } from "@nestjs/common";
import type { AuthSession, AuthUser, BearerKind, FullOrganization, OrgMember } from "../common";

export interface CachedSession {
  user: AuthUser;
  session: AuthSession;
  organization?: FullOrganization;
  member?: OrgMember;
  /** The active workspace's "Require 2FA for staff" setting. */
  workspaceRequiresTwoFactor?: boolean;
  apiKeyId?: string;
  bearerKind?: BearerKind;
  expiresAt: number;
}

/** Above this many entries, set() sweeps out expired ones. */
const SOFT_CAP: number = 1000;

/**
 * Cookie sessions resolved by SessionMiddleware, keyed by the raw session
 * token. Injectable so a change to a user's security (2FA turned on, step-up,
 * reset) can drop their entries at once instead of waiting out the TTL.
 * Per process: other API instances catch up when their entry expires.
 */
@Injectable()
export class SessionCache {
  private entries = new Map<string, CachedSession>();

  get(token: string): CachedSession | undefined {
    const entry: CachedSession | undefined = this.entries.get(token);
    if (entry && entry.expiresAt <= Date.now()) {
      this.entries.delete(token);
      return undefined;
    }
    return entry;
  }

  set(token: string, entry: CachedSession): void {
    this.entries.set(token, entry);
    if (this.entries.size > SOFT_CAP) this.evictExpired();
  }

  delete(token: string): void {
    this.entries.delete(token);
  }

  deleteUser(userId: string): void {
    for (const [token, entry] of this.entries) {
      if (entry.user.id === userId) this.entries.delete(token);
    }
  }

  private evictExpired(): void {
    const now: number = Date.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt < now) this.entries.delete(token);
    }
  }
}
