import {Scene, type SceneModel} from "@xeokit/sdk/model/scene";
import {Data, type DataModel} from "@xeokit/sdk/model/data";
import type {ModelExportOptions} from "@xeokit/sdk/formats";
import {mergeDataModelParams, mergeSceneModelParams} from "./exportModelMerging";

export interface PreparedExportModel<T> { model: T; dispose?: () => void; }

export async function prepareExportSceneModel(models: SceneModel[], options: ModelExportOptions): Promise<PreparedExportModel<SceneModel>> {
  if (models.length === 1) return {model: models[0]};
  const {SceneModelExporter, SceneModelImporter} = await import("@xeokit/sdk/formats/scenemodel");
  const exporter = new SceneModelExporter();
  const sources = await Promise.all(models.map(sceneModel => exporter.write({sceneModel}, options)));
  const params = mergeSceneModelParams(sources, models);
  const scratch = new Scene();
  try {
    const result = scratch.createModel({id: "merged-scene-export", headless: true, coordinateSystem: params.coordinateSystem});
    if (result.ok === false) throw new Error(result.error);
    await new SceneModelImporter().load({fileData: params, sceneModel: result.value});
    return {model: result.value, dispose: () => scratch.destroy()};
  } catch (error) {
    scratch.destroy();
    throw error;
  }
}

export async function prepareExportDataModel(models: DataModel[], options: ModelExportOptions): Promise<PreparedExportModel<DataModel>> {
  if (models.length === 1) return {model: models[0]};
  const {DataModelExporter, DataModelImporter} = await import("@xeokit/sdk/formats/datamodel");
  const exporter = new DataModelExporter();
  const sources = await Promise.all(models.map(dataModel => exporter.write({dataModel}, options)));
  const params = mergeDataModelParams(sources, models);
  const scratch = new Data();
  try {
    const result = scratch.createModel({id: "merged-data-export", schema: params.schema});
    if (result.ok === false) throw new Error(result.error);
    await new DataModelImporter().load({fileData: params, dataModel: result.value});
    return {model: result.value, dispose: () => scratch.destroy()};
  } catch (error) {
    scratch.destroy();
    throw error;
  }
}
