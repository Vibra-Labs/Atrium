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

  it("highlights the selected step when editing, with no progress", () => {
    const html: string = renderToStaticMarkup(
      <StageTracker steps={steps} selectedKey="waiting" onSelect={() => {}} stepTestId="step" />,
    );
    expect(states(html)).toEqual(["idle", "idle", "selected"]);
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
      <StageTracker steps={steps} onSelect={() => {}} end={<span>Won</span>} />,
    );
    expect(html.indexOf("Waiting on decision")).toBeLessThan(html.indexOf("Won"));
  });
});
