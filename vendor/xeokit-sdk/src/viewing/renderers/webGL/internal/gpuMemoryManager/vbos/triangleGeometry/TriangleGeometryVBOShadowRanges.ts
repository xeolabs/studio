import {BatchPickBounds} from "../../../pickManager/PickBounds";
import {
  TRIANGLE_GEOMETRY_VBO_PASS_ORDER,
  type TriangleGeometryVBOMeshRecord,
  type TriangleGeometryVBOViewState
} from "./TriangleGeometryVBOState";

const MESHES_PER_GROUP = 128;

/**
 * Builds optional shadow metadata over the existing packed element buffer.
 * Each group is [minX, minY, minZ, maxX, maxY, maxZ, firstIndex, indexCount].
 * Float64 bounds keep the same conservative world-coordinate precision as
 * whole-batch culling. NaN bounds mean that the group must always draw.
 *
 * Walking one index per mesh follows the actual pass/tile packing order,
 * without retaining another mesh list or duplicating any geometry. Creation,
 * deletion, visibility/pass changes and geometry/placement writes already
 * rebuild that packing; callers invalidate this cache at the same boundary.
 * Camera movement neither rebuilds this data nor uploads another index buffer.
 * @internal
 */
export function buildTriangleGeometryVBOShadowRanges(
  view: TriangleGeometryVBOViewState,
  renderPass: number,
  records: ReadonlyMap<number, TriangleGeometryVBOMeshRecord>,
  meshIndices: Uint32Array
): Float64Array | null {
  const indices = view.indices;
  const range = view.indexRanges.get(renderPass);
  if (!indices || !range) return null;
  const tiles = view.tileDrawStates.get(TRIANGLE_GEOMETRY_VBO_PASS_ORDER.indexOf(renderPass) * 2);
  if (!tiles) return null;
  // At most one partial group per tile. Trim the result to active metadata;
  // neither compact nor stream policies require extra GPU storage for this.
  const data = new Float64Array((Math.ceil(records.size / MESHES_PER_GROUP) + tiles.length) * 8);
  const end = range.firstIndex + range.indexCount;
  let cursor = range.firstIndex;
  let offset = 0;
  while (cursor < end) {
    const first = cursor;
    let tileIndex = -1;
    const bounds = new BatchPickBounds();
    for (let count = 0; count < MESHES_PER_GROUP && cursor < end; count++) {
      const record = records.get(meshIndices[indices[cursor]]);
      if (!record || record.primitiveCount <= 0) return null;
      if (count && record.tileIndex !== tileIndex) break;
      tileIndex = record.tileIndex;
      bounds.expand(record.sceneMesh);
      cursor += record.primitiveCount * 3;
    }
    if (cursor > end || offset + 8 > data.length) return null;
    const aabb = bounds.aabb;
    if (aabb) data.set(aabb, offset);
    else data[offset] = NaN; // Unsafe/deformed geometry stays on the GPU path.
    data[offset + 6] = first;
    data[offset + 7] = cursor - first;
    offset += 8;
  }
  return data.slice(0, offset);
}
