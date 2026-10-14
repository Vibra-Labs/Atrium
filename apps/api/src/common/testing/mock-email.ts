import { mock } from "bun:test";

/**
 * Stand-ins for the React Email templates and renderer.
 *
 * Bun's `mock.module` is process-wide: once any spec registers one, every spec
 * that loads afterwards sees it, and on Linux the file order is not alphabetical.
 * So every spec whose code renders an email must import this module, and they all
 * register the same mock, so the outcome does not depend on which file ran first.
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
