import {decompressPoint3WithAABB3} from "../../base/math/compression";
import {createVec3Float64} from "../../base/math/vector";
import {transformPoint3, type Mat4} from "../../base/math/matrix";
import {getMeshWorldMatrix, type SceneMesh} from "../../model/scene";
import {yieldToHost} from "../../base/utils";

/** Decodes stored positions and bakes a transform, without changing the source mesh. @internal */
export async function readMeshPositions(mesh: SceneMesh, matrix: Mat4 = getMeshWorldMatrix(mesh), signal?: AbortSignal): Promise<Float64Array> {
  const geometry = mesh.geometry;
  const src = geometry.positionsCompressed;
  const result = new Float64Array(src.length);
  const compressed = createVec3Float64();
  const local = createVec3Float64();
  const world = createVec3Float64();
  for (let i = 0; i < src.length; i += 3) {
    if (i % 12288 === 0) await yieldToHost(signal);
    compressed[0] = src[i]; compressed[1] = src[i + 1]; compressed[2] = src[i + 2];
    decompressPoint3WithAABB3(compressed, geometry.aabb, local);
    transformPoint3(matrix, local, world);
    if (!world.every(Number.isFinite)) throw new Error(`Non-finite position in mesh '${mesh.id}'`);
    result.set(world, i);
  }
  return result;
}
