import {ObjectSelectionDetailsResolver} from "../services/ObjectSelectionDetails";
import {AabbService} from "../services/AabbService";
import {DataHealthService} from "../services/DataHealthService";
import {ExportDialogService} from "../services/ExportDialogService";
import {ImportDialogService} from "../services/ImportDialogService";
import {SceneHealthService} from "../services/SceneHealthService";
import {SunStudyService} from "../services/SunStudyService";
import {TilesService} from "../services/TilesService";
import {setStatus} from "../runtime";
import type {CommandRegistry} from "../commands/CommandRegistry";

export interface ConnectStudioServicesParams {
  commands: CommandRegistry;
  aabbPanelState: any;
  data: any;
  dataHealthPanelState: any;
  exportDialogState: any;
  importDialogState: any;
  refreshStatusItems: () => void;
  renderer: any;
  rendererLabel: string;
  scene: any;
  sceneHealthPanelState: any;
  sunStudyPanelState: any;
  tilesPanelState: any;
  view: any;
  workspace: any;
}

export interface StudioServices {
  aabbService: AabbService;
  dataHealthService: DataHealthService;
  exportDialogService: ExportDialogService;
  importDialogService: ImportDialogService;
  objectDetailsResolver: ObjectSelectionDetailsResolver;
  sceneHealthService: SceneHealthService;
  sunStudyService: SunStudyService;
  tilesService: TilesService;
}

export function connectStudioServices(params: ConnectStudioServicesParams): StudioServices {
  const {
    aabbPanelState,
    data,
    dataHealthPanelState,
    exportDialogState,
    importDialogState,
    refreshStatusItems,
    renderer,
    rendererLabel,
    scene,
    sceneHealthPanelState,
    sunStudyPanelState,
    tilesPanelState,
    view,
    workspace
  } = params;
  const objectDetailsResolver = new ObjectSelectionDetailsResolver({data, scene});
  const aabbService = new AabbService({
    scene,
    data,
    view,
    state: aabbPanelState,
    resolveTitle: (sceneObject) => objectDetailsResolver.resolveSceneObjectTitle(sceneObject.id)
  });
  const sceneHealthService = new SceneHealthService({
    scene,
    state: sceneHealthPanelState
  });
  const tilesService = new TilesService({
    scene,
    view,
    renderer,
    rendererLabel,
    state: tilesPanelState
  });
  const dataHealthService = new DataHealthService({
    data,
    state: dataHealthPanelState
  });
  const importDialogService = new ImportDialogService({
    scene,
    data,
    state: importDialogState,
    getModels: () => workspace.loadedModels || [],
    beforeReplace: models => {
      const scenes = new Set(models.map(model => model.sceneModelId));
      const semantics = new Set(models.map(model => model.dataModelId));
      const selected = workspace.selectedObjectDetails?.sceneObjectId;
      if (selected && scenes.has(scene.objects[selected]?.model.id)) params.commands.execute("selection.clear");
      const floor = data.objects[workspace.section.planFloorId];
      if (floor?.models.some((model: any) => semantics.has(model.id))) params.commands.execute("section.return3D");
    },
    onLoaded: (result) => {
      workspace.setStatus(`Imported ${result.title || result.dataSet.label}`);
      workspace.appendOutput(workspace.status, "Importer");
      refreshStatusItems();
      setStatus("status", workspace.status);
      view.needsRender();
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
      if (result.frameAfterImport && result.sceneModel) {
        // Keep the result visible; automatic framing does not dismiss the dialog.
        params.commands.execute("viewport.frameObjects", Object.keys(result.sceneModel.objects));
      }
    }
  });
  const exportDialogService = new ExportDialogService({
    scene,
    data,
    state: exportDialogState
  });
  return {
    aabbService,
    dataHealthService,
    exportDialogService,
    importDialogService,
    objectDetailsResolver,
    sceneHealthService,
    sunStudyService: new SunStudyService({view, state: sunStudyPanelState}),
    tilesService
  };
}
