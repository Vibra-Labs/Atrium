/** Elements inside a clickable row that keep their own click behaviour. */
export const ROW_INTERACTIVE_SELECTOR: string =
  "a, button, input, select, textarea, label, [role='button'], [data-row-ignore]";

export interface RowClickInfo {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  insideInteractive: boolean;
  hasSelection: boolean;
}

export type RowClickAction = "ignore" | "navigate" | "new-tab";

/**
 * What a click on a table row should do. The row's primary cell holds a real
 * link (for keyboard and screen-reader users); this makes the rest of the row
 * behave like that link without stealing clicks from inner controls.
 */
export function rowClickAction(info: RowClickInfo): RowClickAction {
  if (info.insideInteractive || info.hasSelection) return "ignore";
  if (info.button === 1) return "new-tab";
  if (info.button !== 0) return "ignore";
  if (info.metaKey || info.ctrlKey || info.shiftKey) return "new-tab";
  return "navigate";
}
