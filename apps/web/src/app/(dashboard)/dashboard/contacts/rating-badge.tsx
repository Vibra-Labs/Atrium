import { RATING_LABELS } from "./shared";

const RATING_CLASSES: Record<string, string> = {
  hot: "bg-red-500/15 text-red-700 dark:text-red-300",
  warm: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  cold: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

export function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return null;
  return (
    <span
      data-testid="contact-rating"
      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
        RATING_CLASSES[rating] ?? "bg-[var(--muted)]"
      }`}
    >
      {RATING_LABELS[rating] ?? rating}
    </span>
  );
}
