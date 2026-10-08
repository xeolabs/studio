import type {SDKResult} from "@xeokit/sdk/base/core";
import {createUUID} from "@xeokit/sdk/base/utils";
import {Data, type DataModel} from "@xeokit/sdk/model/data";
import {Scene, type CoordinateSystemParams, type SceneModel} from "@xeokit/sdk/model/scene";
import type {LoaderProgress} from "@xeokit/sdk/formats";
import type {LoaderRegistry} from "../importing/LoaderRegistry";
import type {ImportDataSet} from "../importing/ImportDataSet";
import type {ImportDataSetFile} from "../importing/ImportDataSetFile";
import {createLazyLoaderRegistry} from "./importLoaderRegistry";
import {fetchAs, readFileAs} from "./importSourceReading";
import {createSlots} from "./importSlots";
import {acceptsSource, assignImportSources, detectImportDataSet} from "./importSourceDetection";
import {importValidation} from "./importValidation";
import type {ImportDialogState, ImportSource, ImportSourceMode} from "./importDialogState";
import {importConflicts, commitImport, requireValue, type PreparedImport, type ImportConflict} from "./importTransaction";
import {importTitle} from "./modelNames";
export {createImportDialogState} from "./importDialogState";
export type {ImportDialogState, ImportFileSlotState} from "./importDialogState";

export interface ImportDialogServiceParams {
  scene: Scene;
  data: Data;
  state: ImportDialogState;
  loaders?: LoaderRegistry;
  onLoaded?: (result: ImportLoadResult) => void;
  getModels?: () => ImportConflict[];
  beforeReplace?: (models: ImportConflict[]) => void;
}
export interface ImportLoadResult {
  modelId: string;
  dataSet: ImportDataSet;
  sceneModel?: SceneModel;
  dataModel?: DataModel;
  frameAfterImport: boolean;
  title?: string;
}

/** Owns import drafts and execution. Vue renders projections; it never invokes loaders. */
export class ImportDialogService {
  private readonly _loaders: LoaderRegistry;
  private readonly _state: ImportDialogState;
  private prepared: PreparedImport | null = null;
  constructor(private readonly params: ImportDialogServiceParams) {
    this._state = params.state;
    this._loaders = params.loaders ?? createLazyLoaderRegistry();
  }

  get activeDataSet(): ImportDataSet | undefined {
    return this._state.dataSets.find(d => d.id === this._state.dataSetId);
  }
  open(): void {
    if (!this._state.open) this.setDataSet("");
    this._state.open = true;
  }
  close(): void { this.cancelReplacement(); this._state.open = false; }

  cancelReplacement(): void { this.prepared = null; this._state.conflicts = []; }
  replaceExisting(): void {
    if (!this.prepared || this._state.loading) return;
    const prepared = this.prepared;
    const conflicts = importConflicts(this.params.scene, this.params.data, prepared, this.params.getModels?.());
    // Recheck at the decision point; imports may have changed while the prompt was open.
    if (conflicts.some(c => !this._state.conflicts.some(old => old.sceneModelId === c.sceneModelId && old.dataModelId === c.dataModelId))) {
      this._state.conflicts = conflicts; return;
    }
    this._state.loading = true;
    try {
      this.params.beforeReplace?.(conflicts);
      this.commit(prepared, conflicts);
      this.cancelReplacement();
    } catch (error) {
      this._state.errorText = "Could not replace the model.";
      this._state.errorDetails = String(error);
      this._state.statusText = "Existing models were kept.";
      this.cancelReplacement();
    } finally { this._state.loading = false; }
  }

