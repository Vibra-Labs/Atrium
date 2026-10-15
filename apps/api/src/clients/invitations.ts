import type { Invitation } from "@atrium/database";

/** How long an invitation link stays valid. */
export const INVITATION_EXPIRES_IN_SECONDS: number = 14 * 24 * 60 * 60;

/** Days after the latest send before an unanswered invite gets one reminder. */
export const REMINDER_AFTER_DAYS: number = 3;

/** "October 28", as shown in invitation emails. */
export function formatInvitationExpiry(expiresAt: Date): string {
  return expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export interface PresentedInvitation extends Invitation {
  inviteLink: string;
  expired: boolean;
}

/**
 * Shapes pending invitations for the Clients page.
 *
 * Better Auth leaves an expired invite as "pending" and ignores it when the same
 * email is invited again, so a re-invite adds a second row. An expired row is shown
 * (so the owner can resend it) only while it is the newest invite for that email.
 * Rows are expected newest first.
 */
export function presentInvitations(rows: Invitation[], webUrl: string, now: Date): PresentedInvitation[] {
  const seen = new Set<string>();
  const result: PresentedInvitation[] = [];
  for (const inv of rows) {
    const key: string = inv.email.toLowerCase();
    const expired: boolean = inv.expiresAt.getTime() <= now.getTime();
    const superseded: boolean = seen.has(key);
    seen.add(key);
    if (expired && superseded) continue;
    result.push({ ...inv, inviteLink: `${webUrl}/accept-invite?id=${inv.id}`, expired });
  }
  return result;
}
