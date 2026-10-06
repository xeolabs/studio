import "element-plus/dist/index.css";
import "dockview-vue/dist/styles/dockview.css";
import "./styles.css";
import {RoutingPickStrategy} from "@xeokit/sdk/spatial/picking";
import {connectRendererActions} from "./studio/app/connectRendererActions";
import {connectSelection} from "./studio/app/connectSelection";
import {connectStudioActions} from "./studio/app/connectStudioActions";
import {connectStudioServices} from "./studio/app/connectStudioServices";
import {connectDiagnosticPanelActivity} from "./studio/app/connectDiagnosticPanelActivity";
import {connectViewerHostActions} from "./studio/app/connectViewerHostActions";
import {createRuntime} from "./studio/app/createRuntime";
import {createStudioActions} from "./studio/app/createStudioActions";
import {createStudioApp} from "./studio/app/createStudioApp";
import {createStudioState} from "./studio/app/createStudioState";
import {exposeDebugApi, markStudioExampleLoaded} from "./studio/app/exposeDebugApi";
import {registerStudioTeardown} from "./studio/app/registerStudioTeardown";
import {registerDiagnosticCommands} from "./studio/commands/registerDiagnosticCommands";
import {createHealthCleanupConfirmation} from "./studio/ui/confirmHealthCleanup";
import {diagnosticObjectIds} from "./studio/services/diagnosticObjectIds";
import {registerRendererCommands} from "./studio/commands/registerRendererCommands";
import {registerSelectionCommands} from "./studio/commands/registerSelectionCommands";
import {registerStudioCommands} from "./studio/commands/registerStudioCommands";
import {registerSunStudyCommands} from "./studio/commands/registerSunStudyCommands";
import {registerTilesCommands} from "./studio/commands/registerTilesCommands";
import {registerViewportCommands} from "./studio/commands/registerViewportCommands";
import {studioMenuSections, toolWindowMenuItems} from "./studio/commands/studioMenus";
import {
  installStudioContextMenus
} from "./studio/context-menu/installStudioContextMenus";
import {ExplorerHostController} from "./studio/explorers/ExplorerHostController";
import {ExplorerNavigationService} from "./studio/services/ExplorerNavigationService";
import {registerImportResultCommands} from "./studio/commands/registerImportResultCommands";
import {createViewerInputController} from "./studio/input/createViewerInputController";
import {DockviewController} from "./studio/layout/DockviewController";
import {toolWindowPanels} from "./studio/layout/toolWindowDefinitions";
import {loadStudioUiRuntime} from "./studio/loadStudioUiRuntime";
import {type InspectorContext} from "./studio/state/createWorkspaceStore";
import {type RendererMode} from "./studio/services/RendererService";
import {createDeleteConfirmation} from "./studio/ui/confirmDelete";
import {
  failExample,
  setStatus
} from "./studio/runtime";
main().catch((error) => failExample("apps/studio", error));

