import type {SceneGeometry, SceneGeometryCompressedParams} from "../../../model/scene";
import {finishGeometryMutation, snapshotGeometryMutation} from "./finishGeometryMutation";

/**
 * Commits a prepared topology cleanup without invoking fixed-count animation
 * setters. All buffers must already be consistent: observers see one complete
 * replacement and renderers rebuild their allocations, on static or dynamic models.
 * This is internal to quality fixes, not a relaxation of the public update API.
 */
export function applyGeometryBuffers(
  geometry: SceneGeometry,
  buffers: Omit<SceneGeometryCompressedParams, "id" | "primitive">,
): void {
  const before = snapshotGeometryMutation(geometry);
  const {positionsCompressed, normalsCompressed, uvsCompressed, indices, ...attributes} = buffers;
  Object.assign(geometry, attributes);
  // Public setters reject resized arrays (and all writes on static models).
  // Write backing storage only after the fix has prepared every replacement.
  const storage = geometry as unknown as {
    _positionsCompressed: SceneGeometry["positionsCompressed"];
    _normalsCompressed: SceneGeometry["normalsCompressed"];
    _uvsCompressed: SceneGeometry["uvsCompressed"];
    _indices: SceneGeometry["indices"];
  };
  if ("positionsCompressed" in buffers) storage._positionsCompressed = positionsCompressed!;
  if ("normalsCompressed" in buffers) storage._normalsCompressed = normalsCompressed;
  if ("uvsCompressed" in buffers) {
    storage._uvsCompressed = uvsCompressed;
    if (geometry.texCoordsCompressed && uvsCompressed) geometry.texCoordsCompressed[0] = uvsCompressed;
  }
  if ("indices" in buffers) storage._indices = indices;
  finishGeometryMutation(geometry, before);
}
