import type {ImportConflict} from "./importTransaction";
import type {CoordinateSystemParams, SceneModelUpdateMode} from "@xeokit/sdk/model/scene";
import {IMPORT_BASES} from "../importing/IMPORT_BASES";
import {IMPORT_DATA_SETS} from "../importing/IMPORT_DATA_SETS";
import type {ImportCoordSysBasis} from "../importing/ImportCoordSysBasis";
import type {ImportDataSet} from "../importing/ImportDataSet";

export type ImportSourceMode = "file" | "url";
export interface ImportSource {
  id: string;
  mode: ImportSourceMode;
  file: File | null;
  name: string;
  url: string;
  slotKey: string;
}
export interface ImportFileSlotState {key: string; file: File | null; fileName: string; url: string;}
export interface ImportResultSummary {
  modelId: string;
  label: string;
  scene: boolean;
  data: boolean;
  sceneObjects: number;
  dataObjects: number;
  warnings: string[];
}
export interface ImportDialogState {
  open: boolean;
  loading: boolean;
  sourceMode: ImportSourceMode;
  sources: ImportSource[];
  dataSetId: string;
  formatOverride: boolean;
  coordinateMode: "source" | "override";
  basisId: string;
  units: CoordinateSystemParams["units"];
  origin: [number, number, number];
  updateMode: Extract<SceneModelUpdateMode, "static" | "dynamic">;
  frameAfterImport: boolean;
  statusText: string;
  errorText: string;
  errorDetails: string;
  sourceErrors: Record<string, string>;
  loadedModelId: string;
  plannedModelId: string;
  result: ImportResultSummary | null;
  conflicts: ImportConflict[];
  slots: Record<string, ImportFileSlotState>;
  dataSets: ImportDataSet[];
  bases: ImportCoordSysBasis[];
  unitsOptions: CoordinateSystemParams["units"][];
  updateModes: Array<{id: "static" | "dynamic"; label: string}>;
}

export function createImportDialogState(): ImportDialogState {
  return {
    open: false, loading: false, sourceMode: "file", sources: [], dataSetId: "", formatOverride: false,
    coordinateMode: "source", basisId: "z-up", units: "meters", origin: [0, 0, 0], updateMode: "static",
    frameAfterImport: true, statusText: "", errorText: "", errorDetails: "", sourceErrors: {},
    loadedModelId: "", plannedModelId: "", result: null, conflicts: [], slots: {},
    dataSets: IMPORT_DATA_SETS, bases: IMPORT_BASES.filter(basis => !!basis.basis),
    unitsOptions: ["meters", "millimeters", "inches", "feet"],
    updateModes: [{id: "static", label: "Static"}, {id: "dynamic", label: "Dynamic"}],
  };
}
