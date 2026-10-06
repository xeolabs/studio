import {EXPLORER_ROW_SELECTOR} from "./explorerSelection";
import {scrollExplorerRowIntoView} from "./scrollExplorerRowIntoView";
import {explorerRowsChanged} from "./explorerRowMutations";

/** Keyboard navigation delegates expansion to the existing lazy-tree controls. */
export function installExplorerKeyboard(container: HTMLElement, initialNodeId = ""): () => void {
  let activeId = initialNodeId;
  let activeRow: HTMLElement | undefined;
  const rows = () => Array.from(container.querySelectorAll<HTMLElement>(EXPLORER_ROW_SELECTOR));
  const visibleRows = () => rows().filter((row) => row.getClientRects().length > 0);
  const expander = (row: HTMLElement) => row.querySelector<HTMLButtonElement>('button[aria-label="Expand"], button[aria-label="Collapse"]');
  const activate = (row?: HTMLElement) => {
    if (!row) return;
    activeId = row.dataset.nodeId || "";
    if (activeRow && activeRow !== row) activeRow.tabIndex = -1;
    activeRow = row;
    row.tabIndex = 0;
  };
  const focus = (row?: HTMLElement) => {
    if (!row) return;
    activate(row);
    row.focus({preventScroll: true});
    scrollExplorerRowIntoView(row, container);
  };
  const syncExpander = (row: HTMLElement) => {
    const button = expander(row);
    if (button && !button.disabled) row.setAttribute("aria-expanded", String(button.getAttribute("aria-label") === "Collapse"));
    else row.removeAttribute("aria-expanded");
    row.setAttribute("aria-busy", String(button?.textContent?.trim() === "..."));
  };
  const sync = () => {
    const all = rows();
    const active = all.find((row) => row.dataset.nodeId === activeId) || all[0];
    for (const row of all) {
      row.setAttribute("role", "treeitem");
      row.tabIndex = row === active ? 0 : -1;
      syncExpander(row);
      let level = 0;
      for (let parent = row.parentElement; parent && parent !== container; parent = parent.parentElement) {
        if (parent.tagName === "LI") { parent.setAttribute("role", "none"); level++; }
        if (parent.tagName === "UL") parent.setAttribute("role", parent.parentElement?.closest("li") ? "group" : "tree");
      }
      row.setAttribute("aria-level", row.dataset.treeDepth !== undefined ? String(Number(row.dataset.treeDepth) + 1) : String(level || 1));
    }
    activeRow = active;
  };
  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;
    const row = target.closest<HTMLElement>(EXPLORER_ROW_SELECTOR);
    if (row) focus(row);
  };
  const onKey = (event: KeyboardEvent) => {
    const row = event.target as HTMLElement;
    if (!row.matches(EXPLORER_ROW_SELECTOR)) return;
    const visible = visibleRows();
    const index = visible.indexOf(row);
    const button = expander(row);
    switch (event.key) {
      case "ArrowDown": focus(visible[Math.min(index + 1, visible.length - 1)]); break;
      case "ArrowUp": focus(visible[Math.max(index - 1, 0)]); break;
      case "Home": focus(visible[0]); break;
      case "End": focus(visible[visible.length - 1]); break;
      case "ArrowRight":
        if (button?.getAttribute("aria-label") === "Expand" && !button.disabled) button.click();
        else if (row.getAttribute("aria-expanded") === "true") focus(visible[index + 1]);
        break;
      case "ArrowLeft":
        if (button?.getAttribute("aria-label") === "Collapse") button.click();
        else focus(row.closest("li")?.parentElement?.closest("li")?.querySelector<HTMLElement>(EXPLORER_ROW_SELECTOR));
        break;
      case "Enter": case " ": row.click(); break;
      case "F10":
        if (!event.shiftKey) return;
        // Same delegated context-menu path and target as a pointer click.
        const rect = row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true, clientX: rect.left + 30, clientY: rect.bottom}));
        break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const observer = new MutationObserver(records => {
    if (explorerRowsChanged(records)) { sync(); return; }
    const changedRows = new Set<HTMLElement>();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const button = target?.closest('button[aria-label="Expand"], button[aria-label="Collapse"]');
      const row = button?.closest<HTMLElement>(EXPLORER_ROW_SELECTOR);
      if (row) changedRows.add(row);
    }
    for (const row of changedRows) syncExpander(row);
  });
  observer.observe(container, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label"]});
  container.addEventListener("click", onClick);
  const onFocus = (event: FocusEvent) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(EXPLORER_ROW_SELECTOR);
    if (row) activate(row);
  };
  container.addEventListener("focusin", onFocus);
  container.addEventListener("keydown", onKey);
  sync();
  return () => {
    observer.disconnect();
    container.removeEventListener("click", onClick);
    container.removeEventListener("focusin", onFocus);
    container.removeEventListener("keydown", onKey);
  };
}
