import { ROLES } from "@atrium/shared";

/**
 * Owners and admins can open any project through the portal ("/mine")
 * endpoints, e.g. to preview a project with no client yet. During a preview
 * as a client, PreviewModeMiddleware swaps the role to the client's, so this
 * returns false and the client's own access rules apply.
 */
export function isPrivilegedRole(role: string | undefined): boolean {
  return role === ROLES.OWNER || role === ROLES.ADMIN;
}
