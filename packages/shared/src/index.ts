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
  accentColor: "#ff6b5c",
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
