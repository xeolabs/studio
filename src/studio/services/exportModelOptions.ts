import type {DataModel} from "@xeokit/sdk/model/data";
import type {CoordinateSystemParams, SceneModel} from "@xeokit/sdk/model/scene";

export interface ExportModelOption {
  id: string;
  label: string;
  type: "scene" | "data";
  objectCount: number;
  meshCount?: number;
  selected: boolean;
  coordinateSystem?: CoordinateSystemParams;
}

export interface ExportSceneModelOption extends ExportModelOption {
  type: "scene";
  coordinateSystem: CoordinateSystemParams;
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existingId) => existingId !== id) : [...ids, id];
}

export function retainExistingSelection(ids: string[], models: ExportModelOption[]): string[] {
  const availableIds = new Set(models.map((model) => model.id));
  return ids.filter((id) => availableIds.has(id));
}

export function sourceSummary(models: Array<{id: string}>, fallback: string): string {
  if (models.length === 1) {
    return models[0].id;
  }
  return `merged-${models.length}-${fallback}-models`;
}

export function pickById<T extends {id: string}>(items: T[], id: string): T {
  return items.find((item) => item.id === id) || items[0];
}

export function sceneModelOption(model: SceneModel, selected: boolean): ExportSceneModelOption {
  const source = model as any;
  return {
    id: model.id,
    label: source.name || model.id,
    type: "scene",
    objectCount: recordSize(source.objects),
    meshCount: recordSize(source.meshes),
    coordinateSystem: model.coordinateSystem.toParams(),
    selected
  };
}

export function dataModelOption(model: DataModel, selected: boolean): ExportModelOption {
  const source = model as any;
  return {
    id: model.id,
    label: source.name || model.id,
    type: "data",
    objectCount: recordSize(source.objects),
    selected
  };
}

function recordSize(value: unknown): number {
  return value && typeof value === "object" ? Object.keys(value as Record<string, unknown>).length : 0;
}
