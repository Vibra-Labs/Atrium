/** How Atrium secures the connection to an SMTP server. */
export const SMTP_SECURITY = {
  TLS: "tls",
  STARTTLS: "starttls",
  NONE: "none",
} as const;

export type SmtpSecurity = (typeof SMTP_SECURITY)[keyof typeof SMTP_SECURITY];

export const SMTP_SECURITY_VALUES: SmtpSecurity[] = Object.values(SMTP_SECURITY);

/** The port each mode normally uses; shown when no port is set. */
export const SMTP_DEFAULT_PORTS: Record<SmtpSecurity, number> = {
  tls: 465,
  starttls: 587,
  none: 25,
};

export const PROJECT_STATUSES = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  IN_REVIEW: "in_review",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

export type ProjectStatusValue =
  (typeof PROJECT_STATUSES)[keyof typeof PROJECT_STATUSES];

export const DEFAULT_STATUSES = [
  { name: "Not Started", slug: "not_started", order: 0, color: "#6b7280" },
  { name: "In Progress", slug: "in_progress", order: 1, color: "#3b82f6" },
  { name: "In Review", slug: "in_review", order: 2, color: "#f59e0b" },
  { name: "Completed", slug: "completed", order: 3, color: "#10b981" },
  { name: "Cancelled", slug: "cancelled", order: 4, color: "#ef4444" },
];

export const DEFAULT_BRANDING = {
  primaryColor: "#006b68",
};

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export const ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const DELETED_USER_SENTINEL = "deleted";

export const TASK_STATUSES = {
  OPEN: "open",
  IN_PROGRESS: "in_progress",
  DONE: "done",
  CANCELLED: "cancelled",
} as const;

export type TaskStatusValue =
  (typeof TASK_STATUSES)[keyof typeof TASK_STATUSES];

export const TASK_STATUS_VALUES = Object.values(TASK_STATUSES);

export const TASK_TYPES = {
  CHECKBOX: "checkbox",
  DECISION: "decision",
} as const;

export type TaskTypeValue = (typeof TASK_TYPES)[keyof typeof TASK_TYPES];

export const DEFAULT_LABEL_COLOR = "#6b7280";

export const DEFAULT_LEAD_SOURCES: string[] = ["Referral", "Website", "Event", "Social"];

export const CONTACT_STATUSES = ["lead", "client", "past_client"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_RATINGS = ["hot", "warm", "cold"] as const;
export type ContactRating = (typeof CONTACT_RATINGS)[number];

// A type alias (not an interface) so it is assignable to Prisma's Json input.
export type ContactPhone = {
  label: string;
  number: string;
};

export const FOLLOW_UP_REPEAT_DAYS: readonly number[] = [14, 30, 90, 180, 365];
export const FOLLOW_UP_SNOOZE_DAYS: readonly number[] = [1, 3, 7];

export const CALENDAR_EVENT_TYPES = [
  "task",
  "project_start",
  "project_end",
  "invoice_due",
] as const;

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export type CalendarEvent =
  | {
      type: "task";
      id: string;
      date: string;
      title: string;
      status: string;
      projectId: string;
      projectName: string;
      assigneeId: string | null;
      assigneeName: string | null;
    }
  | {
      type: "project_start" | "project_end";
      id: string;
      date: string;
      title: string;
      projectId: string;
      projectName: string;
    }
  | {
      type: "invoice_due";
      id: string;
      date: string;
      title: string;
      status: string;
      projectId: string | null;
      projectName: string | null;
      amountCents: number;
    };

export interface OwnedOrg {
  id: string;
  name: string;
  isSoleOwner: boolean;
  memberCount: number;
}

export interface DeletionInfo {
  ownedOrganizations: OwnedOrg[];
}

/** Features reserved for paid plans on hosted Atrium. Self-hosted installs (billing off) get all of them. */
export const PLAN_FEATURES = [
  "custom_domain",
  "e_signatures",
  "integrations",
  "online_payments",
  "white_label",
] as const;

export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  custom_domain: "Custom domains",
  e_signatures: "E-signatures",
  integrations: "Integrations",
  online_payments: "Online invoice payments",
  white_label: "White-label portals",
};

