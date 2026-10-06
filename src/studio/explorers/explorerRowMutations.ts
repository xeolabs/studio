import {EXPLORER_ROW_SELECTOR} from "./explorerSelection";

/** Icon, text and field updates do not change the tree's row set. */
export function explorerRowsChanged(records: MutationRecord[]): boolean {
  const containsRow = (node: Node) => node instanceof Element &&
    (node.matches(EXPLORER_ROW_SELECTOR) || !!node.querySelector(EXPLORER_ROW_SELECTOR));
  return records.some(record => record.type === "childList" &&
    [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(containsRow));
}
