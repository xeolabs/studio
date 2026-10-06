import type {Scene} from "@xeokit/sdk/model/scene";
import type {Data} from "@xeokit/sdk/model/data";

export interface DiagnosticResourceTarget {
  domain: "scene" | "data";
  modelId: string;
  resourceId: string;
  resourceKind?: string;
}

/** Resolve only known relationships, never guess by matching unrelated asset IDs. */
export function diagnosticObjectIds(scene: Scene, data: Data, target: DiagnosticResourceTarget): string[] {
  if (!target || typeof target.resourceId !== "string" || typeof target.modelId !== "string") return [];
  if (target.domain === "data") {
    return data.models[target.modelId]?.objects[target.resourceId] && scene.objects[target.resourceId] ? [target.resourceId] : [];
  }
  if (target.domain !== "scene") return [];
  const model = scene.models[target.modelId];
  if (!model || model.headless) return [];
  const kind = typeof target.resourceKind === "string" ? target.resourceKind.toLowerCase() : "";
  if (kind === "object") return model.objects[target.resourceId] ? [target.resourceId] : [];
  const ids = new Set<string>();
  for (const mesh of Object.values(model.meshes)) {
    if (mesh.object && ((kind === "mesh" && mesh.id === target.resourceId) ||
      (kind === "geometry" && mesh.geometry.id === target.resourceId) ||
      (kind === "material" && mesh.material?.id === target.resourceId))) {
      ids.add(mesh.object.id);
    }
  }
  return Array.from(ids);
}
