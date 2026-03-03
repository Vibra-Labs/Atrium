import { Request } from "express";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
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

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  session: AuthSession;
  organization: FullOrganization;
  member: OrgMember;
}
