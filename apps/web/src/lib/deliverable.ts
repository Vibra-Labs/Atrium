import { apiFetch } from "@/lib/api";
import { track } from "@/lib/track";

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

export interface DeliverableInput {
  projectId: string;
  title: string;
  note: string;
  reminderEnabled: boolean;
  file?: File;
  url?: string;
}

export async function sendDeliverable(input: DeliverableInput): Promise<void> {
  const note: string = input.note.trim();
  if (input.file) {
    const form = new FormData();
    form.append("file", input.file);
    form.append("projectId", input.projectId);
    form.append("type", "deliverable");
    form.append("title", input.title.trim());
    if (note) form.append("note", note);
    form.append("reminderEnabled", String(input.reminderEnabled));
    form.append("sendNow", "true");
    await apiFetch("/documents", { method: "POST", body: form });
  } else {
    await apiFetch("/documents/link", {
      method: "POST",
      body: JSON.stringify({
        projectId: input.projectId,
        title: input.title.trim(),
        url: input.url?.trim(),
        note: note || undefined,
        reminderEnabled: input.reminderEnabled,
        sendNow: true,
      }),
    });
  }
  track("deliverable_sent", { mode: input.file ? "file" : "link" });
}
