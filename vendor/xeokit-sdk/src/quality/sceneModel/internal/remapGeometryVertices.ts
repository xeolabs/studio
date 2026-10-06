import type {IntArrayParam} from "../../../base/math";
import type {SceneGeometry} from "../../../model/scene";
import {applyGeometryBuffers} from "./applyGeometryBuffers";
import {mapGeometryVertexAttributes, type VertexArray} from "./mapGeometryVertexAttributes";

/** Compacts every vertex attribute and both index lists before publishing an update. */
export function remapGeometryVertices(
  geometry: SceneGeometry,
  keptSlots: readonly number[],
  oldToNew: Int32Array,
): boolean {
  const vertexCount = geometry.positionsCompressed.length / 3;
  let valid = Number.isInteger(vertexCount) && oldToNew.length === vertexCount;
  const arrays = new Map<VertexArray, VertexArray>();
  const buffers = mapGeometryVertexAttributes(geometry, <T extends VertexArray>(values: T, stride: number): T => {
    if (values.length !== vertexCount * stride) valid = false;
    const existing = arrays.get(values);
    if (existing) return existing as T;
    const Constructor = values.constructor as new(length: number) => T;
    const result = new Constructor(keptSlots.length * stride);
    for (let v = 0; v < keptSlots.length; v++) {
      for (let c = 0; c < stride; c++) result[v * stride + c] = values[keptSlots[v] * stride + c];
    }
    arrays.set(values, result);
    return result;
  });
  const indices = (source?: IntArrayParam): IntArrayParam | undefined => {
    if (!source) return undefined;
    const Constructor = source.constructor as new(length: number) => IntArrayParam;
    const result = new Constructor(source.length);
    for (let i = 0; i < source.length; i++) {
      const slot = source[i];
      const replacement = oldToNew[slot];
      if (!Number.isInteger(slot) || replacement === undefined || replacement < 0 || replacement >= keptSlots.length) {
        valid = false;
      }
      result[i] = replacement;
    }
    return result;
  };
  buffers.indices = indices(geometry.indices);
  buffers.edgeIndices = indices(geometry.edgeIndices);
  if (!valid) return false;
  applyGeometryBuffers(geometry, buffers);
  return true;
}