// ─── Integrations ───

export const INTEGRATION_TYPES = ["slack", "discord", "webhook"] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

/** Events a destination can subscribe to, grouped for the settings picker. */
export const INTEGRATION_EVENT_GROUPS = [
  {
    label: "Projects",
    events: [
      { id: "project.update_posted", label: "Update posted" },
      { id: "comment.created", label: "Comment added" },
    ],
  },
  {
    label: "Tasks",
    events: [
      { id: "task.created", label: "Task created" },
      { id: "task.status_changed", label: "Task status changed" },
      { id: "task.assigned", label: "Task assigned" },
      { id: "client_request.created", label: "Client request submitted" },
      { id: "decision.closed", label: "Decision closed" },
    ],
  },
  {
    label: "Documents",
    events: [
      { id: "document.uploaded", label: "Document shared" },
      { id: "document.responded", label: "Client responded (approved, rejected, signed)" },
      { id: "document.signing_turn", label: "Next signer's turn" },
      { id: "document.reminder_sent", label: "Reminder sent" },
    ],
  },
  {
    label: "Invoices",
    events: [
      { id: "invoice.sent", label: "Invoice sent" },
      { id: "invoice.paid", label: "Invoice paid" },
    ],
  },
  {
    label: "Workspace",
    events: [{ id: "payments.stripe_disconnected", label: "Stripe disconnected" }],
  },
] as const;

export type IntegrationEvent =
  (typeof INTEGRATION_EVENT_GROUPS)[number]["events"][number]["id"];

export const INTEGRATION_EVENTS: readonly IntegrationEvent[] = INTEGRATION_EVENT_GROUPS.flatMap(
  (g) => g.events.map((e) => e.id),
);

// ── Contact mentions in notes ─────────────────────────────────────────────────
// A note stores "@[Ann Lee](contact:<id>)"; the app shows it as a link to that contact.

const MENTION_PATTERN = /@\[([^\]\n]{1,200})\]\(contact:([A-Za-z0-9_-]{1,64})\)/g;

export interface NoteMention {
  name: string;
  contactId: string;
}

export type NotePart = { text: string } | { mention: NoteMention };

export function mentionToken(name: string, contactId: string): string {
  const safe = name.replace(/\[/g, "(").replace(/\]/g, ")").replace(/\s+/g, " ").trim();
  return `@[${safe}](contact:${contactId})`;
}

export function splitMentions(content: string): NotePart[] {
  const parts: NotePart[] = [];
  let last = 0;
  for (const m of content.matchAll(MENTION_PATTERN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: content.slice(last, at) });
    parts.push({ mention: { name: m[1], contactId: m[2] } });
    last = at + m[0].length;
  }
  if (last < content.length || parts.length === 0) parts.push({ text: content.slice(last) });
  return parts;
}

/** Each mentioned contact id once, in order of first mention. */
export function mentionedContactIds(content: string): string[] {
  return [...new Set([...content.matchAll(MENTION_PATTERN)].map((m) => m[2]))];
}

/** The note with every mention as a plain "@Name". */
export function mentionsAsText(content: string): string {
  return content.replace(MENTION_PATTERN, (_, name: string) => `@${name}`);
}

/** Replaces mentions of contacts not in `keep` with their plain "@Name". */
export function keepMentions(content: string, keep: ReadonlySet<string>): string {
  return content.replace(MENTION_PATTERN, (token: string, name: string, id: string) =>
    keep.has(id) ? token : `@${name}`,
  );
}

/** Currency used when STRIPE_CURRENCY is unset. */
export const DEFAULT_CURRENCY = "usd";

/** Formats an amount in minor units (cents) as a localized currency string. */
export function formatMoney(cents: number, currency: string = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
