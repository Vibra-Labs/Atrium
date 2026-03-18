export const documentStatusColors: Record<string, { bg: string; text: string }> = {
  draft: { bg: "#f3f4f6", text: "#6b7280" },
  pending: { bg: "#fef3c7", text: "#92400e" },
  accepted: { bg: "#dcfce7", text: "#15803d" },
  declined: { bg: "#fee2e2", text: "#b91c1c" },
  acknowledged: { bg: "#dbeafe", text: "#1d4ed8" },
  signed: { bg: "#ccfbf1", text: "#0f766e" },
  voided: { bg: "#fce7f3", text: "#9d174d" },
  expired: { bg: "#f3f4f6", text: "#9ca3af" },
};
