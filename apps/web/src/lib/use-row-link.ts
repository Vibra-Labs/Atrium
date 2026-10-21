"use client";

import { useRouter } from "next/navigation";
import { ROW_INTERACTIVE_SELECTOR, rowClickAction } from "./row-link";

export interface RowLinkProps {
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
  onAuxClick: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Handlers that make a whole row open `href`, like the link in its first cell.
 * The row should also be styled `cursor-pointer` with a hover background.
 */
export function useRowLink(): (href: string) => RowLinkProps {
  const router = useRouter();
  return (href: string): RowLinkProps => {
    const handle = (e: React.MouseEvent<HTMLElement>): void => {
      const target = e.target as Element;
      const action = rowClickAction({
        button: e.button,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        insideInteractive: target.closest(ROW_INTERACTIVE_SELECTOR) !== null,
        hasSelection: (window.getSelection()?.toString() ?? "") !== "",
      });
      if (action === "navigate") router.push(href);
      if (action === "new-tab") window.open(href, "_blank", "noopener");
    };
    return { onClick: handle, onAuxClick: handle };
  };
}
