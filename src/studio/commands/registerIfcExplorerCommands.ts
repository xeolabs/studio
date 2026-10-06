import type {CommandRegistry} from "./CommandRegistry";
import {isIfcSource, type IfcExplorerSource, type IfcExplorerStore, type IfcNodeTarget} from "../explorers/ifcExplorerTypes";
import {copyText} from "../ui/clipboard";

export function registerIfcExplorerCommands(commands: CommandRegistry, getStore: (source: IfcExplorerSource) => IfcExplorerStore | null,
  selectObject: (id: string) => void) {
  const resolve = (payload: unknown) => {
    const target = payload as Partial<IfcNodeTarget> | null;
    if (!target || !isIfcSource(target.source || "") || typeof target.nodeId !== "string") return null;
    const store = getStore(target.source as IfcExplorerSource);
    const node = store?.getNode(target.nodeId);
    return store && node ? {store, node} : null;
  };
  for (const [action, title] of Object.entries({
    select: "Select in View", fit: "Fit in View", show: "Show in View", hide: "Hide in View",
    isolate: "Isolate in View", copyName: "Copy Name", copyId: "Copy ID"
  })) {
    commands.register({
      id: `ifc.${action}`, title, category: "IFC Data",
      enabled: (_context, payload) => {
        const resolved = resolve(payload);
        if (!resolved) return false;
        const {store, node} = resolved;
        if (action.startsWith("copy")) return true;
        if (action === "select") return !!store.view.objects[store.getObjectId(node) || ""];
        const ids = store.getNodeObjectIds(node);
        if (action === "show") return ids.some((id) => !store.view.objects[id]?.visible);
        if (action === "hide") return ids.some((id) => store.view.objects[id]?.visible);
        return ids.length > 0;
      },
      run: async (payload) => {
        const resolved = resolve(payload);
        if (!resolved) return;
        const {store, node} = resolved;
        switch (action) {
          case "select": selectObject(store.getObjectId(node)!); break;
          case "fit": store.fitObject(node); break;
          case "show": store.setEffect(node, "visible", true); break;
          case "hide": store.setEffect(node, "visible", false); break;
          case "isolate": {
            const ids = store.getNodeObjectIds(node);
            if (!ids.length) return;
            store.view.setObjectsVisible(Object.keys(store.view.objects), false);
            store.setEffect(node, "visible", true);
            break;
          }
          case "copyName": await copyText(node.title); break;
          case "copyId": await copyText(store.getObjectId(node) || node.id); break;
        }
      }
    });
  }
}
