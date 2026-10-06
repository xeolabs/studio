import type {SceneObject, SceneMesh} from "../../../model/scene";
import type {Mat4} from "../../../base/math/matrix";

/** Bounds and transforms expressed in the export's Z-up meter coordinate system. @internal */
export interface ExportObject {
  object: SceneObject;
  meshes: {mesh: SceneMesh; matrix: Mat4}[];
  bounds: number[];
}
/** @internal */
export interface ObjectPartition {
  bounds: number[];
  objects?: ExportObject[];
  children?: ObjectPartition[];
}

/** Median split on the longest dimension. Even coincident objects make progress. @internal */
export function partitionObjects(objects: ExportObject[], limit: number): ObjectPartition {
  const bounds = unionBounds(objects.map(object => object.bounds));
  if (objects.length <= limit) return {bounds, objects};
  let axis = 0;
  for (let i = 1; i < 3; i++) if (bounds[i + 3] - bounds[i] > bounds[axis + 3] - bounds[axis]) axis = i;
  const sorted = objects.slice().sort((a, b) => (a.bounds[axis] + a.bounds[axis + 3]) - (b.bounds[axis] + b.bounds[axis + 3]));
  const middle = Math.floor(sorted.length / 2);
  return {bounds, children: [partitionObjects(sorted.slice(0, middle), limit), partitionObjects(sorted.slice(middle), limit)]};
}

/** @internal */
export function unionBounds(bounds: number[][]): number[] {
  const result = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const b of bounds) for (let i = 0; i < 3; i++) {
    result[i] = Math.min(result[i], b[i]); result[i + 3] = Math.max(result[i + 3], b[i + 3]);
  }
  return result;
}

/** @internal */
export function boundingBox(b: number[]): number[] {
  // GLB matrices/positions are float32. Keep conservative bounds after rounding,
  // including planar tiles, without changing the precision-recentering origin.
  const padding = Math.max(1e-5, Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * 1e-6);
  return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2,
    (b[3] - b[0]) / 2 + padding, 0, 0, 0, (b[4] - b[1]) / 2 + padding, 0, 0, 0, (b[5] - b[2]) / 2 + padding];
}
