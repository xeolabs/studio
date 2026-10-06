import type {FloatArrayParam} from "../../base/math";
import type {SceneGeometryMorphTargetParams} from "./SceneGeometryParams";

/** @internal Shared by the compressed and uncompressed geometry creation paths. */
export function validateMorphTargetUVs(targets: readonly SceneGeometryMorphTargetParams[],
  baseUVs: FloatArrayParam | undefined, vertexCount: number): string | undefined {
  for (let index = 0; index < targets.length; index++) {
    const uvs = targets[index].uvs;
    if (uvs === undefined) continue;
    if (!baseUVs || baseUVs.length !== vertexCount * 2) {
      return `morphTargets[${index}].uvs requires base channel-0 UVs with two values per vertex.`;
    }
    if (uvs.length !== baseUVs.length) return `morphTargets[${index}].uvs length must match base UVs.`;
    for (let i = 0; i < uvs.length; i++) {
      if (!Number.isFinite(uvs[i])) return `morphTargets[${index}].uvs[${i}] must be finite.`;
    }
  }
}
