import {parseStartupOptions} from "./startupOptions";
import {BundledModelsService} from "../services/BundledModelsService";
import {Data} from "@xeokit/sdk/model/data";
import {Scene} from "@xeokit/sdk/model/scene";
import {Viewer} from "@xeokit/sdk/viewing/viewer";
import {DiagnosticsService} from "../services/DiagnosticsService";
import {RendererService, type RendererMode} from "../services/RendererService";
import {createStudioPerformanceViewSettings} from "../services/studioPerformanceSettings";
import {countRecord} from "../ui/formatters";
import {
  mustElement,
  mustOk,
  setStatus
} from "../runtime";

export interface StudioRuntime {
  bundledModelsService: BundledModelsService;
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
  const startup = parseStartupOptions(window.location.search);
  workspace.setProjectName(startup.models.map(model => model.title).join(" + "));
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
      eye: startup.camera.eye,
      look: startup.camera.look,
      up: startup.camera.up,
      perspectiveProjection: {far: 20000, fov: startup.camera.fov},
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
  const bundledModelsService = new BundledModelsService({scene, data, view, workspace,
    baseURL: new URL(import.meta.env.BASE_URL, window.location.href).href,
    getRenderer: () => rendererService.renderer});
  try {
    await bundledModelsService.prepare(startup.models);
  } catch (error) {
    bundledModelsService.destroy();
    diagnosticsService.record("app", "model.loadFailed", "error", String(error));
    throw error;
  }
  const primary = bundledModelsService.initialModels[0];
  const sceneModel = scene.models[primary.sceneModelId!];
  const dataModel = primary.dataModelId ? data.models[primary.dataModelId] : undefined;
  refreshStatusItems();

  return {
    bundledModelsService,
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
