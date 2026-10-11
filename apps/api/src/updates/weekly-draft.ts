export interface WeeklyDraftInput {
  projectName: string;
  completedTasks: string[];
  newFiles: string[];
  upcomingTasks: string[];
}

const MAX_ITEMS = 8;

function section(heading: string, items: string[]): string[] {
  if (items.length === 0) return [];
  const shown: string[] = items.slice(0, MAX_ITEMS).map((item) => `- ${item}`);
  if (items.length > MAX_ITEMS) shown.push(`- and ${items.length - MAX_ITEMS} more`);
  return ["", `${heading}:`, ...shown];
}

/** Plain-text client update the owner reviews and edits before posting. */
export function buildWeeklyDraft(input: WeeklyDraftInput): string {
  const body: string[] = [
    ...section("Done this week", input.completedTasks),
    ...section("New files", input.newFiles),
    ...section("Up next", input.upcomingTasks),
  ];
  if (input.completedTasks.length === 0 && input.newFiles.length === 0) {
    body.unshift("", "[What moved forward this week?]");
  }
  return [`Here's where ${input.projectName} stands this week.`, ...body].join("\n");
}
