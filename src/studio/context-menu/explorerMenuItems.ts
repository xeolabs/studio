import type {CommandRegistry} from "../commands/CommandRegistry";
import {CommandIds as C} from "../commands/commandIds";
import type {StudioContextMenuItem} from "../services/ContextMenuService";
import {separator} from "../services/ContextMenuService";
import {copyText} from "../ui/clipboard";
import {explorerClipboardEntries} from "./explorerClipboardEntries";
import {
  selectNodeSceneObject,
  setDataNodeVisible,
  setSceneNodeVisible,
  showOnlyDataNode,
  showOnlyObject,
  showOnlySceneNode,
  type StudioObjectActionParams
} from "./objectActions";
import {collapseMaterialized, collapseNode, expandMaterialized, expandNode} from "./treeTraversal";

export interface ExplorerMenuParams extends StudioObjectActionParams {
  commands: CommandRegistry;
  dataExplorer: any;
  sceneTree: any;
  viewerExplorer: any;
}

export function getExplorerStore(params: ExplorerMenuParams, source: "data" | "scene" | "viewer"): any {
  return source === "data"
    ? params.dataExplorer.store
    : source === "scene"
      ? params.sceneTree.store
      : params.viewerExplorer.store;
}

export function explorerContextMenuItems(
  params: ExplorerMenuParams,
  source: "data" | "scene" | "viewer",
  node: any
): StudioContextMenuItem[] {
  if (source === "scene") {
    return sceneExplorerMenuItems(params, node);
  }
  if (source === "data") {
    return dataExplorerMenuItems(params, node);
  }
  return viewerExplorerMenuItems(params, node);
}

function sceneExplorerMenuItems(params: ExplorerMenuParams, node: any): StudioContextMenuItem[] {
  const store = params.sceneTree.store;
  const canExpand = !!node.hasChildren;
  const items: StudioContextMenuItem[] = [
    actionItem("select", "Select in View", () => selectNodeSceneObject(params, node), {visible: node.kind === "object", enabled: node.hasViewObject}),
    separator("scene-view"),
    actionItem("fit-scene", "Fit Scene in View", () => store.fitScene(node), {visible: node.kind === "scene"}),
    actionItem("fit-model", "Fit Model in View", () => store.fitModel(node), {visible: node.kind === "model", enabled: node.hasViewObject}),
    actionItem("fit-object", "Fit in View", () => store.fitObject(node), {visible: node.kind === "object", enabled: node.hasViewObject}),
    actionItem("fit-mesh", "Fit Mesh in View", () => store.fitMesh(node), {visible: node.kind === "mesh"}),
    actionItem("show", `Show ${node.kind === "model" ? "Model" : "Object"} in View`, () => setSceneNodeVisible(store, node, true), {
      visible: node.kind === "model" || node.kind === "object",
      enabled: node.hasViewObject && (!node.visible || node.visibleCount < node.viewObjectCount)
    }),
    actionItem("hide", `Hide ${node.kind === "model" ? "Model" : "Object"} in View`, () => setSceneNodeVisible(store, node, false), {
      visible: node.kind === "model" || node.kind === "object",
      enabled: node.hasViewObject && node.visible
    }),
    actionItem("show-only", node.kind === "model" ? "Isolate Model in View" : "Isolate in View", () => showOnlySceneNode(params, node), {
      visible: node.kind === "model" || node.kind === "object",
      enabled: node.hasViewObject
    }),
    commandItem(params.commands, "show-all", C.viewport.showAll),
    separator("scene-tree"),
    actionItem("expand", "Expand", () => expandNode(store, node), {visible: canExpand, enabled: !node.expanded}),
    actionItem("collapse", "Collapse", () => collapseNode(node, store), {visible: canExpand, enabled: node.expanded}),
    actionItem("reveal", "Reveal Shared Resource", () => store.revealReferencedResource(node), {visible: node.kind === "resourceRef"}),
    separator("scene-copy"),
    ...copyItems(node, objectName(params, node)),
    separator("scene-delete"),
    commandItem(params.commands, "unload-model", "model.unload", {visible: node.kind === "model", payload: {source: "scene", modelId: node.modelId}}),
    actionItem("delete-model", "Delete SceneModel", () => store.confirmAndDeleteModel(node), {visible: node.kind === "model"}),
    actionItem("delete-object", "Delete SceneObject", () => store.confirmAndDeleteObject(node), {visible: node.kind === "object"})
  ];
  return visibleItems(items);
}

