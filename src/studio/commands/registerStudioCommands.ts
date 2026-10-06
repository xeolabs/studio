import {CommandRegistry} from "./CommandRegistry";
import type {ExportActions} from "../app/types";
import type {ExportDialogState} from "../services/exportDialogState";
import {exportFormatsForSelection} from "../services/exportDialogDataSets";
import type {InspectorContext} from "../state/createWorkspaceStore";
import {copyText} from "../ui/clipboard";
import {LEFT_TOOL_WINDOW_IDS, RIGHT_TOOL_WINDOW_IDS} from "../layout/toolWindowDefinitions";
import {
  createRuntimeInspectorContext,
  createRuntimeOverviewSnapshot,
  type RuntimeOverviewTargetId
} from "../services/RuntimeOverviewSummary";

export interface RegisterStudioCommandsParams {
  closeToolWindow: (panelId: string) => void;
  commands: CommandRegistry;
  importActions: {open: () => void; close?: () => void; canLoad?: () => boolean; load?: () => void};
  exportActions: ExportActions;
  aabbPanelState: any;
  dataHealthPanelState: any;
  diagnosticsPanelState: any;
  importDialogState: any;
  exportDialogState: ExportDialogState;
  sceneHealthPanelState: any;
  tilesPanelState: any;
  openToolWindow: (panelId: string) => void;
  setInspectorContext: (context: InspectorContext) => void;
  toggleToolWindow: (panelId: string) => void;
  toolWindowPanels: Record<string, {title: string}>;
  workspace: any;
}

const TOOL_WINDOW_SHORTCUTS: Record<string, string> = {
  viewer: "Alt+0",
  data: "Alt+1",
  scene: "Alt+2",
  viewerExplorer: "Alt+3",
  inspector: "Alt+4",
  "runtime-overview": "Alt+5",
  "diagnostic-center": "Alt+6",
  boundaries: "Alt+7",
  diagnostics: "Alt+8",
  "sun-study": "Alt+9",
  "scene-health": "Ctrl+Alt+S",
  "data-health": "Ctrl+Alt+D",
  tiles: "Ctrl+Alt+Y"
};

const BOTTOM_PANEL_SHORTCUTS: Record<string, string> = {
  problems: "Ctrl+Shift+M",
  output: "Ctrl+Shift+U",
  events: "Ctrl+Shift+Y",
  tasks: "Ctrl+Shift+K"
};

const BOTTOM_PANEL_TABS = ["problems", "output", "events", "tasks"] as const;
const DIAGNOSTIC_TOOL_WINDOW_IDS = ["diagnostic-center", "diagnostics", "scene-health", "data-health", "boundaries", "tiles"] as const;
const RUNTIME_TOOL_WINDOW_IDS = ["runtime-overview", "viewerExplorer", "diagnostic-center"] as const;
const REVIEW_TOOL_WINDOW_IDS = ["sun-study"] as const;
const CORE_TOOL_WINDOW_IDS = ["viewer", "data", "scene", "viewerExplorer", "inspector"] as const;
const ALL_ACTIVITY_IDS = ["explorer", "review", "diagnose", "configure", "transform", "runtime", "tools"] as const;

