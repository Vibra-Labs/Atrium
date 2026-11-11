"use client";

import { Fragment } from "react";
import { Check } from "lucide-react";

export interface TrackerStep {
  key: string;
  label: string;
}

type StepState = "done" | "current" | "upcoming" | "selected" | "idle";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]";

const circle: Record<StepState, string> = {
  done: "bg-amber-500 border-amber-500 text-white",
  current: "bg-amber-500 border-amber-500 text-white ring-4 ring-amber-500/25",
  upcoming: "bg-[var(--background)] border-[var(--border)] text-[var(--muted-foreground)]",
  selected: "bg-[var(--primary)] border-[var(--primary)] text-white",
  idle: "bg-[var(--background)] border-[var(--border)] text-[var(--foreground)]",
};

/** The line joining two steps; filled once the step before it is done. */
export function TrackerConnector({ filled }: { filled: boolean }): React.ReactElement {
  return (
    <span
      aria-hidden
      className={`shrink-0 w-0.5 h-4 ml-[13px] sm:ml-0 sm:h-0.5 sm:w-auto sm:flex-1 sm:min-w-4 sm:mt-[13px] ${
        filled ? "bg-amber-500" : "bg-[var(--border)]"
      }`}
    />
  );
}

/** A step's dot and label, laid out like the stages so extra steps (Won, +) line up. */
export function TrackerDot({
  dot,
  label,
  dotClassName = "",
}: {
  dot: React.ReactNode;
  label: React.ReactNode;
  dotClassName?: string;
}): React.ReactElement {
  return (
    <span className="flex sm:flex-col items-center gap-2 sm:gap-1.5 sm:w-24 shrink-0">
      <span
        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-semibold shrink-0 transition-all ${dotClassName}`}
      >
        {dot}
      </span>
      <span className="text-xs sm:text-center leading-tight">{label}</span>
    </span>
  );
}

/**
 * Stages as a tracker: numbered dots joined by a line. With `currentKey` it shows progress (a
 * contract); with `selectedKey` it highlights the step picked for editing (settings). Each step is
 * a button when `onSelect` is given, except `editingKey`, whose label `labelFor` can swap for an
 * input. `actionsFor` renders beside a step (e.g. its menu). Stacks vertically on narrow screens.
 */
export function StageTracker({
  steps,
  currentKey,
  selectedKey,
  editingKey,
  onSelect,
  stepTestId,
  disabled,
  labelFor,
  actionsFor,
  end,
}: {
  steps: TrackerStep[];
  currentKey?: string;
  selectedKey?: string | null;
  editingKey?: string | null;
  onSelect?: (key: string) => void;
  stepTestId?: string;
  disabled?: boolean;
  labelFor?: (step: TrackerStep) => React.ReactNode;
  actionsFor?: (step: TrackerStep) => React.ReactNode;
  /** A step after the last stage (e.g. Won), joined by the line. */
  end?: React.ReactNode;
}): React.ReactElement {
  const current: number = currentKey === undefined ? -1 : steps.findIndex((s) => s.key === currentKey);
  const stateOf = (i: number, key: string): StepState => {
    if (currentKey === undefined) return key === selectedKey ? "selected" : "idle";
    if (i < current) return "done";
    return i === current ? "current" : "upcoming";
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-start">
      {steps.map((s, i) => {
        const state: StepState = stateOf(i, s.key);
        const active: boolean = state === "current" || state === "selected";
        const clickable: boolean = !!onSelect && s.key !== editingKey;
        const content = (
          <>
            <span
              data-n={i + 1}
              className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-semibold shrink-0 transition-all ${
                clickable ? "group-hover:ring-2 group-hover:ring-amber-500/40" : ""
              } ${state === "done" ? "" : "before:content-[attr(data-n)]"} ${circle[state]}`}
            >
              {state === "done" && <Check size={14} strokeWidth={3} aria-hidden />}
            </span>
            <span
              className={`text-xs leading-tight break-words max-w-[12rem] sm:max-w-full ${
                active ? "font-semibold" : state === "upcoming" ? "text-[var(--muted-foreground)]" : ""
              }`}
            >
              {labelFor ? labelFor(s) : s.label}
            </span>
          </>
        );
        const layout = "flex sm:flex-col items-center gap-2 sm:gap-1.5 sm:w-28 text-left sm:text-center";
        return (
          <Fragment key={s.key}>
            {i > 0 && <TrackerConnector filled={i <= current} />}
            <div className="relative shrink-0">
              {clickable ? (
                <button
                  type="button"
                  data-testid={stepTestId}
                  data-state={state}
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => onSelect?.(s.key)}
                  className={`group rounded-lg disabled:cursor-not-allowed ${layout} ${focusRing}`}
                >
                  {content}
                </button>
              ) : (
                <div data-testid={stepTestId} data-state={state} className={layout}>
                  {content}
                </div>
              )}
              {actionsFor?.(s)}
            </div>
          </Fragment>
        );
      })}
      {end && (
        <>
          <TrackerConnector filled={false} />
          {end}
        </>
      )}
    </div>
  );
}
