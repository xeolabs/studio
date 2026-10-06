import type {Scene} from "@xeokit/sdk/model/scene";
import {RoutingPickStrategy} from "@xeokit/sdk/spatial/picking";
import type {View} from "@xeokit/sdk/viewing/viewer";
import {CommandRegistry} from "../commands/CommandRegistry";
import {CommandIds as C} from "../commands/commandIds";
import {type InspectorContext, type InspectorSource} from "../state/createWorkspaceStore";
import {ContextMenuService, type StudioContextMenuItem, separator} from "../services/ContextMenuService";
import type {SelectionService} from "../services/SelectionService";
import {explorerContextMenuItems, getExplorerStore, actionItem, commandItem, visibleItems} from "./explorerMenuItems";
import {
  resolveObjectName,
  type StudioObjectActionParams
} from "./objectActions";
import {copyText} from "../ui/clipboard";
import {inspectExplorerNode} from "../explorers/inspectExplorerNode";
import {EXPLORER_ROW_SELECTOR} from "../explorers/explorerSelection";
import {isIfcSource, type IfcExplorerSource, type IfcExplorerStore} from "../explorers/ifcExplorerTypes";
import {ifcExplorerMenuItems} from "./ifcExplorerMenuItems";
import {revealMenuItems} from "./revealMenuItems";

export interface StudioContextMenuInstallParams extends StudioObjectActionParams {
  commands: CommandRegistry;
  contextMenuService: ContextMenuService;
  dataExplorer: any;
  scene: Scene;
  sceneTree: any;
  selectSceneObject: (sceneObjectId: string | null) => void;
  selectionService: SelectionService;
  setInspectorContext: (context: InspectorContext) => void;
  view: View;
  viewerExplorer: any;
  getPicker: () => RoutingPickStrategy | null;
  getIfcStore?: (source: IfcExplorerSource) => IfcExplorerStore | null;
}

export function installStudioContextMenus(params: StudioContextMenuInstallParams): () => void {
  const viewerPanel = document.querySelector<HTMLElement>(".viewer-panel");
  const onContextMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".studio-context-menu, .menu-bar, .el-popper, .el-overlay")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const canvas = params.view.htmlElement;
    canvas.tabIndex = 0;
    canvas.focus({preventScroll: true});
    const pick = pickViewportObject(params, event);
    const items = pick?.objectId
      ? objectContextMenuItems(params, pick.objectId)
      : viewportContextMenuItems(params);
    params.contextMenuService.openAt(event.clientX, event.clientY, items);
  };
  viewerPanel?.addEventListener("contextmenu", onContextMenu);
  return () => viewerPanel?.removeEventListener("contextmenu", onContextMenu);
}

export function installExplorerContextMenu(
  params: StudioContextMenuInstallParams,
  container: HTMLElement,
  source: "data" | "scene" | "viewer" | IfcExplorerSource
): () => void {
  const onContextMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest<HTMLElement>(
      EXPLORER_ROW_SELECTOR
    );
    if (!row || !container.contains(row)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nodeId = row.dataset.nodeId;
    const store = isIfcSource(source) ? params.getIfcStore?.(source) : getExplorerStore(params, source);
    const node = nodeId ? store?.getNode(nodeId) : null;
    if (!node) {
      return;
    }
    row.focus({preventScroll: true});
    const objectId = isIfcSource(source) ? store.getObjectId(node) : node.kind === "object" ? node.objectId || node.componentId : null;
    setInspectorContextFromExplorerNode(params, source, objectId ? {...node, kind: "object", objectId} : node);
    const items = isIfcSource(source) ? ifcExplorerMenuItems(params.commands, source, store, node) : explorerContextMenuItems(params, source, node);
    params.contextMenuService.openAt(event.clientX, event.clientY, visibleItems([
      ...items, separator("reveal"), ...revealMenuItems(params.commands, objectId, source)
    ]));
  };
  container.addEventListener("contextmenu", onContextMenu);
  return () => container.removeEventListener("contextmenu", onContextMenu);
}

function viewportContextMenuItems(params: StudioContextMenuInstallParams): StudioContextMenuItem[] {
  return visibleItems([
    commandItem(params.commands, "fit-all", C.viewport.fitAll),
    commandItem(params.commands, "frame-selection", C.viewport.frameSelection),
    commandItem(params.commands, "clear-selection", C.viewport.clearSelection),
    separator("viewport-visibility"),
    commandItem(params.commands, "show-all", C.viewport.showAll),
    separator("viewport-view"),
    commandItem(params.commands, "reset-camera", C.viewport.homeView),
    commandItem(params.commands, "copy-camera", C.viewport.copyCamera),
    separator("viewport-file"),
    commandItem(params.commands, "import", C.file.import)
  ]);
}

export function objectContextMenuItems(params: StudioContextMenuInstallParams, objectId: string): StudioContextMenuItem[] {
  const selected = params.selectionService.selectedSceneObjectId === objectId;
  const payload = {sceneObjectId: objectId};
  return visibleItems([
    actionItem("select", "Select", () => params.selectSceneObject(objectId), {enabled: !selected}),
    actionItem("remove-selection", "Remove from Selection", () => params.selectionService.clear(), {visible: selected}),
    separator("object-view"),
    commandItem(params.commands, "frame", C.viewport.frameSelection, {label: "Fit in View", payload}),
    commandItem(params.commands, "hide", C.viewport.hideSelection, {label: "Hide in View", payload}),
    commandItem(params.commands, "isolate", C.viewport.showOnlySelection, {label: "Isolate in View", payload}),
    commandItem(params.commands, "highlight", C.viewport.highlightSelection, {label: "Highlight in View", payload}),
    commandItem(params.commands, "xray", C.viewport.xraySelection, {label: "X-Ray in View", payload}),
    commandItem(params.commands, "show-all", C.viewport.showAll),
    separator("object-details"),
    ...revealMenuItems(params.commands, objectId),
    commandItem(params.commands, "inspect", C.inspector.open, {
      label: "Inspect",
      beforeRun: () => params.selectSceneObject(objectId)
    }),
    actionItem("copy-name", "Copy Name", () => copyText(resolveObjectName(params, objectId))),
    commandItem(params.commands, "copy-id", C.selection.copyId, {label: "Copy ID", payload}),
    commandItem(params.commands, "copy-json", C.selection.copyDetailsJson, {label: "Copy Object Info as JSON", payload})
  ]);
}

function pickViewportObject(params: StudioContextMenuInstallParams, event: MouseEvent): {objectId: string | null} | null {
  const picker = params.getPicker();
  const canvas = params.view.htmlElement as HTMLElement | null;
  if (!picker || !canvas) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const pickResult = picker.pick({
    view: params.view,
    canvasPos: [event.clientX - rect.left, event.clientY - rect.top]
  });
  return pickResult.hit ? {objectId: pickResult.objectId} : null;
}

function setInspectorContextFromExplorerNode(
  params: StudioContextMenuInstallParams,
  source: Extract<InspectorSource, "data" | "scene" | "viewer" | IfcExplorerSource>,
  node: any
): void {
  inspectExplorerNode(source, node, {
    hasSceneObject: (id) => !!params.scene.objects[id],
    selectSceneObject: params.selectSceneObject,
    setInspectorContext: params.setInspectorContext
  });
}
