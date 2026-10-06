import type {StudioActions} from "./types";

export interface ConnectStudioActionsParams {
  actions: StudioActions;
  dataHealthService: any;
  diagnosticsService: any;
  exportDialogService: any;
  importDialogService: any;
  sceneHealthService: any;
  sunStudyService: any;
  tilesService: any;
  workspace?: any;
}

export function connectStudioActions(params: ConnectStudioActionsParams): void {
  const {
    actions,
    dataHealthService,
    diagnosticsService,
    exportDialogService,
    importDialogService,
    sceneHealthService,
    sunStudyService,
    tilesService,
    workspace
  } = params;
  actions.importActions.open = () => importDialogService.open();
  actions.importActions.close = () => importDialogService.close();
  actions.importActions.setDataSet = (dataSetId: string) => importDialogService.setDataSet(dataSetId);
  actions.importActions.setSourceMode = (sourceMode: "file" | "url") => importDialogService.setSourceMode(sourceMode);
  actions.importActions.setSlotFile = (key: string, file: File | null) => importDialogService.setSlotFile(key, file);
  actions.importActions.setSlotUrl = (key: string, url: string) => importDialogService.setSlotUrl(key, url);
  actions.importActions.setOrigin = (axis: 0 | 1 | 2, value: unknown) => importDialogService.setOrigin(axis, value);
  actions.importActions.canLoad = () => importDialogService.canLoad();
  actions.importActions.addFiles = (files) => importDialogService.addFiles(files);
  actions.importActions.addUrl = (url) => importDialogService.addUrl(url);
  actions.importActions.removeSource = (id) => importDialogService.removeSource(id);
  actions.importActions.assignSource = (id, key) => importDialogService.assignSource(id, key);
  actions.importActions.replaceSource = (id, file) => importDialogService.replaceSource(id, file);
  actions.importActions.updateUrl = (id, url) => importDialogService.updateUrl(id, url);
  actions.importActions.reset = () => importDialogService.reset();
  actions.importActions.load = () => {
    return trackTask(workspace, "Import model", () => importDialogService.load(), () =>
      importDialogService._state?.errorText || importDialogService._state?.statusText || "Import finished.",
      () => !!importDialogService._state?.errorText);
  };

  actions.exportActions.open = () => exportDialogService.open();
  actions.exportActions.close = () => exportDialogService.close();
  actions.exportActions.refreshModels = () => exportDialogService.refreshModels();
  actions.exportActions.setDataSet = (dataSetId: string) => exportDialogService.setDataSet(dataSetId);
  actions.exportActions.toggleSceneModel = (modelId: string) => exportDialogService.toggleSceneModel(modelId);
  actions.exportActions.toggleDataModel = (modelId: string) => exportDialogService.toggleDataModel(modelId);
  actions.exportActions.setBaseName = value => exportDialogService.setBaseName(value);
  actions.exportActions.selectAll = kind => exportDialogService.selectAll(kind);
  actions.exportActions.clearSelection = kind => exportDialogService.clearSelection(kind);
  actions.exportActions.reset = () => exportDialogService.reset();
  actions.exportActions.downloadFile = filename => exportDialogService.downloadFile(filename);
  actions.exportActions.canExport = () => exportDialogService.canExport();
  actions.exportActions.exportSelected = () => {
    return trackTask(workspace, "Export models", () => exportDialogService.exportSelected(), () =>
      exportDialogService._state?.errorText || exportDialogService._state?.statusText || "Export finished.",
      () => !!exportDialogService._state?.errorText);
  };

  actions.dataHealthActions.selectModel = (modelId: string) => dataHealthService.selectModel(modelId);
  actions.dataHealthActions.queryFindings = (query) => dataHealthService.queryFindings(query);
  actions.dataHealthActions.cleanupCodes = (codes) => trackTask(workspace, "Apply Data health cleanups",
    () => dataHealthService.cleanupCodes(codes),
    () => dataHealthService._state?.lastCleanupSummary || "Data cleanup finished.",
    () => !!dataHealthService._state?.cleanupHistory[0]?.errors || !!dataHealthService._state?.inspectionError
  );
  actions.dataHealthActions.inspectSelected = () => {
    trackTask(workspace, "Inspect Data health", () => dataHealthService.inspectSelected(), () =>
      dataHealthService._state?.statusText || "Data health inspection finished."
    );
  };

  actions.tilesActions.refresh = () => tilesService.refresh();
  actions.tilesActions.copyJson = () => {
    void tilesService.copyTilesJson();
  };

  actions.diagnosticsActions.clear = () => diagnosticsService.clear();
  actions.diagnosticsActions.copyJson = () => {
    void diagnosticsService.copyJson();
  };
  actions.diagnosticsActions.copyEntry = (entry: any) => {
    void diagnosticsService.copyJson(entry);
  };

  actions.sunStudyActions.setPreset = (label: string) => sunStudyService.setPreset(label);
  actions.sunStudyActions.setLatitude = (value: unknown) => sunStudyService.setLatitude(value);
  actions.sunStudyActions.setLongitude = (value: unknown) => sunStudyService.setLongitude(value);
  actions.sunStudyActions.setNorthAngle = (value: unknown) => sunStudyService.setNorthAngle(value);
  actions.sunStudyActions.setDate = (value: string) => sunStudyService.setDate(value);
  actions.sunStudyActions.setMinutesUtc = (value: unknown) => sunStudyService.setMinutesUtc(value);
  actions.sunStudyActions.setNightExposureFactor = (value: unknown) => sunStudyService.setNightExposureFactor(value);
  actions.sunStudyActions.setMode = (mode: "day" | "year") => sunStudyService.setMode(mode);
  actions.sunStudyActions.setDurationSeconds = (value: unknown) => sunStudyService.setDurationSeconds(value);
  actions.sunStudyActions.togglePlayback = () => sunStudyService.togglePlayback();

  actions.sceneHealthActions.selectModel = (modelId: string) => sceneHealthService.selectModel(modelId);
  actions.sceneHealthActions.queryFindings = (query) => sceneHealthService.queryFindings(query);
  actions.sceneHealthActions.inspectSelected = () => {
    trackTask(workspace, "Inspect Scene health", () => sceneHealthService.inspectSelected(), () =>
      sceneHealthService._state?.statusText || "Scene health inspection finished."
    );
  };
  actions.sceneHealthActions.cleanupAll = () => {
    trackTask(workspace, "Clean up Scene health issues", () => sceneHealthService.cleanupAll(), () =>
      sceneHealthService._state?.lastCleanupSummary || sceneHealthService._state?.statusText || "Scene cleanup finished."
    );
  };
  actions.sceneHealthActions.cleanupCodes = (codes: string[]) => {
    return trackTask(
      workspace,
      `Clean up ${codes.length} Scene issue type${codes.length === 1 ? "" : "s"}`,
      () => sceneHealthService.cleanupCodes(codes, `Clean up: ${codes.join(", ")}`),
      () => sceneHealthService._state?.lastCleanupSummary || sceneHealthService._state?.statusText || "Scene cleanup finished.",
      () => !!sceneHealthService._state?.cleanupHistory[0]?.errors || !!sceneHealthService._state?.inspectionError
    );
  };
}

function trackTask(workspace: any, title: string, run: () => Promise<void>, detail: () => string, failed?: () => boolean): Promise<void> {
  if (!workspace?.startTask) {
    return run();
  }
  const taskId = workspace.startTask(title, "Running...");
  workspace.appendEvent?.("task", "started", title);
  return run()
    .then(() => {
      const message = detail();
      const isError = failed ? failed() : /failed|error/i.test(message);
      workspace.finishTask(taskId, isError ? "error" : "success", message);
      workspace.appendEvent?.("task", isError ? "failed" : "finished", `${title}: ${message}`, isError ? "error" : "info");
      workspace.appendOutput?.(message, "Tasks");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      workspace.finishTask(taskId, "error", message);
      workspace.appendEvent?.("task", "failed", `${title}: ${message}`, "error");
      workspace.appendOutput?.(message, "Tasks");
    });
}