  setDataSet(id: string): void {
    if (this._state.loading) return;
    this._state.formatOverride = !!id;
    this._state.dataSetId = id;
    // Preserve every source, but resolve roles again for the new format.
    this.activeSources.forEach(source => { source.slotKey = ""; });
    this.reconcile();
  }
  setSourceMode(mode: ImportSourceMode): void {
    if (this._state.loading) return;
    this._state.sourceMode = mode;
    this.reconcile();
  }
  addFiles(files: File[]): void {
    if (this._state.loading) return;
    this._state.sourceMode = "file";
    for (const file of files) {
      this._state.sources.push({id: createUUID(), mode: "file", file, name: file.name, url: "", slotKey: ""});
    }
    this.reconcile();
  }
  addUrl(url: string): void {
    if (this._state.loading || !url.trim()) return;
    this._state.sourceMode = "url";
    this._state.sources.push({id: createUUID(), mode: "url", file: null, name: "", url: url.trim(), slotKey: ""});
    this.reconcile();
  }
  removeSource(id: string): void {
    if (this._state.loading) return;
    this._state.sources = this._state.sources.filter(source => source.id !== id);
    this.reconcile();
  }
  assignSource(id: string, key: string): void {
    if (this._state.loading) return;
    const source = this.activeSources.find(s => s.id === id);
    const spec = this.activeDataSet?.files.find(s => s.key === key);
    if (!source || !spec || !acceptsSource(spec, source)) return;
    this.activeSources.forEach(s => { if (s.slotKey === key) s.slotKey = ""; });
    source.slotKey = key;
    this.reconcile();
  }
  replaceSource(id: string, file: File): void {
    if (this._state.loading) return;
    const source = this._state.sources.find(s => s.id === id);
    if (!source) return;
    source.file = file; source.name = file.name;
    this.reconcile();
  }
  updateUrl(id: string, url: string): void {
    if (this._state.loading) return;
    const source = this._state.sources.find(s => s.id === id);
    if (source) { source.url = url.trim(); this.reconcile(); }
  }
  setSlotFile(key: string, file: File | null): void {
    if (this._state.loading) return;
    const source = this.activeSources.find(s => s.slotKey === key);
    if (source && !file) this.removeSource(source.id);
    else if (source && file) this.replaceSource(source.id, file);
    else if (file) {
      this._state.sources.push({id: createUUID(), mode: "file", file, name: file.name, url: "", slotKey: key});
      this.reconcile();
    }
  }
  setSlotUrl(key: string, url: string): void {
    if (this._state.loading) return;
    const source = this.activeSources.find(s => s.slotKey === key);
    if (source) this.updateUrl(source.id, url);
    else {
      this._state.sources.push({id: createUUID(), mode: "url", file: null, name: "", url, slotKey: key});
      this.reconcile();
    }
  }
  setOrigin(axis: 0 | 1 | 2, value: unknown): void {
    if (this._state.loading) return;
    this._state.origin[axis] = value === null || value === "" ? NaN : Number(value);
  }
  reset(): void {
    if (this._state.loading) return;
    this._state.sources = []; this._state.formatOverride = false; this._state.dataSetId = "";
    this.reconcile();
  }
  canLoad(): boolean { return !this._state.loading && !this._state.result && !this._state.conflicts.length && !importValidation(this._state).message; }

  async load(): Promise<void> {
    if (!this.canLoad()) return;
    const state = this._state, dataSet = this.activeDataSet!;
    const sources = this.activeSources.map(source => ({...source}));
    const modelId = state.plannedModelId, coordinateSystem = this.resolveCoordinateSystem();
    const frameAfterImport = state.frameAfterImport, coordinateMode = state.coordinateMode;
    state.loading = true; state.errorText = ""; state.errorDetails = ""; state.sourceErrors = {};
    state.statusText = "Checking model...";
    const stagingScene = new Scene({coordinateSystem: this.params.scene.coordinateSystem.toParams()}), stagingData = new Data();
    let sceneModel: SceneModel | undefined, dataModel: DataModel | undefined, activeSource: ImportSource | undefined;
    const notices = new Set<string>();
    const onError = (_sender: unknown, result: SDKResult<unknown>) => {
      if (result.ok === false && notices.size < 20) notices.add(result.error);
    };
    const unsubscribe = [stagingScene.events.onError.subscribe(onError), stagingData.events.onError.subscribe(onError)];
    try {
      if (dataSet.loadsSceneGeometry !== false) sceneModel = requireValue(stagingScene.createModel({id: modelId, coordinateSystem, updateMode: state.updateMode}));
      if (dataSet.loadsDataSemantics !== false) dataModel = requireValue(stagingData.createModel({id: modelId}));
      const specs = [...dataSet.files].sort((a, b) => Number(b.loadFormat === "mtl") - Number(a.loadFormat === "mtl"));
      for (const spec of specs) {
        activeSource = sources.find(source => source.slotKey === spec.key);
        if (activeSource) await this.loadSource(spec, activeSource, sceneModel, dataModel);
      }
      if (sceneModel && coordinateMode === "override" && coordinateSystem) sceneModel.coordinateSystem.fromParams(coordinateSystem);
      // Loaders can report a failure through SDK events while resolving their promise.
      if (notices.size) throw new Error([...notices].join("\n"));
      if (sceneModel && !Object.keys(sceneModel.objects).length) notices.add("No SceneObjects were created by this import.");
      if (dataModel && !Object.keys(dataModel.objects).length) notices.add("No DataObjects were created by this import.");
      const prepared: PreparedImport = {modelId, title: importTitle(sources),
        scene: sceneModel ? requireValue(sceneModel.toParams()) : undefined,
        data: dataModel ? requireValue(dataModel.toParams()) : undefined, warnings: [...notices], frameAfterImport};
      const conflicts = importConflicts(this.params.scene, this.params.data, prepared, this.params.getModels?.());
      if (conflicts.length) {
        this.prepared = prepared; state.conflicts = conflicts;
        state.statusText = "This import contains elements that are already loaded.";
        state.open = true;
      } else this.commit(prepared);
    } catch (error) {
      state.errorText = `Could not import ${activeSource?.name || activeSource?.url || dataSet.label}.`;
      state.errorDetails = error instanceof Error ? error.message : String(error);
      if (activeSource) state.sourceErrors[activeSource.id] = "Check the source and selected format.";
      state.statusText = "Import failed. Existing models were kept.";
    } finally {
      unsubscribe.forEach(stop => stop());
      stagingScene.destroy(); stagingData.destroy();
      state.loading = false;
    }
  }

