import type {Data, DataModel} from "@xeokit/sdk/model/data";
import type {Scene, SceneModel} from "@xeokit/sdk/model/scene";
import type {ModelExportOptions} from "@xeokit/sdk/formats";
import {downloadBlob} from "./exportDownloads";
import {exportFormatsForSelection, type ExportDataSet} from "./exportDialogDataSets";
import type {ExportDialogState, ExportScope} from "./exportDialogState";
import {exportSelectionIssue} from "./exportAvailability";
import {defaultExportBaseName, exportFilenameIssue} from "./exportOutputPlan";
import {dataModelOption, pickById, retainExistingSelection, sceneModelOption, toggleId} from "./exportModelOptions";
import {prepareExportDataModel, prepareExportSceneModel} from "./prepareExportModels";
import {writeExportFiles, type ExportDownload} from "./writeExportFiles";
import {inspectExportContent} from "./exportContent";
import {exportFormatNotices} from "./exportFormatCompatibility";

export {createExportDialogState} from "./exportDialogState";
export type {ExportDialogState} from "./exportDialogState";

export interface ExportDialogServiceParams { scene: Scene; data: Data; state: ExportDialogState; }

export class ExportDialogService {
  private readonly _scene: Scene;
  private readonly _data: Data;
  private readonly _state: ExportDialogState;
  private _sceneSelectionInitialized = false;
  private _dataSelectionInitialized = false;
  private _customBaseName = false;
  private _files: ExportDownload[] = [];
  private _disposed = false;

  constructor(params: ExportDialogServiceParams) {
    this._scene = params.scene; this._data = params.data; this._state = params.state;
  }

  get activeDataSet(): ExportDataSet { return pickById(this._state.dataSets, this._state.dataSetId); }

  open(): void { this.refreshModels(); this._state.open = true; }
  close(): void { this._state.open = false; }

  refreshModels(): void {
    if (this._state.loading || this._disposed) return;
    const state = this._state;
    state.sceneModels = Object.values(this._scene.models).filter(model => !model.destroyed)
      .map(model => sceneModelOption(model, state.selectedSceneModelIds.includes(model.id)));
    state.dataModels = Object.values(this._data.models).filter(model => !model.destroyed)
      .map(model => dataModelOption(model, state.selectedDataModelIds.includes(model.id)));
    state.selectedSceneModelIds = retainExistingSelection(state.selectedSceneModelIds, state.sceneModels);
    state.selectedDataModelIds = retainExistingSelection(state.selectedDataModelIds, state.dataModels);
    if (!this._sceneSelectionInitialized && state.sceneModels.length) {
      if (!state.selectedSceneModelIds.length) state.selectedSceneModelIds = [state.sceneModels[0].id];
      this._sceneSelectionInitialized = true;
    }
    if (!this._dataSelectionInitialized && state.dataModels.length) {
      if (!state.selectedDataModelIds.length) state.selectedDataModelIds = [state.dataModels[0].id];
      this._dataSelectionInitialized = true;
    }
    this._updateProjection();
  }

  setDataSet(id: string): void {
    if (!this._canEdit()) return;
    const format = exportFormatsForSelection(this._state.dataSets, this._state.selectedDataModelIds.length).find(format => format.id === id);
    if (!format) return;
    this._state.dataSetId = id;
    this._clearError();
  }

  setBaseName(value: string): void {
    if (!this._canEdit()) return;
    this._customBaseName = true;
    this._state.baseName = value;
    this._clearError();
  }

  toggleSceneModel(id: string): void {
    if (!this._canEdit() || !this._scene.models[id] || this._scene.models[id].destroyed) return;
    this._sceneSelectionInitialized = true;
    this._state.selectedSceneModelIds = toggleId(this._state.selectedSceneModelIds, id);
    this._selectionChanged();
  }

  toggleDataModel(id: string): void {
    if (!this._canEdit() || !this._data.models[id] || this._data.models[id].destroyed) return;
    this._dataSelectionInitialized = true;
    this._state.selectedDataModelIds = toggleId(this._state.selectedDataModelIds, id);
    this._selectionChanged();
  }

  selectAll(kind: "scene" | "data"): void {
    if (!this._canEdit()) return;
    this.refreshModels();
    if (kind === "scene") this._state.selectedSceneModelIds = this._state.sceneModels.map(model => model.id);
    else this._state.selectedDataModelIds = this._state.dataModels.map(model => model.id);
    this._selectionChanged();
  }

  clearSelection(kind: "scene" | "data"): void {
    if (!this._canEdit()) return;
    if (kind === "scene") { this._sceneSelectionInitialized = true; this._state.selectedSceneModelIds = []; }
    else { this._dataSelectionInitialized = true; this._state.selectedDataModelIds = []; }
    this._selectionChanged();
  }

  reset(): void {
    if (this._state.loading || this._disposed) return;
    this._files = [];
    this._state.result = null;
    this._state.lastExportedFiles = [];
    this._state.statusText = "";
    this._clearError();
    this.refreshModels();
  }

  canExport(): boolean {
    const scenes = this._selectedSceneModels();
    return this._canEdit() && !exportSelectionIssue(this.activeDataSet, scenes.length, this._selectedDataModels().length, scenes, this._state.content)
      && !exportFilenameIssue(this._state.baseName);
  }

