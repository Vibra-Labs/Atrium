import { Sparkles } from "lucide-react";

export function ProBadge({ title }: { title?: string }): React.ReactElement {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 text-[10px] font-semibold tracking-wide"
    >
      <Sparkles size={9} />
      PRO
    </span>
  );
}

export function UpgradeLink({ reason }: { reason: string }): React.ReactElement {
  return (
    <a
      href={`/dashboard/settings/account?reason=${encodeURIComponent(reason)}#billing`}
      className="text-sm font-medium text-[var(--primary)] hover:underline"
    >
      Upgrade to Pro
    </a>
  );
}

/** Shown next to a Pro feature during the trial, so people learn what they'd lose. */
export function TrialTag(): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]" data-testid="trial-tag">
      <ProBadge title="Included in your Pro trial" />
      Included in your Pro trial
    </span>
  );
}
