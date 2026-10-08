import type {Scene} from "@xeokit/sdk/model/scene";
import type {View} from "@xeokit/sdk/viewing/viewer";
import type {CommandRegistry} from "./CommandRegistry";
import type {SelectionService} from "../services/SelectionService";
import {viewIsolation} from "../services/ViewIsolation";
import {ViewportCameraService} from "../services/ViewportCameraService";
import {commandObjectId} from "./objectCommandTarget";
import {
  copyCamera,
  showOnlyObject,
  showAll,
  type StudioObjectActionParams
} from "../context-menu/objectActions";

export interface RegisterViewportCommandsParams {
  commands: CommandRegistry;
  dataExplorer: any;
  scene: Scene;
  sceneTree: any;
  selectSceneObject: (sceneObjectId: string | null) => void;
  selectionService: SelectionService;
  view: View;
  workspace?: {isolationLabel: string};
  sectionView?: {isPlan: () => boolean; fitPlan: () => void; returnTo3D: () => void};
}

export function registerViewportCommands(params: RegisterViewportCommandsParams): () => void {
  const camera = new ViewportCameraService(params.scene, params.view);
  const isolation = viewIsolation(params.view);
  const unsubscribeIsolation = isolation.onChanged(label => { if (params.workspace) params.workspace.isolationLabel = label; });
  params.commands.register({
    id: "viewport.restoreIsolation", title: "Restore Previous Visibility", category: "View: Viewport",
    enabled: () => !!isolation.label,
    run: () => isolation.restore()
  });
  const objectId = (payload?: unknown) => commandObjectId(payload, params.selectionService.selectedSceneObjectId);
  const hasTarget = (_context: unknown, payload?: unknown) => !!params.view.objects[objectId(payload) || ""];
  params.commands.register({
    id: "viewport.frameObjects",
    title: "Fit Objects in View",
    visible: () => false,
    enabled: (_context, payload) => Array.isArray(payload) && payload.some((id) => typeof id === "string" && !!params.view.objects[id]),
    run: (payload) => camera.fitObjects((payload as string[]).filter((id) => !!params.view.objects[id]))
  });
  for (const [name, bin] of [["Xray", "xrayed"], ["Highlight", "highlighted"], ["Visibility", "visible"]] as const) {
    params.commands.register({id: `viewport.toggle${name}`, title: `Toggle selection ${name.toLowerCase()}`, category: "View: Viewport", enabled: hasTarget,
      checked: () => {
        const object = params.view.objects[params.selectionService.selectedSceneObjectId || ""];
        return !!object && (bin === "visible" ? object.visible : object.hasStyleBin(bin));
      },
      run: payload => {
        const id = objectId(payload)!, object = params.view.objects[id];
        if (bin === "visible") object.visible = !object.visible;
        else params.view.setObjectsInStyleBin(bin, [id], !object.hasStyleBin(bin));
      }});
  }
  const actionParams: StudioObjectActionParams = {
    dataExplorer: params.dataExplorer,
    scene: params.scene,
    sceneTree: params.sceneTree,
    selectSceneObject: params.selectSceneObject,
    selectionService: params.selectionService,
    view: params.view
  };
  params.commands.register({
    id: "viewport.fitAll",
    title: "Fit All",
    category: "View: Viewport",
    shortcut: "Shift+F",
    run: () => params.sectionView?.isPlan() ? params.sectionView.fitPlan() : camera.fit()
  });
  params.commands.register({
    id: "viewport.frameSelection",
    title: "Fit Selection in View",
    category: "View: Viewport",
    shortcut: "F",
    enabled: hasTarget,
    run: (payload) => camera.fit(objectId(payload)!)
  });
  params.commands.register({
    id: "viewport.clearSelection",
    title: "Clear Selection",
    category: "View: Viewport",
    enabled: (context) => !!context.selectedObjectId,
    run: () => params.selectionService.clear()
  });
  params.commands.register({
    id: "viewport.showAll",
    title: "Show All in View",
    category: "View: Viewport",
    shortcut: "Ctrl+Shift+H",
    run: () => showAll(actionParams)
  });
  params.commands.register({
    id: "viewport.hideSelection",
    title: "Hide Selection in View",
    category: "View: Viewport",
    shortcut: "H",
    enabled: hasTarget,
    run: (payload) => {
      const id = objectId(payload);
      if (id) {
        params.view.setObjectsVisible([id], false);
      }
    }
  });
  params.commands.register({
    id: "viewport.showSelection",
    title: "Show Selection in View",
    category: "View: Viewport",
    enabled: hasTarget,
    run: (payload) => {
      const id = objectId(payload);
      if (id) {
        params.view.setObjectsVisible([id], true);
      }
    }
  });
  params.commands.register({
    id: "viewport.showOnlySelection",
    title: "Isolate Selection in View",
    category: "View: Viewport",
    shortcut: "Shift+H",
    enabled: hasTarget,
    run: (payload) => showOnlyObject(actionParams, objectId(payload))
  });
  params.commands.register({
    id: "viewport.highlightSelection",
    title: "Highlight Selection in View",
    category: "View: Viewport",
    shortcut: "Ctrl+Alt+H",
    enabled: hasTarget,
    run: (payload) => { params.view.setObjectsInStyleBin("highlighted", [objectId(payload)!], true); }
  });
  params.commands.register({
    id: "viewport.unhighlightSelection",
    title: "Remove Selection Highlight",
    category: "View: Viewport",
    enabled: hasTarget,
    run: (payload) => { params.view.setObjectsInStyleBin("highlighted", [objectId(payload)!], false); }
  });
  params.commands.register({
    id: "viewport.xraySelection",
    title: "X-Ray Selection in View",
    category: "View: Viewport",
    shortcut: "Ctrl+Alt+X",
    enabled: hasTarget,
    run: (payload) => { params.view.setObjectsInStyleBin("xrayed", [objectId(payload)!], true); }
  });
  params.commands.register({
    id: "viewport.unxraySelection",
    title: "Remove Selection X-Ray",
    category: "View: Viewport",
    enabled: hasTarget,
    run: (payload) => { params.view.setObjectsInStyleBin("xrayed", [objectId(payload)!], false); }
  });
  params.commands.register({
    id: "viewport.clearHighlights",
    title: "Clear View Highlights",
    category: "View: Viewport",
    run: () => clearStyleBin(params.view, "highlighted")
  });
  params.commands.register({
    id: "viewport.clearXrays",
    title: "Clear View X-Rays",
    category: "View: Viewport",
    run: () => clearStyleBin(params.view, "xrayed")
  });
  params.commands.register({
    id: "viewport.clearViewEffects",
    title: "Clear View Effects",
    category: "View: Viewport",
    run: () => {
      clearStyleBin(params.view, "highlighted");
      clearStyleBin(params.view, "xrayed");
    }
  });
  params.commands.register({
    id: "viewport.homeView",
    title: "Home View",
    category: "View: Viewport",
    shortcut: "Home",
    run: () => params.sectionView?.isPlan() ? params.sectionView.returnTo3D() : camera.homeView()
  });
  params.commands.register({
    id: "viewport.copyCamera",
    title: "Copy Camera View",
    category: "View: Viewport",
    shortcut: "Ctrl+Alt+C",
    run: () => copyCamera(params.view)
  });
  return () => { unsubscribeIsolation(); camera.destroy(); };
}

function clearStyleBin(view: View, styleBinId: string): void {
  const objectIds = (view.styleBins as any).getObjectIds?.(styleBinId) || [];
  if (objectIds.length > 0) {
    view.setObjectsInStyleBin(styleBinId, objectIds, false);
  }
}
