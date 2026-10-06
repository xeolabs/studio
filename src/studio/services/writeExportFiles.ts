import type {DataModel} from "@xeokit/sdk/model/data";
import type {SceneModel} from "@xeokit/sdk/model/scene";
import type {ModelExportOptions} from "@xeokit/sdk/formats";
import type {ExportDataSet} from "./exportDialogDataSets";
import {exportOutputPlan, type ExportOutputFile} from "./exportOutputPlan";
import {getExportFormat} from "./exporters/exportFormatRegistry";
import {toBlob, toJsonBlob} from "./exportDownloads";

export interface ExportDownload extends ExportOutputFile { blob: Blob; }

/** Uses the same file plan as the UI, loading only the requested encoder and companions. */
export async function writeExportFiles(format: ExportDataSet, baseName: string, sceneModel: SceneModel, dataModel: DataModel | undefined,
  options: ModelExportOptions, status: (message: string) => void): Promise<ExportDownload[]> {
  const definition = getExportFormat(format.sceneFormat);
  const plan = exportOutputPlan(format, baseName);
  const sceneFile = plan[0], materialFile = plan.find(file => file.kind === "materials"), dataFile = plan.find(file => file.kind === "data");
  if (dataFile && !dataModel) throw new Error("The selected output format requires a DataModel.");
  status(`Loading ${definition.label} exporter...`);
  const exporter = await definition.load();
  const encoderOptions = {...options, ...(materialFile ? {mtlFileName: materialFile.filename} : {})};
  status(`Writing ${sceneFile.filename}...`);
  const raw = await exporter.write({sceneModel, dataModel: definition.nativeData ? dataModel : undefined}, encoderOptions);
  let sceneBlob: Blob;
  if (definition.package === "xgf-stream") {
    status("Packaging stream index and chunks...");
    const {writeXGFStreamArchive} = await import("./exporters/writeXGFStreamArchive");
    sceneBlob = toBlob(await writeXGFStreamArchive(raw), definition.mime);
  } else {
    sceneBlob = toBlob(raw, definition.mime);
  }
  const files: ExportDownload[] = [{...sceneFile, blob: sceneBlob}];
  if (materialFile) {
    status(`Writing ${materialFile.filename}...`);
    const {MTLExporter} = await import("@xeokit/sdk/formats/mtl");
    files.push({...materialFile, blob: toBlob(await new MTLExporter().write({sceneModel}, options), "model/mtl")});
  }
  if (dataFile) {
    status(`Writing ${dataFile.filename}...`);
    const {DataModelExporter} = await import("@xeokit/sdk/formats/datamodel");
    files.push({...dataFile, blob: toJsonBlob(await new DataModelExporter().write({dataModel}, options))});
  }
  return files;
}
