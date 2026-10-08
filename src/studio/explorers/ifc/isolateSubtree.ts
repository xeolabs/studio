import {viewIsolation} from "../../services/ViewIsolation";
import type {IfcExplorerStore} from "../ifcExplorerTypes";
import type {DataObjectTreeNodeState} from "./DataObjectTreeStore";

/** Isolate all subtree objects, including descendants in collapsed branches. */
export function isolateSubtree(store: IfcExplorerStore, node: DataObjectTreeNodeState): void {
  viewIsolation(store.view).isolate(store.getNodeObjectIds(node), node.title);
}