  private commit(prepared: PreparedImport, conflicts: ImportConflict[] = []): void {
    const {sceneModel, dataModel} = commitImport(this.params.scene, this.params.data, prepared, conflicts);
    const state = this._state, dataSet = this.activeDataSet!;
    state.loadedModelId = prepared.modelId;
    state.result = {modelId: prepared.modelId, label: prepared.title, scene: !!sceneModel, data: !!dataModel,
      sceneObjects: Object.keys(sceneModel?.objects || {}).length, dataObjects: Object.keys(dataModel?.objects || {}).length,
      warnings: prepared.warnings};
    state.statusText = `Imported ${prepared.title}.`;
    try { this.params.onLoaded?.({modelId: prepared.modelId, title: prepared.title, dataSet, sceneModel, dataModel, frameAfterImport: prepared.frameAfterImport}); }
    catch (error) { state.result.warnings.push(`Imported successfully, but navigation failed: ${String(error)}`); }
  }

  private get activeSources(): ImportSource[] { return this._state.sources.filter(s => s.mode === this._state.sourceMode); }

  private reconcile(): void {
    this.cancelReplacement();
    const state = this._state;
    const previous = state.dataSetId;
    if (!state.formatOverride) state.dataSetId = detectImportDataSet(this.activeSources, state.dataSets);
    const dataSet = this.activeDataSet;
    if (previous !== state.dataSetId && state.coordinateMode === "source") state.basisId = dataSet?.defaultBasisId || "z-up";
    assignImportSources(this.activeSources, dataSet);
    state.slots = dataSet ? createSlots(dataSet) : {};
    for (const source of this.activeSources) {
      const slot = state.slots[source.slotKey];
      if (slot) Object.assign(slot, {file: source.file, fileName: source.name, url: source.url});
    }
    state.errorText = ""; state.errorDetails = ""; state.sourceErrors = {}; state.result = null; state.statusText = "";
    const first = this.activeSources[0];
    const name = first?.name || first?.url.split("/").pop() || "model";
    const stem = name.replace(/[?#].*$/, "").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-") || "model";
    state.plannedModelId = first ? `${stem}-${createUUID().slice(0, 8)}` : "";
  }

  private resolveCoordinateSystem(): CoordinateSystemParams | undefined {
    if (this.activeDataSet?.loadsSceneGeometry === false) return undefined;
    if (this._state.coordinateMode === "source") {
      const basis = this._state.bases.find(b => b.id === this.activeDataSet?.defaultBasisId)?.basis;
      return basis ? {basis, units: "meters", origin: [0, 0, 0]} : undefined;
    }
    return {basis: this._state.bases.find(b => b.id === this._state.basisId)!.basis!,
      units: this._state.units, origin: [...this._state.origin]};
  }

  private async loadSource(spec: ImportDataSetFile, source: ImportSource,
    sceneModel?: SceneModel, dataModel?: DataModel): Promise<void> {
    const descriptor = this._loaders.get(spec.loadFormat);
    if (!descriptor) throw new Error(`Unsupported import format: ${spec.loadFormat}`);
    const label = source.name || source.url;
    this._state.statusText = `${source.mode === "file" ? "Reading" : "Downloading"} ${label}...`;
    const input = source.mode === "file" ? {fileData: await readFileAs(source.file!, descriptor.fetch), baseUri: undefined}
      : await fetchAs(source.url, descriptor.fetch);
    this._state.statusText = `Loading ${spec.label}...`;
    // Let the dialog paint before entering a parser that may not report progress.
    await new Promise(resolve => setTimeout(resolve, 0));
    const result = await descriptor.load({fileData: input.fileData,
      sceneModel: descriptor.needsScene ? sceneModel : undefined, dataModel: descriptor.needsData ? dataModel : undefined},
    {baseUri: input.baseUri, onProgress: (progress: LoaderProgress) => {
      this._state.statusText = `${spec.label}: ${progress.phase}${progress.total > 0 ? ` (${progress.current} / ${progress.total})` : ""}`;
    }});
    if (result?.ok === false) throw new Error(result.error);
  }
}