async function main() {
  const {Vue, Pinia, ElementPlus, DockviewVue} = await loadStudioUiRuntime();
  const confirmDelete = createDeleteConfirmation(ElementPlus);
  const {
    aabbPanelState,
    commands,
    contextMenuService,
    contextMenuState,
    dataHealthPanelState,
    diagnosticsPanelState,
    exportDialogState,
    importDialogState,
    pinia,
    sceneHealthPanelState,
    sunStudyPanelState,
    tilesPanelState,
    workspace
  } = createStudioState(Vue, Pinia);
  const actions = createStudioActions();
  const commandEventCleanup = commands.onDidExecute((event) => {
    if (event.status === "started") {
      workspace.appendEvent("command", "started", event.command.title);
      return;
    }
    if (event.status === "failed") {
      const message = event.error instanceof Error ? event.error.message : String(event.error);
      workspace.appendEvent("command", "failed", `${event.command.title}: ${message}`, "error");
      workspace.appendOutput(`${event.command.title}: ${message}`, "Commands");
      return;
    }
    if (event.status === "disabled") {
      workspace.appendEvent("command", "disabled", event.command.title, "warning");
    }
  });

  const notifyLayoutChanged = () => requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  const setInspectorContext = (context: InspectorContext) => {
    workspace.setInspectorContext(context);
    notifyLayoutChanged();
  };
  const layoutController = new DockviewController({workspace, notifyLayoutChanged});
  const openToolWindow = (panelId: string) => layoutController.open(panelId);
  const closeToolWindow = (panelId: string) => layoutController.close(panelId);
  const toggleToolWindow = (panelId: string) => layoutController.toggle(panelId);
  registerStudioCommands({
    aabbPanelState,
    closeToolWindow,
    commands,
    dataHealthPanelState,
    diagnosticsPanelState,
    exportActions: actions.exportActions,
    exportDialogState,
    importActions: actions.importActions,
    importDialogState,
    openToolWindow,
    sceneHealthPanelState,
    setInspectorContext,
    tilesPanelState,
    toggleToolWindow,
    toolWindowPanels,
    workspace
  });
  const menuSections = studioMenuSections;
  const explorerHostController = new ExplorerHostController({
    actions: actions.explorerHostActions,
    workspace
  });
  const explorerNavigation = new ExplorerNavigationService({hosts: explorerHostController, commands, openPanel: openToolWindow});
  let activeView: any = null;
  const viewerHostController = connectViewerHostActions({
    actions: actions.viewerHostActions,
    getActiveView: () => activeView,
    notifyLayoutChanged
  });
  const onDockviewReady = (event: any) => layoutController.attach(event);

  const app = createStudioApp({
    explorerSessions: explorerHostController.sessions,
    explorerNavigation,
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
  });
  await layoutController.ready;

  const {
    data,
    dataModel,
    diagnosticsService,
    refreshStatusItems,
    renderer: initialRenderer,
    rendererService,
    scene,
    sceneModel,
    view,
    viewer
  } = await createRuntime({
    diagnosticsPanelState,
    initialRendererMode: getInitialRendererMode(),
    workspace
  });
  activeView = view;
  viewerHostController.requestRender();
  let renderer = initialRenderer;
  let picker: RoutingPickStrategy | null = null;
  let inputController: ReturnType<typeof createViewerInputController> | null = null;

  const {
    aabbService,
    dataHealthService,
    exportDialogService,
    importDialogService,
    objectDetailsResolver,
    sceneHealthService,
    sunStudyService,
    tilesService
  } = connectStudioServices({
    commands,
    aabbPanelState,
    data,
    dataHealthPanelState,
    exportDialogState,
    importDialogState,
    refreshStatusItems,
    renderer,
    rendererLabel: rendererService.label,
    scene,
    sceneHealthPanelState,
    sunStudyPanelState,
    tilesPanelState,
    view,
    workspace
  });
  registerImportResultCommands({commands, scene, data, view, state: importDialogState, navigation: explorerNavigation, openPanel: openToolWindow});
  const diagnosticPanelActivityCleanup = connectDiagnosticPanelActivity(Vue,
    {state: aabbPanelState, service: aabbService}, {state: tilesPanelState, service: tilesService});
  connectStudioActions({
    actions,
    dataHealthService,
    diagnosticsService,
    exportDialogService,
    importDialogService,
    sceneHealthService,
    sunStudyService,
    tilesService,
    workspace
  });
  registerDiagnosticCommands({
    confirmCleanup: createHealthCleanupConfirmation(ElementPlus),
    resourceObjectIds: (target) => diagnosticObjectIds(scene, data, target).filter((id) => !!view.objects[id]),
    actions,
    commands,
    dataHealthPanelState,
    diagnosticsPanelState,
    openToolWindow,
    sceneHealthPanelState
  });
  registerTilesCommands({
    actions,
    commands,
    openToolWindow,
    tilesPanelState
  });
  registerSunStudyCommands({
    actions,
    commands,
    openToolWindow,
    sunStudyPanelState
  });
  const {
    selectionService,
    selectSceneObject
  } = connectSelection({
    detailsResolver: objectDetailsResolver,
    notifyLayoutChanged,
    refreshStatusItems,
    view,
    workspace
  });
  registerSelectionCommands({
    commands,
    selectionService,
    openInspector: () => openToolWindow("inspector"),
    workspace
  });
  picker = new RoutingPickStrategy(scene, renderer);
  inputController = createViewerInputController({
    picker,
    selectSceneObject,
    selectionService,
    view
  });

  workspace.setStatus("Building explorer tabs...");
  workspace.appendOutput(workspace.status, "Studio");
  workspace.appendEvent("studio", "startup", workspace.status);
  setStatus("status", workspace.status);
  const contextMenuParams = explorerHostController.connect({
    commands,
    contextMenuService,
    confirmDeleteModel: confirmDelete,
    data,
    getPicker: () => picker,
    renderer,
    rendererLabel: rendererService.label,
    scene,
    selectSceneObject,
    selectionService,
    setInspectorContext,
    view,
    viewer,
    vue: Vue
  });
  explorerNavigation.connect({data, scene, view});
  const viewportCommandsCleanup = registerViewportCommands({
    commands,
    dataExplorer: explorerHostController.dataExplorer,
    scene,
    sceneTree: explorerHostController.sceneTree,
    selectSceneObject,
    selectionService,
    view
  });
  const viewportContextMenuCleanup = installStudioContextMenus(contextMenuParams);
  connectRendererActions({
    actions: actions.rendererActions,
    diagnosticsService,
    getInputController: () => inputController,
    getPicker: () => picker,
    updateExplorerRenderer: (renderer, label) => explorerHostController.setRenderer(renderer, label),
    rendererService,
    scene,
    selectSceneObject,
    selectionService,
    setInputController: (value) => {
      inputController = value;
    },
    setPicker: (value) => {
      picker = value;
    },
    setRenderer: (value) => {
      renderer = value;
    },
    setStatus,
    tilesService,
    view,
    workspace
  });
  registerRendererCommands({
    actions,
    commands,
    workspace
  });
  const dispose = registerStudioTeardown({
    diagnosticPanelActivityCleanup,
    explorerNavigation,
    exportDialogService,
    app,
    aabbService,
    dataHealthService,
    diagnosticsService,
    explorerHostController,
    getInputController: () => inputController,
    getPicker: () => picker,
    layoutController,
    rendererService,
    sceneHealthService,
    sunStudyService,
    tilesService,
    viewerHostController,
    commandEventCleanup,
    viewportCommandsCleanup,
    viewportContextMenuCleanup
  });
  workspace.setLoaded(true);
  workspace.setStatus("Ready");
  workspace.appendOutput("Studio workspace ready", "Studio");
  workspace.appendEvent("studio", "ready", "Studio workspace ready.");
  workspace.finishTask(workspace.startTask("Start Studio", "Runtime, viewer, and default models initialized."), "success", "Studio workspace ready.");
  setStatus("status", workspace.status);
  markStudioExampleLoaded();
  exposeDebugApi({
    app,
    data,
    scene,
    viewer,
    view,
    renderer,
    picker,
    inputController,
    sceneModel,
    dataModel,
    commands,
    workspace,
    objectDetailsResolver,
    aabbService,
    dataHealthService,
    diagnosticsService,
    exportDialogService,
    importDialogService,
    sceneHealthService,
    sunStudyService,
    tilesService,
    selectionService,
    selectSceneObject,
    rendererService,
    dataExplorer: explorerHostController.dataExplorer,
    sceneTree: explorerHostController.sceneTree,
    viewerExplorer: explorerHostController.viewerExplorer,
    dispose
  });
}

function getInitialRendererMode(): RendererMode {
  const rendererName = new URLSearchParams(window.location.search).get("renderer")?.toLowerCase();
  return rendererName === "webgl" ? "webgl" : "webgpu";
}
