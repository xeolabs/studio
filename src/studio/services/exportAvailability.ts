import type {ExportDataSet} from "./exportDialogDataSets";
import {exportCoordinateSystemIssue, type ExportCoordinateSource} from "./exportCoordinateSystems";
import type {ExportContent} from "./exportContent";
import {exportFormatIssue} from "./exportFormatCompatibility";

export function exportSelectionIssue(dataSet: ExportDataSet, sceneCount: number, dataCount: number, sceneModels: readonly ExportCoordinateSource[] = [], content?: ExportContent): string {
  if (dataSet.disabled) return dataSet.disabledReason || "This export format is unavailable.";
  if (!sceneCount) return "Select at least one SceneModel for the geometry output.";
  if (dataSet.dataExtension && !dataCount) return "Select a DataModel or choose a scene-only output format.";
  if (!dataSet.dataExtension && !dataSet.nativeData && dataCount) return "This output format does not include the selected DataModels.";
  return exportCoordinateSystemIssue(sceneModels) || (content ? exportFormatIssue(dataSet, content, dataCount) : "");
}
