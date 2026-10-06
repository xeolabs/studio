import type {SelectionService} from "../services/SelectionService";
import type {InspectableExplorerNode} from "./inspectExplorerNode";
import {EXPLORER_ROW_SELECTOR} from "./explorerSelection";
import {explorerRowsChanged} from "./explorerRowMutations";

/** Highlights existing instances only; selection must never expand or materialize a tree. */
export function bindExplorerSelectionState(container: HTMLElement, selection: SelectionService,
  getNode: (id: string) => InspectableExplorerNode | null | undefined): () => void {
  let localId: string | null = null;
  const sync = () => {
    for (const row of Array.from(container.querySelectorAll<HTMLElement>(EXPLORER_ROW_SELECTOR))) {
      const node = getNode(row.dataset.nodeId || "");
      const objectId = node?.kind === "object" ? node.objectId || node.componentId : null;
      const selected = localId ? node?.id === localId : !!objectId && objectId === selection.selectedSceneObjectId;
      row.setAttribute("aria-selected", String(selected));
      row.classList.toggle("is-selected", selected);
    }
  };
  const activate = (event: Event) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a, summary")) return;
    const row = target.closest<HTMLElement>(EXPLORER_ROW_SELECTOR);
    const node = row && getNode(row.dataset.nodeId || "");
    if (!node) return;
    localId = node.kind === "object" && (node.objectId || node.componentId) === selection.selectedSceneObjectId ? null : node.id;
    sync();
  };
  const unsubscribe = selection.onChanged(() => { localId = null; sync(); });
  const observer = new MutationObserver(records => { if (explorerRowsChanged(records)) sync(); });
  observer.observe(container, {subtree: true, childList: true});
  container.addEventListener("click", activate);
  sync();
  return () => { unsubscribe(); observer.disconnect(); container.removeEventListener("click", activate); };
}
