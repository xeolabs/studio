import type {InspectorSource} from "../state/createWorkspaceStore";
import {inspectExplorerNode, type InspectableExplorerNode} from "./inspectExplorerNode";

export const EXPLORER_ROW_SELECTOR = ".xeokit-data-explorer-row, .xeokit-data-tree-row, .xeokit-scene-tree-row, .xeokit-viewer-explorer-row";

export function bindExplorerSelection(
  container: HTMLElement,
  source: Extract<InspectorSource, "data" | "ifc" | "ifcStoreys" | "ifcTypes" | "scene" | "viewer">,
  getNode: (id: string) => InspectableExplorerNode | null | undefined,
  actions: Parameters<typeof inspectExplorerNode>[2]
): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, select, textarea, a")) {
      return;
    }
    const row = target?.closest<HTMLElement>(EXPLORER_ROW_SELECTOR);
    if (!row || !container.contains(row)) {
      return;
    }
    const node = getNode(row.dataset.nodeId || "");
    if (node) {
      inspectExplorerNode(source, node, actions);
    }
  };
  container.addEventListener("click", onClick);
  return () => container.removeEventListener("click", onClick);
}