  async exportSelected(): Promise<void> {
    if (!this._canEdit()) return;
    this.refreshModels();
    const state = this._state;
    const scenes = this._selectedSceneModels(), data = this._selectedDataModels();
    const format = this.activeDataSet, baseName = state.baseName, scope = {...state.scope};
    const issue = exportSelectionIssue(format, scenes.length, data.length, scenes, state.content) || exportFilenameIssue(baseName);
    if (issue) { state.errorText = issue; return; }
    state.loading = true;
    this._clearError();
    state.statusText = "Preparing export...";
    state.lastExportedFiles = [];
    this._files = [];
    const notices = exportFormatNotices(format, state.content, data.length);
    const options: ModelExportOptions = {
      onProgress: progress => {
        if (!this._disposed) state.statusText = progress.phase + (progress.total > 0 ? ` (${progress.current}/${progress.total})` : "");
      },
      onWarning: message => { if (notices.length < 30 && !notices.includes(message)) notices.push(message); }
    };
    let disposeScene: (() => void) | undefined, disposeData: (() => void) | undefined;
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      state.statusText = `Preparing ${scenes.length} SceneModel(s)...`;
      const sceneInput = await prepareExportSceneModel(scenes, options);
      disposeScene = sceneInput.dispose;
      let dataModel: DataModel | undefined;
      if (data.length && (format.dataExtension || format.nativeData)) {
        state.statusText = `Preparing ${data.length} DataModel(s)...`;
        const dataInput = await prepareExportDataModel(data, options);
        disposeData = dataInput.dispose;
        dataModel = dataInput.model;
      }
      const files = await this._buildDownloads(format, sceneInput.model, dataModel, baseName, options);
      if (this._disposed) return;
      this._files = files;
      state.lastExportedFiles = files.map(file => file.filename);
      state.result = {format: format.label, scope, notices, files: files.map(file => ({
        filename: file.filename, kind: file.kind, bytes: file.blob.size, downloadStarted: false, downloadError: ""
      }))};
      for (const file of files) this.downloadFile(file.filename);
    } catch (error) {
      state.errorText = "Export failed. No files were downloaded.";
      state.errorDetails = error instanceof Error ? error.message : String(error);
      state.statusText = "Your model selections and output settings have been kept.";
    } finally {
      disposeScene?.(); disposeData?.();
      state.loading = false;
    }
  }

  downloadFile(filename: string): void {
    if (this._disposed) return;
    const file = this._files.find(file => file.filename === filename);
    const result = this._state.result?.files.find(file => file.filename === filename);
    if (!file || !result) return;
    try {
      downloadBlob(file.blob, filename);
      result.downloadStarted = true; result.downloadError = "";
    } catch (error) {
      result.downloadError = `Could not start download: ${error instanceof Error ? error.message : String(error)}`;
    }
    const files = this._state.result!.files;
    this._state.statusText = `Generated ${files.length} file${files.length === 1 ? "" : "s"}. `
      + (files.every(file => file.downloadStarted && !file.downloadError) ? (files.length === 1 ? "Download started." : "Downloads started.") : "Some downloads could not start.");
  }

  /** Release retained file buffers. In-flight work may finish but cannot start downloads after teardown. */
  dispose(): void { this._disposed = true; this._files = []; this._state.result = null; }

  private _buildDownloads(format: ExportDataSet, sceneModel: SceneModel, dataModel: DataModel | undefined, baseName: string, options: ModelExportOptions): Promise<ExportDownload[]> {
    return writeExportFiles(format, baseName, sceneModel, dataModel, options, message => { this._state.statusText = message; });
  }

  private _canEdit(): boolean { return !this._disposed && !this._state.loading && !this._state.result; }
  private _clearError(): void { this._state.errorText = ""; this._state.errorDetails = ""; }
  private _selectionChanged(): void { this._clearError(); this._updateProjection(); }

  private _selectedSceneModels(): SceneModel[] {
    return this._state.selectedSceneModelIds.map(id => this._scene.models[id]).filter(model => model && !model.destroyed);
  }

  private _selectedDataModels(): DataModel[] {
    return this._state.selectedDataModelIds.map(id => this._data.models[id]).filter(model => model && !model.destroyed);
  }

  private _updateProjection(): void {
    const state = this._state, scenes = this._selectedSceneModels(), data = this._selectedDataModels();
    for (const model of state.sceneModels) model.selected = state.selectedSceneModelIds.includes(model.id);
    for (const model of state.dataModels) model.selected = state.selectedDataModelIds.includes(model.id);
    // Count once per selection/list refresh, never during renderer updates or filename typing.
    const scope: ExportScope = {sceneModels: scenes.length, dataModels: data.length,
      sceneObjects: scenes.reduce((sum, model) => sum + Object.keys(model.objects).length, 0),
      dataObjects: new Set(data.flatMap(model => Object.keys(model.objects))).size};
    state.scope = scope;
    state.content = inspectExportContent(scenes, data);
    const formats = exportFormatsForSelection(state.dataSets, data.length);
    const suggested = formats.find(format => format.id === state.dataSetId)
      || formats.find(format => format.sceneFormat === this.activeDataSet.sceneFormat) || formats[0];
    if (suggested) state.dataSetId = suggested.id;
    if (!this._customBaseName) state.baseName = defaultExportBaseName(state.sceneModels.filter(model => model.selected));
  }
}
