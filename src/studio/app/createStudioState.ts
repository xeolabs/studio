import {CommandRegistry} from "../commands/CommandRegistry";
import {createContextMenuState, ContextMenuService} from "../services/ContextMenuService";
import {createAabbPanelState} from "../services/AabbService";
import {createDataHealthPanelState} from "../services/DataHealthService";
import {createDiagnosticsPanelState} from "../services/DiagnosticsService";
import {createExportDialogState} from "../services/ExportDialogService";
import {createImportDialogState} from "../services/ImportDialogService";
import {createSceneHealthPanelState} from "../services/SceneHealthService";
import {createSunStudyPanelState} from "../services/SunStudyService";
import {createTilesPanelState} from "../services/TilesService";
import {createWorkspaceStore} from "../state/createWorkspaceStore";
import type {StudioStateContext} from "./types";

export function createStudioState(Vue: any, Pinia: any): StudioStateContext {
  const pinia = Pinia.createPinia();
  const useWorkspaceStore = createWorkspaceStore(Pinia);
  const workspace = useWorkspaceStore(pinia);
  const contextMenuState = Vue.reactive(createContextMenuState());
  // Large diagnostic snapshots are replaced as a unit, never deeply proxied.
  const aabbPanelState = Vue.shallowReactive(createAabbPanelState());
  const dataHealthPanelState = Vue.reactive(createDataHealthPanelState());
  const diagnosticsPanelState = Vue.reactive(createDiagnosticsPanelState());
  const exportDialogState = Vue.reactive(createExportDialogState());
  const importDialogState = Vue.reactive(createImportDialogState());
  const sceneHealthPanelState = Vue.reactive(createSceneHealthPanelState());
  const sunStudyPanelState = Vue.reactive(createSunStudyPanelState());
  const tilesPanelState = Vue.shallowReactive(createTilesPanelState());
  return {
    pinia,
    workspace,
    commands: new CommandRegistry(() => ({
      activeActivity: workspace.activeActivity,
      activePanelId: null,
      bottomPanelOpen: workspace.bottomPanelOpen,
      bottomPanelTab: workspace.bottomPanelTab,
      commandPaletteOpen: workspace.commandPaletteOpen,
      dataModelCount: dataModelCount(dataHealthPanelState),
      exportDialogOpen: exportDialogState.open,
      importDialogOpen: importDialogState.open,
      rendererMode: workspace.rendererMode,
      rendererSwitching: workspace.rendererSwitching,
      sceneModelCount: sceneModelCount(sceneHealthPanelState),
      selectedDataObjectId: workspace.selectedObjectDetails?.dataObjectId || null,
      selectedObjectId: workspace.selectedObjectDetails?.sceneObjectId || null,
      selectedObjectType: workspace.selectedObjectDetails?.type || null,
      toolWindowOpen: workspace.toolWindowOpen
    })),
    contextMenuState,
    contextMenuService: new ContextMenuService(contextMenuState),
    aabbPanelState,
    dataHealthPanelState,
    diagnosticsPanelState,
    exportDialogState,
    importDialogState,
    sceneHealthPanelState,
    sunStudyPanelState,
    tilesPanelState
  };
}

function sceneModelCount(sceneHealthPanelState: any): number {
  return Array.isArray(sceneHealthPanelState.models) ? sceneHealthPanelState.models.length : 0;
}

function dataModelCount(dataHealthPanelState: any): number {
  return Array.isArray(dataHealthPanelState.models) ? dataHealthPanelState.models.length : 0;
}
