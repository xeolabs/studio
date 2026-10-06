import {EXPORT_DATA_SETS, type ExportDataSet} from "./exportDialogDataSets";
import type {ExportModelOption, ExportSceneModelOption} from "./exportModelOptions";
import type {ExportOutputFile} from "./exportOutputPlan";
import {inspectExportContent, type ExportContent} from "./exportContent";

export interface ExportScope {
  sceneModels: number;
  dataModels: number;
  sceneObjects: number;
  dataObjects: number;
}

export interface ExportFileResult {
  filename: string;
  kind: ExportOutputFile["kind"];
  bytes: number;
  downloadStarted: boolean;
  downloadError: string;
}

export interface ExportResult {
  format: string;
  scope: ExportScope;
  files: ExportFileResult[];
  notices: string[];
}

/** UI projections only. Generated file buffers stay in ExportDialogService. */
export interface ExportDialogState {
  open: boolean;
  loading: boolean;
  dataSetId: string;
  baseName: string;
  selectedSceneModelIds: string[];
  selectedDataModelIds: string[];
  scope: ExportScope;
  statusText: string;
  content: ExportContent;
  errorText: string;
  errorDetails: string;
  lastExportedFiles: string[];
  result: ExportResult | null;
  dataSets: ExportDataSet[];
  sceneModels: ExportSceneModelOption[];
  dataModels: ExportModelOption[];
}

export function createExportDialogState(): ExportDialogState {
  return {
    open: false, loading: false, dataSetId: EXPORT_DATA_SETS[0].id, baseName: "",
    selectedSceneModelIds: [], selectedDataModelIds: [],
    scope: {sceneModels: 0, dataModels: 0, sceneObjects: 0, dataObjects: 0},
    content: inspectExportContent([], []),
    statusText: "", errorText: "", errorDetails: "", lastExportedFiles: [], result: null,
    dataSets: EXPORT_DATA_SETS, sceneModels: [], dataModels: []
  };
}
