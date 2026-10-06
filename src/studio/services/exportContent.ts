import type {SceneModel} from "@xeokit/sdk/model/scene";
import type {DataModel} from "@xeokit/sdk/model/data";

/** Small capability snapshot; never put SDK objects or attribute buffers in reactive UI state. */
export interface ExportContent {
  primitiveMeshes: Record<number, number>;
  animations: number;
  morphTargets: boolean;
  vertexStates: boolean;
  textures: boolean;
  ifcProjects: number;
}

export function inspectExportContent(scenes: readonly SceneModel[], data: readonly DataModel[]): ExportContent {
  const content: ExportContent = {primitiveMeshes: {}, animations: 0, morphTargets: false, vertexStates: false, textures: false, ifcProjects: 0};
  for (const model of scenes) {
    content.animations += Object.keys(model.animations).length;
    content.textures ||= Object.keys(model.textures).length > 0;
    for (const mesh of Object.values(model.meshes)) {
      const geometry = mesh.geometry;
      content.primitiveMeshes[geometry.primitive] = (content.primitiveMeshes[geometry.primitive] || 0) + 1;
      content.morphTargets ||= !!geometry.morphTargets?.length;
      content.vertexStates ||= !!geometry.vertexStatesCompressed?.length;
    }
  }
  const projects = new Set<string>();
  for (const model of data) for (const object of Object.values(model.objects)) {
    if (object.type === "IfcProject") projects.add(object.id);
  }
  content.ifcProjects = projects.size;
  return content;
}
