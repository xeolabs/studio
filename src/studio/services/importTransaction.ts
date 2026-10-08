import type {Scene, SceneModel, SceneModelParams} from "@xeokit/sdk/model/scene";
import type {Data, DataModel, DataModelParams} from "@xeokit/sdk/model/data";
import type {SDKResult} from "@xeokit/sdk/base/core";
import {modelTitle, setModelTitle} from "./modelNames";

export interface ImportConflict {title: string; sceneModelId?: string; dataModelId?: string;}
export interface PreparedImport {
  modelId: string; title: string; scene?: SceneModelParams; data?: DataModelParams;
  warnings: string[]; frameAfterImport: boolean;
}
export const requireValue = <T>(result: SDKResult<T>): T => {
  if (result.ok === false) throw new Error(result.error);
  return result.value;
};

export function importConflicts(scene: Scene, data: Data, prepared: PreparedImport,
  pairs: ImportConflict[] = []): ImportConflict[] {
  const sceneIds = new Set<string>(), dataIds = new Set<string>();
  for (const object of prepared.scene?.objects || []) {
    if (object.id && scene.objects[object.id]) sceneIds.add(scene.objects[object.id].model.id);
  }
  // Semantics may intentionally share IDs across models. A data-only import
  // still needs an explicit replacement decision for existing objects.
  if (!prepared.scene) for (const object of prepared.data?.objects || []) {
    for (const model of (object.id && data.objects[object.id]?.models) || []) dataIds.add(model.id);
  }
  const result: ImportConflict[] = [];
  for (const pair of pairs) {
    if (!(pair.sceneModelId && sceneIds.has(pair.sceneModelId)) && !(pair.dataModelId && dataIds.has(pair.dataModelId))) continue;
    result.push(pair);
    if (pair.sceneModelId) sceneIds.delete(pair.sceneModelId);
    if (pair.dataModelId) dataIds.delete(pair.dataModelId);
  }
  for (const id of sceneIds) {
    result.push({title: modelTitle(scene.models[id]), sceneModelId: id, dataModelId: data.models[id] ? id : undefined});
    dataIds.delete(id);
  }
  for (const id of dataIds) result.push({title: modelTitle(data.models[id]), dataModelId: id});
  return result;
}

/** Commit only validated content. Keep rollback data until both new parts exist. */
export function commitImport(scene: Scene, data: Data, prepared: PreparedImport, conflicts: ImportConflict[] = []) {
  const oldScenes = [...new Set(conflicts.flatMap(c => c.sceneModelId ? [c.sceneModelId] : []))]
    .flatMap(id => scene.models[id] ? [{params: requireValue(scene.models[id].toParams()), title: modelTitle(scene.models[id])}] : []);
  const oldData = [...new Set(conflicts.flatMap(c => c.dataModelId ? [c.dataModelId] : []))]
    .flatMap(id => data.models[id] ? [{params: requireValue(data.models[id].toParams()), title: modelTitle(data.models[id])}] : []);
  let sceneModel: SceneModel | undefined, dataModel: DataModel | undefined;
  try {
    for (const old of oldScenes) requireValue(scene.models[old.params.id!].destroy());
    for (const old of oldData) requireValue(data.models[old.params.id!].destroy());
    if (prepared.scene) sceneModel = requireValue(scene.createModel({...prepared.scene, id: prepared.modelId, headless: false}));
    if (prepared.data) dataModel = requireValue(data.createModel({...prepared.data, id: prepared.modelId}));
    for (const model of [sceneModel, dataModel]) if (model) setModelTitle(model, prepared.title);
    return {sceneModel, dataModel};
  } catch (error) {
    sceneModel?.destroy(); dataModel?.destroy();
    for (const old of oldScenes) if (!scene.models[old.params.id!]) setModelTitle(requireValue(scene.createModel(old.params)), old.title);
    for (const old of oldData) if (!data.models[old.params.id!]) setModelTitle(requireValue(data.createModel(old.params)), old.title);
    throw error;
  }
}
