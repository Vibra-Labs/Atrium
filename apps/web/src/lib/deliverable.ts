export interface DeliverableStatusStyle {
  label: string;
  bg: string;
  text: string;
}

const STYLES: Record<string, DeliverableStatusStyle> = {
  draft: { label: "Draft", bg: "#f3f4f6", text: "#374151" },
  pending: { label: "Awaiting review", bg: "#fef3c7", text: "#92400e" },
  declined: { label: "Changes requested", bg: "#fee2e2", text: "#b91c1c" },
  accepted: { label: "Approved", bg: "#dcfce7", text: "#15803d" },
  voided: { label: "Cancelled", bg: "#f3f4f6", text: "#6b7280" },
  expired: { label: "Expired", bg: "#f3f4f6", text: "#6b7280" },
};

export function deliverableStatus(status: string): DeliverableStatusStyle {
  return STYLES[status] ?? STYLES.pending;
}
