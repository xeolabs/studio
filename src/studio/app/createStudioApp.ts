import {createStudioShellComponent} from "../components/StudioShell";
import {createExportDialogComponent} from "../components/dialogs/ExportDialog";
import {createImportDialogComponent} from "../components/dialogs/ImportDialog";
import {createDockviewComponents} from "../components/panels/dockviewComponents";
import type {StudioActions, StudioPanelStates} from "./types";
import type {ExplorerNavigationService} from "../services/ExplorerNavigationService";
import type {ExplorerSessions} from "../explorers/ExplorerSessions";

export interface CreateStudioAppParams extends StudioPanelStates {
  explorerNavigation: ExplorerNavigationService;
  explorerSessions: ExplorerSessions;
  Vue: any;
  ElementPlus: any;
  DockviewVue: any;
  commands: any;
  contextMenuService: any;
  menuSections: any[];
  notifyLayoutChanged: () => void;
  onDockviewReady: (event: any) => void;
  pinia: any;
  toolWindowMenuItems: any[];
  workspace: any;
  actions: StudioActions;
}

export function createStudioApp(params: CreateStudioAppParams): any {
  const {
    DockviewVue,
    ElementPlus,
    Vue,
    aabbPanelState,
    actions,
    commands,
    contextMenuService,
    contextMenuState,
    dataHealthPanelState,
    diagnosticsPanelState,
    exportDialogState,
    importDialogState,
    menuSections,
    notifyLayoutChanged,
    onDockviewReady,
    pinia,
    sceneHealthPanelState,
    sunStudyPanelState,
    tilesPanelState,
    toolWindowMenuItems,
    workspace
  } = params;
  const StudioShell = createStudioShellComponent(Vue, {
    sceneHealthPanelState,
    dataHealthPanelState,
    commands,
    contextMenuService,
    contextMenuState,
    diagnosticsPanelState,
    dockviewComponents: createDockviewComponents(Vue),
    menuSections,
    notifyLayoutChanged,
    onDockviewReady,
    toolWindowMenuItems,
    workspace
  });
  const app = Vue.createApp(StudioShell);
  app.use(pinia);
  app.use(ElementPlus, {zIndex: 210000000});
  app.provide("commands", commands);
  app.provide("explorerNavigation", params.explorerNavigation);
  app.provide("explorerSessions", params.explorerSessions);
  app.provide("workspace", workspace);
  app.provide("aabbPanelState", aabbPanelState);
  app.provide("dataHealthPanelState", dataHealthPanelState);
  app.provide("diagnosticsPanelState", diagnosticsPanelState);
  app.provide("exportActions", actions.exportActions);
  app.provide("exportDialogState", exportDialogState);
  app.provide("importActions", actions.importActions);
  app.provide("importDialogState", importDialogState);
  app.provide("explorerHostActions", actions.explorerHostActions);
  app.provide("viewerHostActions", actions.viewerHostActions);
  app.provide("sceneHealthPanelState", sceneHealthPanelState);
  app.provide("sunStudyPanelState", sunStudyPanelState);
  app.provide("dataHealthActions", actions.dataHealthActions);
  app.provide("diagnosticsActions", actions.diagnosticsActions);
  app.provide("rendererActions", actions.rendererActions);
  app.provide("sceneHealthActions", actions.sceneHealthActions);
  app.provide("sunStudyActions", actions.sunStudyActions);
  app.provide("tilesActions", actions.tilesActions);
  app.provide("tilesPanelState", tilesPanelState);
  app.component("ExportDialogPanel", createExportDialogComponent(Vue));
  app.component("ImportDialogPanel", createImportDialogComponent(Vue));
  app.component("DockviewVue", DockviewVue);
  app.mount("#app");
  return app;
}
