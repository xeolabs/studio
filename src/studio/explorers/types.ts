import type {TreeSearchEntry} from "./tree/treeSearchEntries";
import type {InspectableExplorerNode} from "./inspectExplorerNode";

export type ExplorerSource = "data" | "ifc" | "ifcStoreys" | "ifcTypes" | "scene" | "viewer";

export interface NavigableExplorerNode extends InspectableExplorerNode {
  hasChildren: boolean;
  expanded: boolean;
  loading: boolean;
  children: NavigableExplorerNode[];
}

export interface NavigableExplorerStore {
  state: {roots: NavigableExplorerNode[]; revision: number};
  getNode(id: string): NavigableExplorerNode | null;
  toggleExpanded(node: NavigableExplorerNode): Promise<void>;
  getSearchEntries(): Iterable<TreeSearchEntry>;
  getObjectId?(node: NavigableExplorerNode): string | null;
  getObjectPath?(objectId: string): string[] | null;
  revealChild?(node: NavigableExplorerNode, childId: string): void | Promise<void>;
  captureBranchStates?(): Map<string, {expanded: boolean; pageIndex: number}>;
  restoreBranchStates?(states: ReadonlyMap<string, {expanded: boolean; pageIndex: number}>): void;
}
