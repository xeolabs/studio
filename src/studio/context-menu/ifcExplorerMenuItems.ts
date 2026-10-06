import type {CommandRegistry} from "../commands/CommandRegistry";
import type {DataObjectTreeNodeState} from "../explorers/ifc/DataObjectTreeStore";
import type {IfcExplorerSource, IfcExplorerStore} from "../explorers/ifcExplorerTypes";
import {actionItem, commandItem, visibleItems} from "./explorerMenuItems";
import {separator} from "../services/ContextMenuService";

export function ifcExplorerMenuItems(commands: CommandRegistry, source: IfcExplorerSource, store: IfcExplorerStore, node: DataObjectTreeNodeState) {
  const payload = {source, nodeId: node.id};
  const objectId = store.getObjectId(node);
  return visibleItems([
    commandItem(commands, "select", "ifc.select", {payload, visible: !!objectId}),
    separator("ifc-view"),
    ...["fit", "show", "hide", "isolate"].map((action) => commandItem(commands, action, `ifc.${action}`, {payload})),
    commandItem(commands, "show-all", "viewport.showAll"),
    separator("ifc-tree"),
    actionItem("expand", "Expand", () => store.toggleExpanded(node), {visible: node.hasChildren, enabled: !node.expanded && !node.loading}),
    actionItem("collapse", "Collapse", () => store.toggleExpanded(node), {visible: node.hasChildren, enabled: node.expanded && !node.loading}),
    separator("ifc-copy"),
    commandItem(commands, "copy-name", "ifc.copyName", {payload}),
    commandItem(commands, "copy-id", "ifc.copyId", {payload})
  ]);
}
