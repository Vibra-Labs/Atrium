import type { Request } from "express";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled?: boolean | null;
  /** Set by SessionMiddleware: the user has at least one passkey. */
  hasPasskey?: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthSession {
  id: string;
  expiresAt: Date;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
  activeOrganizationId: string | null;
  /** Which second factor this session passed: "totp", "backup_code", "trusted_device", or null. */
  secondFactor?: string | null;
  /** When this session's passkey ceremony happened, if it came from a passkey sign-in. */
  passkeyVerifiedAt?: Date | string | null;
}

export interface OrgMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
}

export interface FullOrganization {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: string | null;
  members?: OrgMember[];
}

/** How a bearer-authenticated request proved its identity. */
export type BearerKind = "apiKey" | "oauth";

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  session: AuthSession;
  organization: FullOrganization;
  member: OrgMember;
  previewMode?: boolean;
  apiKeyId?: string;
  /**
   * Set only when SessionMiddleware derived this request's identity from an
   * `Authorization: Bearer` token. Absent for cookie sessions, which is how
   * `/api/mcp` — public and CSRF-exempt — tells the two apart.
   */
  bearerKind?: BearerKind;
  /** Set when SessionMiddleware refused to look up a bearer key: too many failures from this IP. */
  authRateLimited?: boolean;
  /** The active workspace's "Require 2FA for staff" setting, set by SessionMiddleware for cookie sessions. */
  workspaceRequiresTwoFactor?: boolean;
  /** Auth routes only: staff of any workspace that requires 2FA. Set only when the user has no factor. */
  staffInRequiringWorkspace?: boolean;
  /** Auth routes only: a session cookie was sent but could not be resolved. */
  sessionLookupFailed?: boolean;
}

/** The identity a request or MCP tool call acts as. */
export interface Actor {
  user: AuthUser;
  organization: FullOrganization;
  member: OrgMember;
}
