import { mock } from "bun:test";

/**
 * Stand-ins for the React Email templates and renderer.
 *
 * Bun's `mock.module` is process-wide: once any spec registers one, every spec
 * that loads afterwards sees it, and on Linux the file order is not alphabetical.
 * Scheduled tasks therefore take an injected EmailRenderer (see fake-email-renderer.ts)
 * instead of relying on this. It remains for NotificationsService, whose spec reads the
 * props passed to `render`; the full template list keeps any leak harmless.
 *
 * Templates return their props, and `render` serialises them, so assertions can
 * still check that a name, date or URL made it into the email.
 */
const TEMPLATES: string[] = [
  "MagicLinkEmail",
  "WelcomeEmail",
  "InvitationEmail",
  "ResetPasswordEmail",
  "VerifyEmail",
  "ProjectUpdateEmail",
  "TaskAssignedEmail",
  "InvoiceSentEmail",
  "InvoicePaidEmail",
  "DecisionClosedEmail",
  "DocumentUploadedEmail",
  "DocumentRespondedEmail",
  "DocumentReminderEmail",
  "DocumentSigningTurnEmail",
  "TrialEndingEmail",
  "TrialEndedEmail",
  "WeeklyUpdateReminderEmail",
  "MondayDigestEmail",
];

const identity = (props: Record<string, unknown>): Record<string, unknown> => props;

mock.module("@atrium/email", () => Object.fromEntries(TEMPLATES.map((name) => [name, identity])));

mock.module("@react-email/render", () => ({
  render: mock(async (props: unknown): Promise<string> => JSON.stringify(props)),
}));