function dataExplorerMenuItems(params: ExplorerMenuParams, node: any): StudioContextMenuItem[] {
  const store = params.dataExplorer.store;
  const canExpand = !!node.hasChildren;
  const hasSceneObjectInView = node.hasViewObject;
  const canTargetSceneObjects = node.kind === "model" || node.kind === "typeGroup" || node.kind === "object";
  const items: StudioContextMenuItem[] = [
    actionItem("select", "Select in View", () => selectNodeSceneObject(params, node), {
      visible: node.kind === "object",
      enabled: hasSceneObjectInView
    }),
    separator("data-view"),
    actionItem("fit-model", "Fit Model in View", () => store.fitModel(node), {visible: node.kind === "model", enabled: hasSceneObjectInView}),
    actionItem("fit-type", "Fit Type in View", () => store.fitType(node), {visible: node.kind === "typeGroup", enabled: hasSceneObjectInView}),
    actionItem("fit-object", "Fit in View", () => store.fitObject(node), {visible: node.kind === "object", enabled: hasSceneObjectInView}),
    actionItem("show", `Show ${dataSceneObjectSetLabel(node)}`, () => setDataNodeVisible(store, node, true), {
      visible: canTargetSceneObjects,
      enabled: hasSceneObjectInView && (!node.visible || node.visibleCount < node.viewObjectCount)
    }),
    actionItem("hide", `Hide ${dataSceneObjectSetLabel(node)}`, () => setDataNodeVisible(store, node, false), {
      visible: canTargetSceneObjects,
      enabled: hasSceneObjectInView && node.visible
    }),
    actionItem("show-only", dataShowOnlyLabel(node), () => showOnlyDataNode(params, node), {
      visible: canTargetSceneObjects,
      enabled: hasSceneObjectInView
    }),
    commandItem(params.commands, "show-all", C.viewport.showAll),
    separator("data-tree"),
    actionItem("expand", "Expand", () => expandNode(store, node), {visible: canExpand, enabled: !node.expanded}),
    actionItem("collapse", "Collapse", () => collapseNode(node, store), {visible: canExpand, enabled: node.expanded}),
    separator("data-copy"),
    ...copyItems(node, node.kind === "object" ? store.data.objects[node.componentId]?.name : undefined),
    separator("data-delete"),
    commandItem(params.commands, "unload-model", "model.unload", {visible: node.kind === "model", payload: {source: "data", modelId: node.modelId}}),
    actionItem("delete-model", "Delete DataModel", () => store.confirmAndDeleteModel(node), {visible: node.kind === "model"})
  ];
  return visibleItems(items);
}

function dataSceneObjectSetLabel(node: any): string {
  if (node.kind === "model") {
    return "Model in View";
  }
  if (node.kind === "typeGroup") {
    return "Type in View";
  }
  return "in View";
}

function dataShowOnlyLabel(node: any): string {
  if (node.kind === "model") {
    return "Isolate Model in View";
  }
  if (node.kind === "typeGroup") {
    return "Isolate Type in View";
  }
  return "Isolate in View";
}

function viewerExplorerMenuItems(params: ExplorerMenuParams, node: any): StudioContextMenuItem[] {
  const store = params.viewerExplorer.store;
  const canExpand = !!node.hasChildren;
  const items: StudioContextMenuItem[] = [
    actionItem("select", "Select", () => selectNodeSceneObject(params, node), {
      visible: node.kind === "object",
      enabled: !!node.componentId
    }),
    separator("viewer-view"),
    actionItem("fit-object", "Fit in View", () => store.fitObject(node), {visible: node.canFit, enabled: node.canFit}),
    actionItem("show", "Show in View", () => store.setObjectVisibility(node, true), {
      visible: node.kind === "object",
      enabled: !node.visible
    }),
    actionItem("hide", "Hide in View", () => store.setObjectVisibility(node, false), {
      visible: node.kind === "object",
      enabled: node.visible
    }),
    actionItem("show-only", "Isolate in View", () => showOnlyObject(params, node.componentId), {
      visible: node.kind === "object",
      enabled: !!node.componentId
    }),
    commandItem(params.commands, "show-all", C.viewport.showAll),
    separator("viewer-tree"),
    actionItem("expand", "Expand", () => expandNode(store, node), {visible: canExpand, enabled: !node.expanded}),
    actionItem("collapse", "Collapse", () => collapseNode(node, store), {visible: canExpand, enabled: node.expanded}),
    actionItem("expand-children", "Expand Children", () => expandMaterialized(store, node), {visible: canExpand}),
    actionItem("collapse-children", "Collapse Children", () => collapseMaterialized(node, store), {visible: canExpand}),
    separator("viewer-copy"),
    ...copyItems(node, objectName(params, node))
  ];
  return visibleItems(items);
}

function objectName(params: ExplorerMenuParams, node: {kind: string; objectId?: string; componentId?: string}): string | undefined {
  if (node.kind !== "object") return undefined;
  const id = node.objectId || node.componentId;
  const details = id && params.selectionService.resolveSceneObject(id);
  return details && details.title !== id ? details.title : undefined;
}

function copyItems(node: Parameters<typeof explorerClipboardEntries>[0], name?: string): StudioContextMenuItem[] {
  return explorerClipboardEntries(node, name).map(entry => actionItem(entry.id, entry.label, () => copyText(entry.text)));
}

export function actionItem(
  id: string,
  label: string,
  action: () => void | Promise<void>,
  options: {enabled?: boolean; visible?: boolean; shortcut?: string} = {}
): StudioContextMenuItem {
  return {
    id,
    label,
    action,
    enabled: options.enabled,
    shortcut: options.shortcut,
    ...(options.visible === false ? {hidden: true} : {})
  } as StudioContextMenuItem & {hidden?: boolean};
}

export function commandItem(
  commands: CommandRegistry,
  id: string,
  commandId: string,
  options: {beforeRun?: () => void | Promise<void>; label?: string; visible?: boolean; payload?: unknown} = {}
): StudioContextMenuItem {
  const command = commands.get(commandId);
  const visible = options.visible !== false && !!command && commands.isVisible(commandId);
  return actionItem(
    id,
    options.label || command?.title || commandId,
    async () => {
      await options.beforeRun?.();
      commands.execute(commandId, options.payload);
    },
    {
      enabled: !!command && commands.isEnabled(commandId, options.payload),
      shortcut: command?.shortcut,
      visible
    }
  );
}

export function visibleItems(items: StudioContextMenuItem[]): StudioContextMenuItem[] {
  const visible = items.filter((item) => !(item as StudioContextMenuItem & {hidden?: boolean}).hidden);
  const compact: StudioContextMenuItem[] = [];
  for (const item of visible) {
    if (item.type === "separator") {
      if (compact.length === 0 || compact[compact.length - 1].type === "separator") {
        continue;
      }
    }
    compact.push(item);
  }
  while (compact.length > 0 && compact[compact.length - 1].type === "separator") {
    compact.pop();
  }
  return compact;
}
