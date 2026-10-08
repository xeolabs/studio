import type {BundledStreamState} from "../services/BundledModelsService";
import type {LoadedModel} from "../services/LoadedModelsService";
import type {ObjectSelectionDetails} from "../services/ObjectSelectionDetails";
import type {RendererMode} from "../services/RendererService";
import type {WorkspaceLayout} from "../layout/observeWorkspaceLayout";

import {createSavedViewsState} from "./savedViewsState";
import {createMeasurementState} from "./measurementState";
import {createSectionState} from "./sectionState";

export type InspectorSource = "toolbar" | "data" | "ifc" | "ifcStoreys" | "ifcTypes" | "scene" | "viewer";

export interface InspectorContext {
  source: InspectorSource;
  title: string;
  kind: string;
  detail: string;
  sceneObjectId?: string;
}

export interface OutputLogEntry {
  id: number;
  timestamp: string;
  channel: string;
  message: string;
}

export type StudioEventLevel = "info" | "warning" | "error";

export interface StudioEventEntry {
  id: number;
  timestamp: string;
  source: string;
  eventName: string;
  level: StudioEventLevel;
  message: string;
}

export type StudioTaskStatus = "running" | "success" | "error" | "cancelled";

export interface StudioTaskEntry {
  id: number;
  title: string;
  detail: string;
  status: StudioTaskStatus;
  startedAt: string;
  finishedAt: string;
}

const DEFAULT_INSPECTOR_CONTEXT: InspectorContext = {
  source: "data",
  title: "Building",
  kind: "Explorer",
  detail: "Tap an element in the model, or choose one in Explore or Floors, to see its properties."
};

