import {RoutingPickStrategy} from "@xeokit/sdk/spatial/picking";
import {createViewerInputController} from "../input/createViewerInputController";
import type {RendererActions} from "./types";
import type {RendererMode} from "../services/RendererService";

export interface ConnectRendererActionsParams {
  actions: RendererActions;
  diagnosticsService: any;
  getInputController: () => ReturnType<typeof createViewerInputController> | null;
  getPicker: () => RoutingPickStrategy | null;
  updateExplorerRenderer: (renderer: any, label: string) => void;
  rendererService: any;
  scene: any;
  selectSceneObject: (sceneObjectId: string | null) => void;
  selectionService: any;
  setInputController: (inputController: ReturnType<typeof createViewerInputController> | null) => void;
  setPicker: (picker: RoutingPickStrategy | null) => void;
  setRenderer: (renderer: any) => void;
  setStatus: (elementId: string, message: string, level?: string) => void;
  tilesService: any;
  view: any;
  workspace: any;
}

export function connectRendererActions(params: ConnectRendererActionsParams): void {
  const {
    actions,
    diagnosticsService,
    getInputController,
    getPicker,
    updateExplorerRenderer,
    rendererService,
    scene,
    selectSceneObject,
    selectionService,
    setInputController,
    setPicker,
    setRenderer,
    setStatus,
    tilesService,
    view,
    workspace
  } = params;
  actions.switchTo = async (mode: RendererMode) => {
    if (workspace.rendererSwitching) {
      return;
    }
    if (mode === rendererService.mode) {
      workspace.setRendererError("");
      workspace.setStatus("Ready");
      return;
    }
    workspace.setRendererSwitching(true);
    workspace.setRendererError("");
    workspace.setStatus(`Switching to ${mode === "webgl" ? "WebGL" : "WebGPU"}...`);
    workspace.appendOutput(workspace.status, "Renderer");
    workspace.appendEvent("renderer", "switchStarted", workspace.status);
    setStatus("status", workspace.status);
    try {
      const result = await rendererService.switchTo(mode, () => {
        getInputController()?.destroy();
        setInputController(null);
        getPicker()?.dispose();
        setPicker(null);
      });
      setRenderer(result.renderer);
      diagnosticsService.setRenderer(result.renderer);
      const picker = new RoutingPickStrategy(scene, result.renderer);
      setPicker(picker);
      setInputController(createViewerInputController({
        planView: !!workspace.section?.planFloorId,
        getToolMode: () => workspace.toolMode,
        picker,
        selectSceneObject,
        selectionService,
        view
      }));
      updateExplorerRenderer(result.renderer, result.label);
      tilesService.setRenderer(result.renderer, result.label);
      workspace.setRendererMode(result.mode);
      workspace.setStatus("Ready");
      workspace.appendOutput(`Renderer ready: ${result.label}`, "Renderer");
      workspace.appendEvent("renderer", "switchFinished", `Renderer ready: ${result.label}`);
      setStatus("status", workspace.status);
      const exported = (window as any).studioExample;
      if (exported) {
        exported.renderer = result.renderer;
        exported.picker = picker;
        exported.inputController = getInputController();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnosticsService.record("app", "renderer.switchFailed", "error", message, [error]);
      workspace.setRendererError(message);
      workspace.setStatus(`Renderer switch failed: ${message}`);
      workspace.appendOutput(workspace.status, "Renderer");
      workspace.appendEvent("renderer", "switchFailed", message, "error");
      setStatus("status", workspace.status, "error");
    } finally {
      workspace.setRendererSwitching(false);
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
  };
}