export function registerStudioCommands(params: RegisterStudioCommandsParams): void {
  const {
    aabbPanelState,
    closeToolWindow,
    commands,
    dataHealthPanelState,
    diagnosticsPanelState,
    exportActions,
    exportDialogState,
    importActions,
    importDialogState,
    openToolWindow,
    sceneHealthPanelState,
    setInspectorContext,
    tilesPanelState,
    toggleToolWindow,
    toolWindowPanels,
    workspace
  } = params;
  const runtimeSnapshot = () => createRuntimeOverviewSnapshot({
    aabbPanelState,
    dataHealthPanelState,
    diagnosticsPanelState,
    sceneHealthPanelState,
    tilesPanelState,
    workspace
  });
  const inspectRuntimeTarget = (targetId: RuntimeOverviewTargetId) => {
    const snapshot = runtimeSnapshot();
    setInspectorContext(createRuntimeInspectorContext(targetId, snapshot) as InspectorContext);
    openToolWindow("inspector");
  };
  commands.register({
    id: "file.import",
    title: "Import",
    category: "File",
    shortcut: "Ctrl+O",
    enabled: () => workspace.loaded,
    run: () => {
      importActions.open();
      setInspectorContext({
        source: "toolbar",
        title: "Import Model",
        kind: "File",
        detail: "Choose model files or URLs, review the format and settings, then import."
      });
    }
  });
  commands.register({
    id: "file.import.run",
    title: "Run Import",
    category: "File",
    visible: () => false,
    enabled: () => !!importActions.canLoad?.(),
    run: () => importActions.load?.()
  });
  commands.register({
    id: "file.import.close",
    title: "Close Import Dialog",
    category: "File",
    visible: () => false,
    run: () => importActions.close?.()
  });
  commands.register({
    id: "file.import.fileMode",
    title: "Use Import File Mode",
    category: "File: Import",
    enabled: () => !importDialogState.loading && importDialogState.sourceMode !== "file",
    run: () => {
      importActions.open();
      (importActions as any).setSourceMode?.("file");
    }
  });
  commands.register({
    id: "file.import.urlMode",
    title: "Use Import URL Mode",
    category: "File: Import",
    enabled: () => !importDialogState.loading && importDialogState.sourceMode !== "url",
    run: () => {
      importActions.open();
      (importActions as any).setSourceMode?.("url");
    }
  });
  for (const dataSet of importDialogState.dataSets || []) {
    commands.register({
      id: `file.import.dataSet.${dataSet.id}`,
      title: `Import as ${dataSet.label}`,
      category: "File: Import",
      enabled: () => !importDialogState.loading && importDialogState.dataSetId !== dataSet.id,
      run: () => {
        importActions.open();
        (importActions as any).setDataSet?.(dataSet.id);
      }
    });
  }
  for (const units of importDialogState.unitsOptions || []) {
    commands.register({
      id: `file.import.units.${units}`,
      title: `Set Import Units to ${formatTitle(units)}`,
      category: "File: Import",
      enabled: () => !importDialogState.loading && importDialogState.units !== units,
      run: () => {
        importActions.open();
        importDialogState.units = units;
        importDialogState.coordinateMode = "override";
      }
    });
  }
  for (const mode of importDialogState.updateModes || []) {
    commands.register({
      id: `file.import.updateMode.${mode.id}`,
      title: `Set Import Update Mode to ${mode.label}`,
      category: "File: Import",
      enabled: () => !importDialogState.loading && importDialogState.updateMode !== mode.id,
      run: () => {
        importActions.open();
        importDialogState.updateMode = mode.id;
      }
    });
  }
  commands.register({
    id: "file.import.resetOrigin",
    title: "Reset Import Origin",
    category: "File: Import",
    enabled: () => !importDialogState.loading,
    run: () => {
      importActions.open();
      importDialogState.origin = [0, 0, 0];
    }
  });
  commands.register({
    id: "file.import.copyOptionsJson",
    title: "Copy Import Options as JSON",
    category: "File: Import",
    run: () => {
      void copyText(JSON.stringify({
        sourceMode: importDialogState.sourceMode,
        dataSetId: importDialogState.dataSetId,
        basisId: importDialogState.basisId,
        coordinateMode: importDialogState.coordinateMode,
        units: importDialogState.units,
        origin: importDialogState.origin,
        updateMode: importDialogState.updateMode,
        statusText: importDialogState.statusText,
        errorText: importDialogState.errorText || null,
        slots: Object.fromEntries(Object.entries(importDialogState.slots || {}).map(([key, slot]: [string, any]) => [key, {
          fileName: slot.fileName || "",
          url: slot.url || ""
        }]))
      }, null, 2));
    }
  });
  commands.register({
    id: "file.export",
    title: "Export",
    category: "File",
    shortcut: "Ctrl+Shift+E",
    enabled: () => workspace.loaded,
    run: () => {
      exportActions.open();
      setInspectorContext({
        source: "toolbar",
        title: "Export Models",
        kind: "File",
        detail: "Choose models, output format and filenames."
      });
    }
  });
  commands.register({
    id: "file.export.run",
    title: "Run Export",
    category: "File",
    visible: () => false,
    enabled: () => !!exportActions.canExport?.(),
    run: () => exportActions.exportSelected?.()
  });
  commands.register({
    id: "file.export.close",
    title: "Close Export Dialog",
    category: "File",
    visible: () => false,
    run: () => exportActions.close?.()
  });
  commands.register({
    id: "file.export.refreshModels",
    title: "Refresh Export Model List",
    category: "File: Export",
    enabled: () => !exportDialogState.loading && !exportDialogState.result,
    run: () => {
      exportActions.refreshModels();
    }
  });
  for (const dataSet of exportDialogState.dataSets || []) {
    commands.register({
      id: `file.export.dataSet.${dataSet.id}`,
      title: `Export as ${dataSet.label}`,
      category: "File: Export",
      enabled: () => !exportDialogState.loading && !exportDialogState.result && exportDialogState.dataSetId !== dataSet.id
        && exportFormatsForSelection(exportDialogState.dataSets, exportDialogState.selectedDataModelIds.length).includes(dataSet),
      run: () => {
        exportActions.open();
        exportActions.setDataSet(dataSet.id);
      }
    });
  }
  commands.register({
    id: "file.export.selectAllSceneModels",
    title: "Select All SceneModels for Export",
    category: "File: Export",
    enabled: () => !exportDialogState.loading && !exportDialogState.result && exportDialogState.sceneModels.some(model => !model.selected),
    run: () => exportActions.selectAll("scene")
  });
  commands.register({
    id: "file.export.clearSceneModels",
    title: "Clear Export SceneModel Selection",
    category: "File: Export",
    enabled: () => !exportDialogState.loading && !exportDialogState.result && exportDialogState.selectedSceneModelIds.length > 0,
    run: () => exportActions.clearSelection("scene")
  });
  commands.register({
    id: "file.export.selectAllDataModels",
    title: "Select All DataModels for Export",
    category: "File: Export",
    enabled: () => !exportDialogState.loading && !exportDialogState.result && exportDialogState.dataModels.some(model => !model.selected),
    run: () => exportActions.selectAll("data")
  });
  commands.register({
    id: "file.export.clearDataModels",
    title: "Clear Export DataModel Selection",
    category: "File: Export",
    enabled: () => !exportDialogState.loading && !exportDialogState.result && exportDialogState.selectedDataModelIds.length > 0,
    run: () => exportActions.clearSelection("data")
  });
  commands.register({
    id: "file.export.reset", title: "Export Another", category: "File: Export", visible: () => false,
    enabled: () => !exportDialogState.loading && !!exportDialogState.result,
    run: () => exportActions.reset()
  });
  commands.register({
    id: "file.export.download", title: "Download Exported File", category: "File: Export", visible: () => false,
    enabled: (_context, filename) => typeof filename === "string" && !!exportDialogState.result?.files.some(file => file.filename === filename),
    run: filename => { if (typeof filename === "string") exportActions.downloadFile(filename); }
  });
  commands.register({
    id: "file.export.copyOptionsJson",
    title: "Copy Export Options as JSON",
    category: "File: Export",
    run: () => {
      void copyText(JSON.stringify({
        dataSetId: exportDialogState.dataSetId,
        baseName: exportDialogState.baseName,
        selectedSceneModelIds: exportDialogState.selectedSceneModelIds,
        selectedDataModelIds: exportDialogState.selectedDataModelIds,
        statusText: exportDialogState.statusText,
        errorText: exportDialogState.errorText || null,
        lastExportedFiles: exportDialogState.lastExportedFiles
      }, null, 2));
    }
  });
  for (const [panelId, config] of Object.entries(toolWindowPanels)) {
    commands.register({
      id: `view.toolWindows.${panelId}`,
      title: config.title,
      category: "View: Tool Windows",
      shortcut: TOOL_WINDOW_SHORTCUTS[panelId],
      checked: () => !!workspace.toolWindowOpen[panelId],
      run: () => openToolWindow(panelId)
    });
    commands.register({
      id: `view.toolWindows.${panelId}.toggle`,
      title: `Toggle ${config.title}`,
      category: "View: Tool Windows",
      visible: () => false,
      run: () => toggleToolWindow(panelId)
    });
    commands.register({
      id: `view.toolWindows.${panelId}.close`,
      title: `Close ${config.title}`,
      category: "View: Tool Windows",
      visible: () => false,
      enabled: (context) => !!context.toolWindowOpen?.[panelId],
      run: () => closeToolWindow(panelId)
    });
  }
  commands.register({
    id: "studio.commandPalette",
    title: "Command Palette",
    category: "Studio",
    shortcut: "Ctrl+Shift+P",
    run: () => workspace.setCommandPaletteOpen(true)
  });
  commands.register({
    id: "studio.closeCommandPalette",
    title: "Close Command Palette",
    category: "Studio",
    visible: () => false,
    run: () => workspace.setCommandPaletteOpen(false)
  });
  commands.register({
    id: "studio.copyStatusJson",
    title: "Copy Studio Status as JSON",
    category: "Studio",
    shortcut: "Ctrl+Alt+Shift+C",
    run: () => {
      void copyText(JSON.stringify({
        projectName: workspace.projectName,
        rendererMode: workspace.rendererMode,
        rendererSwitching: workspace.rendererSwitching,
        rendererError: workspace.rendererError,
        status: workspace.status,
        activeActivity: workspace.activeActivity,
        bottomPanelOpen: workspace.bottomPanelOpen,
        bottomPanelTab: workspace.bottomPanelTab,
        toolWindowOpen: workspace.toolWindowOpen,
        selectedObjectDetails: workspace.selectedObjectDetails
      }, null, 2));
    }
  });
  commands.register({
    id: "studio.copyCommandsJson",
    title: "Copy Command List as JSON",
    category: "Studio",
    shortcut: "Ctrl+Alt+Shift+P",
    run: () => {
      void copyText(JSON.stringify(commands.list().map((command) => ({
        id: command.id,
        title: command.title,
        category: command.category || "",
        shortcut: command.shortcut || "",
        visible: commands.isVisible(command.id),
        enabled: commands.isEnabled(command.id)
      })), null, 2));
    }
  });
  commands.register({
    id: "studio.copyVisibleCommandsJson",
    title: "Copy Visible Commands as JSON",
    category: "Studio",
    run: () => {
      void copyText(JSON.stringify(commands.list({visibleOnly: true}).map((command) => ({
        id: command.id,
        title: command.title,
        category: command.category || "",
        shortcut: command.shortcut || "",
        enabled: commands.isEnabled(command.id)
      })), null, 2));
    }
  });
  commands.register({
    id: "studio.copyShortcutAuditJson",
    title: "Copy Shortcut Audit as JSON",
    category: "Studio",
    run: () => {
      const shortcuts = commands.list({visibleOnly: true})
        .filter((command) => !!command.shortcut)
        .map((command) => ({
          shortcut: command.shortcut,
          id: command.id,
          title: command.title,
          category: command.category || ""
        }));
      const byShortcut = new Map<string, typeof shortcuts>();
      for (const command of shortcuts) {
        const bucket = byShortcut.get(command.shortcut!) || [];
        bucket.push(command);
        byShortcut.set(command.shortcut!, bucket);
      }
      void copyText(JSON.stringify({
        shortcuts,
        duplicates: Array.from(byShortcut.entries())
          .filter(([, commandsForShortcut]) => commandsForShortcut.length > 1)
          .map(([shortcut, commandsForShortcut]) => ({shortcut, commands: commandsForShortcut}))
      }, null, 2));
    }
  });
  commands.register({
    id: "studio.copyWorkspaceJson",
    title: "Copy Workspace State as JSON",
    category: "Studio",
    shortcut: "Ctrl+Alt+Shift+Y",
    run: () => {
      void copyText(JSON.stringify({
        activeActivity: workspace.activeActivity,
        bottomPanelOpen: workspace.bottomPanelOpen,
        bottomPanelTab: workspace.bottomPanelTab,
        bottomPanelHeight: workspace.bottomPanelHeight,
        commandPaletteOpen: workspace.commandPaletteOpen,
        toolWindowOpen: workspace.toolWindowOpen,
        statusItems: workspace.statusItems,
        inspectorContext: workspace.inspectorContext
      }, null, 2));
    }
  });
  commands.register({
    id: "inspector.copyContextJson",
    title: "Copy Inspector Context as JSON",
    category: "Edit: Inspector",
    shortcut: "Ctrl+Alt+Shift+I",
    run: () => {
      void copyText(JSON.stringify({
        context: workspace.inspectorContext,
        selectedObjectDetails: workspace.selectedObjectDetails
      }, null, 2));
    }
  });
  commands.register({
    id: "inspector.open",
    title: "Open Inspector",
    category: "Edit: Inspector",
    shortcut: "Ctrl+Alt+L",
    run: () => openToolWindow("inspector")
  });
  commands.register({
    id: "inspector.close",
    title: "Close Inspector",
    category: "Edit: Inspector",
    visible: (context) => !!context.toolWindowOpen?.inspector,
    run: () => closeToolWindow("inspector")
  });
  commands.register({
    id: "inspector.toggle",
    title: "Toggle Inspector",
    category: "Edit: Inspector",
    run: () => toggleToolWindow("inspector")
  });
  commands.register({
    id: "inspector.resetContext",
    title: "Reset Inspector Context",
    category: "Edit: Inspector",
    run: () => setInspectorContext({
      source: "data",
      title: "Data Explorer",
      kind: "Explorer",
      detail: "Select a node in the Data, Scene or Viewer explorer to inspect it here."
    })
  });
  for (const activityId of ALL_ACTIVITY_IDS) {
    commands.register({
      id: `activity.${activityId}.select`,
      title: `Select ${formatTitle(activityId)} Activity`,
      category: "Activity",
      visible: () => false,
      run: () => workspace.setActiveActivity(activityId)
    });
  }
  commands.register({
    id: "activity.explorer",
    title: "Explorer",
    category: "Activity",
    shortcut: "Ctrl+Alt+E",
    run: () => {
      workspace.setActiveActivity("explorer");
      openToolWindow("data");
      openToolWindow("scene");
      openToolWindow("viewerExplorer");
    }
  });
  commands.register({
    id: "activity.runtime",
    title: "Runtime",
    category: "Activity",
    shortcut: "Ctrl+Alt+R",
    run: () => {
      workspace.setActiveActivity("runtime");
      openPanelSet(openToolWindow, RUNTIME_TOOL_WINDOW_IDS);
      openToolWindow("runtime-overview");
      setInspectorContext({
        source: "viewer",
        title: "Runtime",
        kind: "Workspace",
        detail: "Overview of live Viewer, Scene, Data, renderer, diagnostics, tiles, and selection state."
      });
    }
  });
  commands.register({
    id: "runtime.openOverview",
    title: "Open Runtime",
    category: "Runtime",
    run: () => {
      workspace.setActiveActivity("runtime");
      openToolWindow("runtime-overview");
    }
  });
  commands.register({
    id: "runtime.copyOverviewJson",
    title: "Copy Runtime as JSON",
    category: "Runtime",
    shortcut: "Ctrl+Alt+Shift+R",
    run: () => {
      void copyText(JSON.stringify(runtimeSnapshot(), null, 2));
    }
  });
  commands.register({
    id: "runtime.inspectViewer",
    title: "Inspect Viewer Runtime",
    category: "Runtime",
    run: () => inspectRuntimeTarget("viewer")
  });
  commands.register({
    id: "runtime.inspectScene",
    title: "Inspect Scene Runtime",
    category: "Runtime",
    run: () => inspectRuntimeTarget("scene")
  });
  commands.register({
    id: "runtime.inspectData",
    title: "Inspect Data Runtime",
    category: "Runtime",
    run: () => inspectRuntimeTarget("data")
  });
  commands.register({
    id: "runtime.inspectDiagnostics",
    title: "Inspect Diagnostics Runtime",
    category: "Runtime",
    run: () => inspectRuntimeTarget("diagnostics")
  });
  commands.register({
    id: "runtime.inspectTiles",
    title: "Inspect Tiles Runtime",
    category: "Runtime",
    run: () => inspectRuntimeTarget("tiles")
  });
  commands.register({
    id: "runtime.openViewer",
    title: "Open Viewer Runtime",
    category: "Runtime",
    run: () => {
      openToolWindow("viewerExplorer");
      inspectRuntimeTarget("viewer");
    }
  });
  commands.register({
    id: "runtime.openScene",
    title: "Open Scene Runtime",
    category: "Runtime",
    run: () => {
      openToolWindow("scene");
      inspectRuntimeTarget("scene");
    }
  });
  commands.register({
    id: "runtime.openData",
    title: "Open Data Runtime",
    category: "Runtime",
    run: () => {
      openToolWindow("data");
      inspectRuntimeTarget("data");
    }
  });
  commands.register({
    id: "runtime.openDiagnostics",
    title: "Open Diagnostics",
    category: "Runtime",
    run: () => {
      openToolWindow("diagnostic-center");
      inspectRuntimeTarget("diagnostics");
    }
  });
  commands.register({
    id: "runtime.openTiles",
    title: "Open Tiles Runtime",
    category: "Runtime",
    run: () => {
      openToolWindow("tiles");
      inspectRuntimeTarget("tiles");
    }
  });
  commands.register({
    id: "activity.tools",
    title: "Tools",
    category: "Activity",
    shortcut: "Ctrl+Alt+T",
    run: () => {
      workspace.setActiveActivity("tools");
      openToolWindow("diagnostic-center");
      setInspectorContext({
        source: "toolbar",
        title: "Tools",
        kind: "Workspace",
        detail: "Tool options appear here as Studio grows into authoring and diagnostic workflows."
      });
    }
  });
  commands.register({
    id: "activity.review",
    title: "Review",
    category: "Activity",
    shortcut: "Ctrl+Alt+V",
    run: () => {
      workspace.setActiveActivity("review");
      openToolWindow("sun-study");
      setInspectorContext({
        source: "toolbar",
        title: "Review",
        kind: "Workspace",
        detail: "Review model presentation, sunlight, shadows, and saved visual evidence."
      });
    }
  });
  commands.register({
    id: "activity.diagnose",
    title: "Diagnose",
    category: "Activity",
    shortcut: "Ctrl+Alt+G",
    run: () => {
      workspace.setActiveActivity("diagnose");
      openToolWindow("diagnostic-center");
      workspace.setBottomPanelTab("problems");
      setInspectorContext({
        source: "toolbar",
        title: "Diagnose",
        kind: "Workspace",
        detail: "Inspect scene, data, renderer, tiles, warnings, and health reports."
      });
    }
  });
  commands.register({
    id: "activity.configure",
    title: "Configure",
    category: "Activity",
    visible: () => false,
    run: () => {
      workspace.setActiveActivity("configure");
      openToolWindow("viewerExplorer");
      openToolWindow("inspector");
      setInspectorContext({
        source: "viewer",
        title: "Configure",
        kind: "Workspace",
        detail: "Inspect and tune Viewer, View, Camera, effects, lights, and renderer state."
      });
    }
  });
  commands.register({
    id: "activity.transform",
    title: "Transform",
    category: "Activity",
    visible: () => false,
    run: () => {
      workspace.setActiveActivity("transform");
      openToolWindow("inspector");
      workspace.setBottomPanelTab("tasks");
      setInspectorContext({
        source: "toolbar",
        title: "Transform",
        kind: "Workspace",
        detail: "Import, validate, merge, export, and review model pipeline tasks."
      });
    }
  });
  commands.register({
    id: "activity.explorerPanels",
    title: "Open Explorer Panels",
    category: "Activity",
    run: () => {
      workspace.setActiveActivity("explorer");
      openPanelSet(openToolWindow, LEFT_TOOL_WINDOW_IDS);
    }
  });
  commands.register({
    id: "activity.diagnosticPanels",
    title: "Open Diagnostic Panels",
    category: "Activity",
    run: () => {
      workspace.setActiveActivity("diagnose");
      openPanelSet(openToolWindow, DIAGNOSTIC_TOOL_WINDOW_IDS);
      workspace.setBottomPanelTab("problems");
    }
  });
  commands.register({
    id: "activity.reviewPanels",
    title: "Open Review Panels",
    category: "Activity",
    run: () => {
      workspace.setActiveActivity("review");
      openPanelSet(openToolWindow, REVIEW_TOOL_WINDOW_IDS);
    }
  });
  commands.register({
    id: "activity.corePanels",
    title: "Open Core Workspace Panels",
    category: "Activity",
    run: () => openPanelSet(openToolWindow, CORE_TOOL_WINDOW_IDS)
  });
  commands.register({
    id: "view.closeExplorerPanels",
    title: "Close Explorer Panels",
    category: "View: Tool Windows",
    enabled: (context) => hasAnyOpen(context.toolWindowOpen, LEFT_TOOL_WINDOW_IDS),
    run: () => closePanelSet(closeToolWindow, LEFT_TOOL_WINDOW_IDS)
  });
  commands.register({
    id: "view.closeInspectorPanels",
    title: "Close Right-Side Tool Panels",
    category: "View: Tool Windows",
    enabled: (context) => hasAnyOpen(context.toolWindowOpen, RIGHT_TOOL_WINDOW_IDS),
    run: () => closePanelSet(closeToolWindow, RIGHT_TOOL_WINDOW_IDS)
  });
  commands.register({
    id: "view.closeAllToolPanels",
    title: "Close All Tool Panels",
    category: "View: Tool Windows",
    enabled: (context) => hasAnyOpen(context.toolWindowOpen, [...LEFT_TOOL_WINDOW_IDS, ...RIGHT_TOOL_WINDOW_IDS]),
    run: () => closePanelSet(closeToolWindow, [...LEFT_TOOL_WINDOW_IDS, ...RIGHT_TOOL_WINDOW_IDS])
  });
  commands.register({
    id: "view.openViewerOnly",
    title: "Open 3D Canvas Only",
    category: "View: Tool Windows",
    run: () => {
      openToolWindow("viewer");
      closePanelSet(closeToolWindow, [...LEFT_TOOL_WINDOW_IDS, ...RIGHT_TOOL_WINDOW_IDS]);
    }
  });
  for (const tabId of BOTTOM_PANEL_TABS) {
    commands.register({
      id: `bottom.${tabId}`,
      title: tabId,
      category: "View: Bottom Panel",
      shortcut: BOTTOM_PANEL_SHORTCUTS[tabId],
      run: () => {
        workspace.setBottomPanelOpen(true);
        workspace.setBottomPanelTab(tabId);
      }
    });
  }
  commands.register({
    id: "bottom.toggle",
    title: "Toggle Bottom Panel",
    category: "View: Bottom Panel",
    shortcut: "Ctrl+J",
    run: () => workspace.setBottomPanelOpen(!workspace.bottomPanelOpen)
  });
  commands.register({
    id: "bottom.nextTab",
    title: "Next Bottom Panel Tab",
    category: "View: Bottom Panel",
    shortcut: "Ctrl+PageDown",
    run: () => {
      const index = BOTTOM_PANEL_TABS.indexOf(workspace.bottomPanelTab);
      workspace.setBottomPanelTab(BOTTOM_PANEL_TABS[(index + 1 + BOTTOM_PANEL_TABS.length) % BOTTOM_PANEL_TABS.length]);
    }
  });
  commands.register({
    id: "bottom.previousTab",
    title: "Previous Bottom Panel Tab",
    category: "View: Bottom Panel",
    shortcut: "Ctrl+PageUp",
    run: () => {
      const index = BOTTOM_PANEL_TABS.indexOf(workspace.bottomPanelTab);
      workspace.setBottomPanelTab(BOTTOM_PANEL_TABS[(index - 1 + BOTTOM_PANEL_TABS.length) % BOTTOM_PANEL_TABS.length]);
    }
  });
  commands.register({
    id: "bottom.show",
    title: "Show Bottom Panel",
    category: "View: Bottom Panel",
    visible: (context) => !context.bottomPanelOpen,
    run: () => workspace.setBottomPanelOpen(true)
  });
  commands.register({
    id: "bottom.hide",
    title: "Hide Bottom Panel",
    category: "View: Bottom Panel",
    visible: (context) => !!context.bottomPanelOpen,
    run: () => workspace.setBottomPanelOpen(false)
  });
  commands.register({
    id: "bottom.copyCurrentJson",
    title: "Copy Current Bottom Panel as JSON",
    category: "View: Bottom Panel",
    shortcut: "Ctrl+Alt+B",
    run: () => {
      void copyText(JSON.stringify(getBottomPanelPayload(workspace, workspace.bottomPanelTab), null, 2));
    }
  });
  commands.register({
    id: "bottom.clearCurrent",
    title: "Clear Current Bottom Panel",
    category: "View: Bottom Panel",
    shortcut: "Ctrl+Alt+Shift+B",
    enabled: () => canClearBottomPanel(workspace, workspace.bottomPanelTab),
    run: () => clearBottomPanel(workspace, workspace.bottomPanelTab)
  });
  commands.register({
    id: "bottom.copyOutputJson",
    title: "Copy Output as JSON",
    category: "View: Bottom Panel",
    enabled: () => workspace.outputEntries.length > 0,
    run: () => {
      void copyText(JSON.stringify(getBottomPanelPayload(workspace, "output"), null, 2));
    }
  });
  commands.register({
    id: "bottom.clearOutput",
    title: "Clear Output",
    category: "View: Bottom Panel",
    enabled: () => workspace.outputEntries.length > 0,
    run: () => workspace.clearOutput()
  });
  commands.register({
    id: "bottom.copyEventsJson",
    title: "Copy Events as JSON",
    category: "View: Bottom Panel",
    enabled: () => workspace.eventEntries.length > 0,
    run: () => {
      void copyText(JSON.stringify(getBottomPanelPayload(workspace, "events"), null, 2));
    }
  });
  commands.register({
    id: "bottom.clearEvents",
    title: "Clear Events",
    category: "View: Bottom Panel",
    enabled: () => workspace.eventEntries.length > 0,
    run: () => workspace.clearEvents()
  });
  commands.register({
    id: "bottom.copyTasksJson",
    title: "Copy Tasks as JSON",
    category: "View: Bottom Panel",
    enabled: () => workspace.taskEntries.length > 0,
    run: () => {
      void copyText(JSON.stringify(getBottomPanelPayload(workspace, "tasks"), null, 2));
    }
  });
  commands.register({
    id: "bottom.clearTasks",
    title: "Clear Tasks",
    category: "View: Bottom Panel",
    enabled: () => workspace.taskEntries.length > 0,
    run: () => workspace.clearTasks()
  });
  commands.register({
    id: "bottom.increaseHeight",
    title: "Increase Bottom Panel Height",
    category: "View: Bottom Panel",
    shortcut: "Ctrl+Alt+=",
    run: () => {
      workspace.setBottomPanelOpen(true);
      workspace.setBottomPanelHeight(workspace.bottomPanelHeight + 48);
    }
  });
  commands.register({
    id: "bottom.decreaseHeight",
    title: "Decrease Bottom Panel Height",
    category: "View: Bottom Panel",
    shortcut: "Ctrl+Alt+-",
    enabled: () => workspace.bottomPanelOpen,
    run: () => workspace.setBottomPanelHeight(workspace.bottomPanelHeight - 48)
  });
  commands.register({
    id: "bottom.maximizeHeight",
    title: "Maximize Bottom Panel Height",
    category: "View: Bottom Panel",
    run: () => {
      workspace.setBottomPanelOpen(true);
      workspace.setBottomPanelHeight(420);
    }
  });
  commands.register({
    id: "bottom.minimizeHeight",
    title: "Minimize Bottom Panel Height",
    category: "View: Bottom Panel",
    run: () => {
      workspace.setBottomPanelOpen(true);
      workspace.setBottomPanelHeight(112);
    }
  });
}