export function createWorkspaceStore(Pinia: any) {
  return Pinia.defineStore("studioWorkspace", {
    state: () => ({
      status: "Loading Studio viewer...",
      loaded: false,
      projectName: "Studio",
      bundledStreams: [] as BundledStreamState[],
      loadedModels: [] as LoadedModel[],
      modelsExpanded: true,
      rendererMode: "webgpu" as RendererMode,
      rendererSwitching: false,
      rendererError: "",
      activeActivity: "explorer",
      layoutMode: "wide" as WorkspaceLayout,
      responsivePanelId: "",
      explorePanelId: "ifcStructure",
      isolationLabel: "",
      toolMode: "select" as "select" | "hide" | "xray" | "measure",
      measurements: createMeasurementState(),
      savedViews: createSavedViewsState(),
      history: {canUndo: false, canRedo: false, undoLabel: "", redoLabel: "", revision: 0},
      section: createSectionState(),
      inspectorVisible: false,
      responsivePanelSize: "half" as "peek" | "half" | "expanded",
      inspectorSession: {
        activeTab: "details", scrollTop: 0, objectId: "", advancedOpen: false,
        propertyQuery: "", collapsedPropertySets: {} as Record<string, boolean>
      },
      toolWindowOpen: {
        viewer: true,
        data: false,
        ifcStructure: false,
        ifcStoreys: false,
        ifcTypes: false,
        scene: false,
        viewerExplorer: false,
        inspector: false,
        section: false,
        "runtime-overview": false,
        "diagnostic-center": false,
        boundaries: false,
        diagnostics: false,
        "sun-study": false,
        "data-health": false,
        "scene-health": false,
        tiles: false
      } as Record<string, boolean>,
      bottomPanelOpen: false,
      bottomPanelTab: "output",
      bottomPanelHeight: 180,
      commandPaletteOpen: false,
      outputEntries: [] as OutputLogEntry[],
      eventEntries: [] as StudioEventEntry[],
      taskEntries: [] as StudioTaskEntry[],
      nextOutputEntryId: 1,
      nextEventEntryId: 1,
      nextTaskEntryId: 1,
      statusItems: [
        {id: "selection", label: "0 selected"},
        {id: "models", label: "0 models"},
        {id: "objects", label: "0 objects"}
      ],
      inspectorContext: {...DEFAULT_INSPECTOR_CONTEXT} as InspectorContext,
      selectedObjectDetails: null as ObjectSelectionDetails | null
    }),
    actions: {
      setLayoutMode(mode: WorkspaceLayout) {
        this.layoutMode = mode;
      },
      setResponsivePanelSize(size: "peek" | "half" | "expanded") {
        this.responsivePanelSize = size;
      },
      setResponsivePanel(panelId: string) {
        if (panelId && panelId !== this.responsivePanelId) this.responsivePanelSize = "half";
        else if (panelId && this.responsivePanelSize === "peek") this.responsivePanelSize = "half";
        this.responsivePanelId = panelId;
        if (this.layoutMode !== "wide") {
          for (const id of Object.keys(this.toolWindowOpen)) {
            this.toolWindowOpen[id] = id === "viewer" || id === panelId;
          }
        }
      },
      setStatus(status: string) {
        this.status = status;
      },
      setLoaded(loaded: boolean) {
        this.loaded = loaded;
      },
      setProjectName(projectName: string) {
        this.projectName = projectName;
      },
      setRendererMode(mode: RendererMode) {
        this.rendererMode = mode;
      },
      setRendererSwitching(switching: boolean) {
        this.rendererSwitching = switching;
      },
      setRendererError(error: string) {
        this.rendererError = error;
      },
      setActiveActivity(activityId: string) {
        this.activeActivity = activityId;
      },
      setToolWindowOpen(panelId: string, open: boolean) {
        this.toolWindowOpen[panelId] = open;
      },
      setBottomPanelOpen(open: boolean) {
        this.bottomPanelOpen = open;
      },
      setBottomPanelHeight(height: number) {
        this.bottomPanelHeight = Math.max(112, Math.min(420, Math.round(height)));
      },
      setBottomPanelTab(tabId: string) {
        this.bottomPanelTab = tabId;
        this.bottomPanelOpen = true;
      },
      setCommandPaletteOpen(open: boolean) {
        this.commandPaletteOpen = open;
      },
      appendOutput(message: string, channel = "Studio") {
        this.outputEntries.unshift({
          id: this.nextOutputEntryId++,
          timestamp: new Date().toISOString(),
          channel,
          message
        });
        if (this.outputEntries.length > 100) {
          this.outputEntries.splice(100);
        }
      },
      clearOutput() {
        this.outputEntries = [];
      },
      appendEvent(source: string, eventName: string, message: string, level: StudioEventLevel = "info") {
        this.eventEntries.unshift({
          id: this.nextEventEntryId++,
          timestamp: new Date().toISOString(),
          source,
          eventName,
          level,
          message
        });
        if (this.eventEntries.length > 200) {
          this.eventEntries.splice(200);
        }
      },
      clearEvents() {
        this.eventEntries = [];
      },
      startTask(title: string, detail = ""): number {
        const id = this.nextTaskEntryId++;
        this.taskEntries.unshift({
          id,
          title,
          detail,
          status: "running",
          startedAt: new Date().toISOString(),
          finishedAt: ""
        });
        if (this.taskEntries.length > 100) {
          this.taskEntries.splice(100);
        }
        return id;
      },
      clearTasks() {
        this.taskEntries = [];
      },
      updateTask(id: number, detail: string) {
        const task = this.taskEntries.find((entry) => entry.id === id);
        if (task) {
          task.detail = detail;
        }
      },
      finishTask(id: number, status: StudioTaskStatus, detail = "") {
        const task = this.taskEntries.find((entry) => entry.id === id);
        if (!task) {
          return;
        }
        task.status = status;
        if (detail) {
          task.detail = detail;
        }
        task.finishedAt = new Date().toISOString();
      },
      setStatusItems(items: Array<{id: string; label: string}>) {
        this.statusItems = items;
      },
      setInspectorContext(context: InspectorContext) {
        this.inspectorContext = context;
      },
      setSelectedObjectDetails(details: ObjectSelectionDetails | null) {
        this.selectedObjectDetails = details;
      }
    }
  });
}
