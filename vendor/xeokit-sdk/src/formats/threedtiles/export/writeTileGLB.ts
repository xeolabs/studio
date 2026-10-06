import {Scene} from "../../../model/scene";
import type {DataModel} from "../../../model/data";
import type {SDKResult} from "../../../base/core";
import {createMat4Float64, mulMat4, translationMat4v} from "../../../base/math/matrix";
import {GLTFExporter} from "../../gltf";
import type {ThreeDTilesExportOptions} from "../ThreeDTilesExportOptions";
import type {ExportObject} from "./partitionObjects";
import {tileObjectMetadata} from "./tileObjectMetadata";

const Z_UP_TO_Y_UP = createMat4Float64([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);

/** Uses the existing glTF material/texture writer on a flattened static scratch model. @internal */
export async function writeTileGLB(objects: ExportObject[], center: [number, number, number], dataModel: DataModel | undefined, options: ThreeDTilesExportOptions): Promise<ArrayBuffer> {
  const scene = new Scene();
  try {
    const scratch = value(scene.createModel({id: "tile", headless: true}));
    const local = mulMat4(Z_UP_TO_Y_UP, translationMat4v([-center[0], -center[1], -center[2]]), createMat4Float64());
    for (const object of objects) {
      const meshIds: string[] = [];
      for (const {mesh, matrix} of object.meshes) {
        const geometry = mesh.geometry;
        if (!scratch.geometries[geometry.id]) {
          const params = value(geometry.toParams());
          delete params.vertexStatesCompressed; delete params.framesCompressed; delete params.morphTargets;
          value(scratch.createGeometryCompressed(params));
        }
        const material = mesh.material;
        if (material && !scratch.materials[material.id]) {
          for (const texture of [material.colorTexture, material.metallicRoughnessTexture, material.normalsTexture, material.occlusionTexture, material.emissiveTexture]) {
            if (texture && !scratch.textures[texture.id]) value(scratch.createTexture(value(texture.toParams())));
          }
          value(scratch.createMaterial(value(material.toParams())));
        }
        value(scratch.createMesh({id: mesh.id, geometryId: geometry.id, materialId: material?.id,
          matrix: mulMat4(local, matrix, createMat4Float64()), color: mesh.color, opacity: mesh.opacity}));
        meshIds.push(mesh.id);
      }
      value(scratch.createObject({id: object.object.id, meshIds}));
    }
    // Coordinate conversion has already been applied to each flattened mesh.
    const bytes = await new GLTFExporter().write({sceneModel: scratch}, {...options, coordinateSystem: undefined, onProgress: undefined});
    return tileObjectMetadata(bytes, objects, dataModel);
  } finally { scene.destroy(); }
}

function value<T>(result: SDKResult<T>): T {
  if (result.ok === false) throw new Error(`[ThreeDTilesExporter] ${result.error}`);
  return result.value;
}
