import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StageTracker } from "./stage-tracker";

const steps = [
  { key: "found", label: "Lead" },
  { key: "proposal_sent", label: "Proposal sent" },
  { key: "waiting", label: "Waiting on decision" },
];

/** Each step's data-state, in order. */
function states(html: string): string[] {
  return [...html.matchAll(/data-testid="step" data-state="(\w+)"/g)].map((m) => m[1]);
}

describe("StageTracker", () => {
  it("marks earlier steps done, the current one current, and later ones upcoming", () => {
    const html: string = renderToStaticMarkup(
      <StageTracker steps={steps} currentKey="proposal_sent" onSelect={() => {}} stepTestId="step" />,
    );
    expect(states(html)).toEqual(["done", "current", "upcoming"]);
    expect(html).toContain('aria-pressed="true"');
  });

  it("keeps the step number out of the label text", () => {
    const html: string = renderToStaticMarkup(
      <StageTracker steps={steps} currentKey="found" onSelect={() => {}} stepTestId="step" />,
    );
    expect(html).toContain('data-n="2"');
    expect(html).not.toMatch(/>2</);
  });

  it("puts the end step after the last stage", () => {
    const html: string = renderToStaticMarkup(
      <StageTracker steps={steps} end={<span>Won</span>} />,
    );
    expect(html.indexOf("Waiting on decision")).toBeLessThan(html.indexOf("Won"));
  });

  it("without onSelect, shows plain steps with their own label and actions", () => {
    const html: string = renderToStaticMarkup(
      <StageTracker
        steps={steps}
        stepTestId="step"
        labelFor={(s) => <em>{s.label}</em>}
        actionsFor={(s) => <i data-actions={s.key} />}
      />,
    );
    expect(html).not.toContain("<button");
    expect(html).toContain("<em>Proposal sent</em>");
    expect(html).toContain('data-actions="waiting"');
  });
});
