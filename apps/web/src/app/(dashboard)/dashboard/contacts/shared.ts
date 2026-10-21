export const STATUS_LABELS: Record<string, string> = {
  lead: "Lead",
  client: "Client",
  past_client: "Past client",
};

export const REPEAT_LABELS: Record<number, string> = {
  14: "2 wk",
  30: "1 mo",
  90: "3 mo",
  180: "6 mo",
  365: "1 yr",
};

export const NEW_SOURCE = "__new__";

export const RATING_LABELS: Record<string, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
};

export const PHONE_LABELS = ["Mobile", "Work", "Home", "Other"];

export interface ContactPhone {
  label: string;
  number: string;
}

export const labelClass = "block text-sm text-[var(--muted-foreground)] mb-1";

export const inputClass =
  "w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]";
