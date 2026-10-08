import {Data} from "@xeokit/sdk/model/data";
import {Scene} from "@xeokit/sdk/model/scene";
import {Viewer} from "@xeokit/sdk/viewing/viewer";
import {DiagnosticsService} from "../services/DiagnosticsService";
import {RendererService, type RendererMode} from "../services/RendererService";
import {createStudioPerformanceViewSettings} from "../services/studioPerformanceSettings";
import {countRecord} from "../ui/formatters";
import {
  fetchArrayBuffer,
  fetchJSON,
  mustElement,
  mustOk,
  setStatus
} from "../runtime";

const MODEL_BASE = `${import.meta.env.BASE_URL}models/Duplex`;

export interface StudioRuntime {
  data: Data;
  dataModel: any;
  diagnosticsService: DiagnosticsService;
  refreshStatusItems(selectedCount?: number): void;
  renderer: any;
  rendererService: RendererService;
  scene: Scene;
  sceneModel: any;
  view: any;
  viewer: Viewer;
}

export interface CreateRuntimeParams {
  diagnosticsPanelState: any;
  initialRendererMode: RendererMode;
  workspace: any;
}

export async function createRuntime(params: CreateRuntimeParams): Promise<StudioRuntime> {
  const {diagnosticsPanelState, initialRendererMode, workspace} = params;
  const data = new Data();
  const scene = new Scene();
  const viewer = new Viewer({scene});
  const refreshStatusItems = (selectedCount = 0) => {
    workspace.setStatusItems([
      {id: "selection", label: `${selectedCount} selected`},
      {id: "models", label: `${countRecord((scene as any).models) + countRecord((data as any).models)} models`},
      {id: "objects", label: `${countRecord((scene as any).objects)} objects`},
      {id: "dataObjects", label: `${countRecord((data as any).objects)} data objects`}
    ]);
  };
  refreshStatusItems();
  const view = mustOk(viewer.createView({
    ...createStudioPerformanceViewSettings(),
    id: "demoView",
    htmlElement: mustElement("demoCanvas") as HTMLCanvasElement,
    backgroundColor: [1, 1, 1],
    styleBins: [
      {id: "selected", priority: 90, edges: true, edgeColor: [0.1, 0.45, 1], edgeWidth: 3, fillAlpha: 0.82},
      {id: "highlighted", priority: 80, edges: true, edgeColor: [1, 0.78, 0.05], edgeWidth: 2, fillAlpha: 0.72},
      // X-ray must remain transparent when the element is also selected or highlighted.
      {id: "xrayed", priority: 100, fillAlpha: 0.18, edges: true, edgeColor: [0.35, 0.7, 1], edgeWidth: 1}
    ],
    camera: {
      eye: [24.40, 23.70, 27.04],
      look: [4.39, 8.90, 2.54],
      up: [-0.56, -0.41, 0.71],
      perspectiveProjection: {far: 20000},
      orthoProjection: {far: 20000}
    }
  }));
  // HemisphereAmbient belongs to view.lights, not this list of punctual lights.
  view.clearLights();
  const rendererService = new RendererService({
    viewer,
    view,
    canvasHost: mustElement("viewerCanvasHost"),
    initialMode: initialRendererMode
  });
  workspace.setRendererMode(rendererService.mode);
  let renderer;
  let rendererWarning = "";
  try {
    renderer = (await rendererService.initialize()).renderer;
  } catch (error) {
    if (initialRendererMode !== "webgpu") throw error;
    rendererWarning = `WebGPU unavailable; using WebGL. ${error instanceof Error ? error.message : String(error)}`;
    workspace.appendOutput(rendererWarning, "Renderer");
    workspace.appendEvent("renderer", "fallback", rendererWarning, "warning");
    workspace.setStatus("Starting WebGL renderer...");
    try {
      renderer = (await rendererService.switchTo("webgl")).renderer;
    } catch (fallbackError) {
      workspace.setRendererError(String(fallbackError));
      workspace.setStatus("Renderer initialization failed. See Output for details.");
      workspace.appendOutput(String(fallbackError), "Renderer");
      throw fallbackError;
    }
  }
  workspace.setRendererMode(rendererService.mode);
  const diagnosticsService = new DiagnosticsService({
    scene,
    data,
    viewer,
    renderer,
    state: diagnosticsPanelState
  });
  if (rendererWarning) {
    diagnosticsService.record("app", "renderer.fallback", "warning", rendererWarning);
  }
  const sceneModel = mustOk(scene.createModel({
    id: "duplexSceneModel",
    coordinateSystem: await fetchJSON(`${MODEL_BASE}/coordSys.json`),
    updateMode: "static"
  }));
  const dataModel = mustOk(data.createModel({id: "duplexDataModel"}));

  workspace.setStatus("Loading Duplex geometry and data...");
  workspace.appendOutput(workspace.status, "Loader");
  setStatus("status", workspace.status);
  try {
    const {XGFLoader} = await import("@xeokit/sdk/formats/xgf");
    const {DataModelImporter} = await import("@xeokit/sdk/formats/datamodel");
    await new XGFLoader().load({fileData: await fetchArrayBuffer(`${MODEL_BASE}/xgf/model.xgf`), sceneModel});
    await new DataModelImporter().load({fileData: await fetchJSON(`${MODEL_BASE}/datamodel/model.json`), dataModel});
  } catch (error) {
    diagnosticsService.record("app", "model.loadFailed", "error", String(error));
    throw error;
  }
  refreshStatusItems();

  return {
    data,
    dataModel,
    diagnosticsService,
    refreshStatusItems,
    renderer,
    rendererService,
    scene,
    sceneModel,
    view,
    viewer
  };
}
