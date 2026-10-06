import type {DataObjectTreeStore} from "./ifc/DataObjectTreeStore";

export type IfcExplorerSource = "ifc" | "ifcStoreys" | "ifcTypes";
export type IfcExplorerStore = Pick<DataObjectTreeStore,
  "data" | "view" | "getNode" | "getObjectId" | "getNodeObjectIds" | "getObjectPath" | "getSearchEntries" | "setEffect" | "fitObject" | "toggleExpanded" | "state">;

export interface IfcNodeTarget {source: IfcExplorerSource; nodeId: string;}

export function isIfcSource(source: string): source is IfcExplorerSource {
  return source === "ifc" || source === "ifcStoreys" || source === "ifcTypes";
}
