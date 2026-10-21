import type { OrgMember } from "../types/authenticated-request";

/** The Member columns `req.member` carries (OrgMember); not digest flags, lastSeenAt, etc. */
export const ORG_MEMBER_FIELDS = {
  id: true, organizationId: true, userId: true, role: true, createdAt: true,
} as const satisfies Record<keyof OrgMember, true>;
