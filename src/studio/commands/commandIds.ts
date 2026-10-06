export const CommandIds = {
  activity: {
    configure: "activity.configure",
    corePanels: "activity.corePanels",
    diagnose: "activity.diagnose",
    diagnosticPanels: "activity.diagnosticPanels",
    explorer: "activity.explorer",
    explorerPanels: "activity.explorerPanels",
    review: "activity.review",
    reviewPanels: "activity.reviewPanels",
    runtime: "activity.runtime",
    tools: "activity.tools",
    transform: "activity.transform"
  },
  bottom: {
    clearCurrent: "bottom.clearCurrent",
    copyCurrentJson: "bottom.copyCurrentJson",
    decreaseHeight: "bottom.decreaseHeight",
    events: "bottom.events",
    hide: "bottom.hide",
    increaseHeight: "bottom.increaseHeight",
    maximizeHeight: "bottom.maximizeHeight",
    minimizeHeight: "bottom.minimizeHeight",
    nextTab: "bottom.nextTab",
    output: "bottom.output",
    previousTab: "bottom.previousTab",
    problems: "bottom.problems",
    show: "bottom.show",
    tasks: "bottom.tasks",
    toggle: "bottom.toggle"
  },
  diagnostics: {
    clear: "diagnostics.clear",
    copyJson: "diagnostics.copyJson",
    copySummaryJson: "diagnostics.copySummaryJson"
  },
  file: {
    export: "file.export",
    exportClearDataModels: "file.export.clearDataModels",
    exportClearSceneModels: "file.export.clearSceneModels",
    exportCopyOptionsJson: "file.export.copyOptionsJson",
    exportRefreshModels: "file.export.refreshModels",
    exportSelectAllDataModels: "file.export.selectAllDataModels",
    exportSelectAllSceneModels: "file.export.selectAllSceneModels",
    import: "file.import",
    importCopyOptionsJson: "file.import.copyOptionsJson",
    importFileMode: "file.import.fileMode",
    importResetOrigin: "file.import.resetOrigin",
    importUrlMode: "file.import.urlMode"
  },
  inspector: {
    copyContextJson: "inspector.copyContextJson",
    open: "inspector.open",
    resetContext: "inspector.resetContext",
    toggle: "inspector.toggle"
  },
  renderer: {
    copyStatusJson: "renderer.copyStatusJson",
    toggle: "renderer.toggle",
    webgl: "renderer.webgl",
    webgpu: "renderer.webgpu"
  },
  runtime: {
    copyOverviewJson: "runtime.copyOverviewJson",
    inspectData: "runtime.inspectData",
    inspectDiagnostics: "runtime.inspectDiagnostics",
    inspectScene: "runtime.inspectScene",
    inspectTiles: "runtime.inspectTiles",
    inspectViewer: "runtime.inspectViewer",
    openData: "runtime.openData",
    openDiagnostics: "runtime.openDiagnostics",
    openOverview: "runtime.openOverview",
    openScene: "runtime.openScene",
    openTiles: "runtime.openTiles",
    openViewer: "runtime.openViewer"
  },
  selection: {
    clear: "selection.clear",
    copyAabbJson: "selection.copyAabbJson",
    copyDataObjectId: "selection.copyDataObjectId",
    copyDetailsJson: "selection.copyDetailsJson",
    copyId: "selection.copyId",
    copyLinkedIdsJson: "selection.copyLinkedIdsJson",
    copyPropertiesJson: "selection.copyPropertiesJson",
    copyTitle: "selection.copyTitle",
    copyType: "selection.copyType",
    inspect: "selection.inspect"
  },
  dataHealth: {
    inspect: "dataHealth.inspect"
  },
  sceneHealth: {
    cleanupAll: "sceneHealth.cleanupAll",
    inspect: "sceneHealth.inspect"
  },
  studio: {
    commandPalette: "studio.commandPalette",
    copyCommandsJson: "studio.copyCommandsJson",
    copyShortcutAuditJson: "studio.copyShortcutAuditJson",
    copyStatusJson: "studio.copyStatusJson",
    copyVisibleCommandsJson: "studio.copyVisibleCommandsJson",
    copyWorkspaceJson: "studio.copyWorkspaceJson"
  },
  sunStudy: {
    copyStateJson: "sunStudy.copyStateJson",
    dayMode: "sunStudy.dayMode",
    faster: "sunStudy.faster",
    juneSolstice: "sunStudy.date.juneSolstice",
    noon: "sunStudy.time.noon",
    pause: "sunStudy.pause",
    play: "sunStudy.play",
    resetNorth: "sunStudy.resetNorth",
    slower: "sunStudy.slower",
    togglePlayback: "sunStudy.togglePlayback",
    yearMode: "sunStudy.yearMode"
  },
  tiles: {
    copyCameraJson: "tiles.copyCameraJson",
    copyFrameStatsJson: "tiles.copyFrameStatsJson",
    copyJson: "tiles.copyJson",
    copySummaryJson: "tiles.copySummaryJson",
    openAndRefresh: "tiles.openAndRefresh",
    refresh: "tiles.refresh"
  },
  view: {
    closeAllToolPanels: "view.closeAllToolPanels",
    closeExplorerPanels: "view.closeExplorerPanels",
    closeInspectorPanels: "view.closeInspectorPanels",
    openViewerOnly: "view.openViewerOnly",
    toolWindow: (panelId: string) => `view.toolWindows.${panelId}`
  },
  viewport: {
    clearHighlights: "viewport.clearHighlights",
    clearSelection: "viewport.clearSelection",
    clearViewEffects: "viewport.clearViewEffects",
    clearXrays: "viewport.clearXrays",
    copyCamera: "viewport.copyCamera",
    fitAll: "viewport.fitAll",
    frameSelection: "viewport.frameSelection",
    hideSelection: "viewport.hideSelection",
    highlightSelection: "viewport.highlightSelection",
    homeView: "viewport.homeView",
    showAll: "viewport.showAll",
    showOnlySelection: "viewport.showOnlySelection",
    showSelection: "viewport.showSelection",
    unhighlightSelection: "viewport.unhighlightSelection",
    unxraySelection: "viewport.unxraySelection",
    xraySelection: "viewport.xraySelection"
  }
} as const;

export type StudioCommandId =
  | ExcludeDeepFunctionValues<typeof CommandIds>
  | ReturnType<typeof CommandIds.view.toolWindow>;

type ExcludeDeepFunctionValues<T> = T extends (...args: any[]) => any
  ? never
  : T extends string
    ? T
    : T extends Record<string, any>
      ? ExcludeDeepFunctionValues<T[keyof T]>
      : never;