function getBottomPanelPayload(workspace: any, tabId: string): unknown {
  if (tabId === "problems") {
    return {
      tab: "problems",
      diagnostics: workspace.eventEntries.filter((entry: any) => entry.level === "warning" || entry.level === "error")
    };
  }
  if (tabId === "events") {
    return {tab: "events", events: workspace.eventEntries};
  }
  if (tabId === "tasks") {
    return {tab: "tasks", tasks: workspace.taskEntries};
  }
  return {tab: "output", output: workspace.outputEntries};
}

function canClearBottomPanel(workspace: any, tabId: string): boolean {
  return tabId === "events"
    ? workspace.eventEntries.length > 0
    : tabId === "tasks"
      ? workspace.taskEntries.length > 0
      : tabId === "output"
        ? workspace.outputEntries.length > 0
        : false;
}

function clearBottomPanel(workspace: any, tabId: string): void {
  if (tabId === "events") {
    workspace.clearEvents();
  } else if (tabId === "tasks") {
    workspace.clearTasks();
  } else if (tabId === "output") {
    workspace.clearOutput();
  }
}

function openPanelSet(openToolWindow: (panelId: string) => void, panelIds: readonly string[]): void {
  for (const panelId of panelIds) {
    openToolWindow(panelId);
  }
}

function closePanelSet(closeToolWindow: (panelId: string) => void, panelIds: readonly string[]): void {
  for (const panelId of panelIds) {
    closeToolWindow(panelId);
  }
}

function hasAnyOpen(toolWindowOpen: Record<string, boolean> | undefined, panelIds: readonly string[]): boolean {
  return panelIds.some((panelId) => !!toolWindowOpen?.[panelId]);
}

function formatTitle(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
