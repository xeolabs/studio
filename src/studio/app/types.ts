import type {RendererMode} from "../services/RendererService";
import type {HealthFindingsReader} from "../services/HealthFindings";

export interface ImportActions {
  open(): void;
  close(): void;
  setDataSet(dataSetId: string): void;
  setSourceMode(sourceMode: "file" | "url"): void;
  setSlotFile(key: string, file: File | null): void;
  setSlotUrl(key: string, url: string): void;
  setOrigin(axis: 0 | 1 | 2, value: unknown): void;
  addFiles(files: File[]): void;
  addUrl(url: string): void;
  removeSource(id: string): void;
  assignSource(id: string, key: string): void;
  replaceSource(id: string, file: File): void;
  updateUrl(id: string, url: string): void;
  reset(): void;
  canLoad(): boolean;
  load(): Promise<void>;
}

export interface ExportActions {
  open(): void;
  close(): void;
  refreshModels(): void;
  setDataSet(dataSetId: string): void;
  toggleSceneModel(modelId: string): void;
  toggleDataModel(modelId: string): void;
  setBaseName(value: string): void;
  selectAll(kind: "scene" | "data"): void;
  clearSelection(kind: "scene" | "data"): void;
  reset(): void;
  downloadFile(filename: string): void;
  canExport(): boolean;
  exportSelected(): Promise<void>;
}

export interface RendererActions {
  switchTo(mode: RendererMode): Promise<void>;
}

export interface SceneHealthActions extends HealthFindingsReader {
  selectModel(modelId: string): void;
  inspectSelected(): void;
  cleanupAll(): void;
  cleanupCodes(codes: string[]): Promise<void>;
}

export interface DataHealthActions extends HealthFindingsReader {
  selectModel(modelId: string): void;
  inspectSelected(): void;
  cleanupCodes(codes: string[]): Promise<void>;
}

export interface TilesActions {
  refresh(): void;
  copyJson(): void;
}

export interface DiagnosticsActions {
  clear(): void;
  copyJson(): void;
  copyEntry(entry: any): void;
}

export interface SunStudyActions {
  setPreset(label: string): void;
  setLatitude(value: unknown): void;
  setLongitude(value: unknown): void;
  setNorthAngle(value: unknown): void;
  setDate(value: string): void;
  setMinutesUtc(value: unknown): void;
  setNightExposureFactor(value: unknown): void;
  setMode(mode: "day" | "year"): void;
  setDurationSeconds(value: unknown): void;
  togglePlayback(): void;
}

export interface ExplorerHostActions {
  mounted(source: ExplorerSource, container: HTMLElement): void;
  unmounted(source: ExplorerSource, container: HTMLElement): void;
}

export interface ViewerHostActions {
  mounted(container: HTMLElement, panel: HTMLElement): void;
  unmounted(): void;
}

export interface StudioActions {
  dataHealthActions: DataHealthActions;
  diagnosticsActions: DiagnosticsActions;
  explorerHostActions: ExplorerHostActions;
  exportActions: ExportActions;
  importActions: ImportActions;
  rendererActions: RendererActions;
  sceneHealthActions: SceneHealthActions;
  sunStudyActions: SunStudyActions;
  tilesActions: TilesActions;
  viewerHostActions: ViewerHostActions;
}

export interface StudioPanelStates {
  aabbPanelState: any;
  contextMenuState: any;
  dataHealthPanelState: any;
  diagnosticsPanelState: any;
  exportDialogState: any;
  importDialogState: any;
  sceneHealthPanelState: any;
  sunStudyPanelState: any;
  tilesPanelState: any;
}

export interface StudioStateContext extends StudioPanelStates {
  commands: any;
  contextMenuService: any;
  pinia: any;
  workspace: any;
}
import type {ExplorerSource} from "../explorers/types";
