export const PROJECT_STATUSES = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  IN_REVIEW: "in_review",
  COMPLETED: "completed",
} as const;

export type ProjectStatusValue =
  (typeof PROJECT_STATUSES)[keyof typeof PROJECT_STATUSES];

export const DEFAULT_STATUSES = [
  { name: "Not Started", slug: "not_started", order: 0, color: "#6b7280" },
  { name: "In Progress", slug: "in_progress", order: 1, color: "#3b82f6" },
  { name: "In Review", slug: "in_review", order: 2, color: "#f59e0b" },
  { name: "Completed", slug: "completed", order: 3, color: "#10b981" },
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
