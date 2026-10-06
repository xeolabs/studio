import {TrianglesPrimitive, SolidPrimitive, SurfacePrimitive} from "../../base/constants";
import {getMeshWorldMatrix, type CoordinateSystem} from "../../model/scene";
import {determinantMat4} from "../../base/math/matrix";
import {yieldToHost} from "../../base/utils";
import type {ModelEncodeParams} from "../ModelEncodeParams";
import type {ModelExportOptions} from "../ModelExportOptions";
import {readMeshPositions} from "../internal/readMeshPositions";

/** @internal */
export async function encode({sceneModel}: ModelEncodeParams, options: ModelExportOptions = {}, ascii: boolean): Promise<ArrayBuffer> {
  if (!sceneModel) throw new Error("[STLExporter] sceneModel is required");
  const warn = options.onWarning ?? console.warn;
  warn("[STLExporter] Exports stored triangle geometry only; units, object IDs, materials and animation are not preserved.");
  const target = options.coordinateSystem as CoordinateSystem | undefined;
  const meshes = Object.values(sceneModel.meshes).filter(mesh => [TrianglesPrimitive, SolidPrimitive, SurfacePrimitive].includes(mesh.geometry.primitive));
  if (meshes.length !== Object.keys(sceneModel.meshes).length) warn("[STLExporter] Non-triangle meshes were omitted.");
  const count = meshes.reduce((sum, mesh) => sum + mesh.geometry.indices.length / 3, 0);
  if (!Number.isInteger(count) || count <= 0 || count > 0xFFFFFFFF) throw new Error("[STLExporter] Invalid or empty triangle count");
  const binary = ascii ? undefined : new ArrayBuffer(84 + count * 50);
  const view = binary ? new DataView(binary) : undefined;
  if (binary) {
    new Uint8Array(binary).set(new TextEncoder().encode("xeokit STL"));
    view!.setUint32(80, count, true);
  }
  const lines = ascii ? ["solid xeokit"] : undefined;
  let facet = 0;
  for (const mesh of meshes) {
    const matrix = getMeshWorldMatrix(mesh, target);
    const positions = await readMeshPositions(mesh, matrix, options.signal);
    const indices = mesh.geometry.indices;
    const mirrored = determinantMat4(matrix) < 0;
    for (let i = 0; i < indices.length; i += 3) {
      if ((facet & 4095) === 0) {
        await yieldToHost(options.signal);
        options.onProgress?.({phase: "Writing STL facets", current: facet, total: count});
      }
      const a = indices[i] * 3, b = indices[i + (mirrored ? 2 : 1)] * 3, c = indices[i + (mirrored ? 1 : 2)] * 3;
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
      const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const length = Math.hypot(...normal) || 1;
      const values = [...normal.map(n => n / length), ...positions.slice(a, a + 3), ...positions.slice(b, b + 3), ...positions.slice(c, c + 3)];
      if (!values.every(n => Number.isFinite(n) && (ascii || Number.isFinite(Math.fround(n))))) throw new Error("[STLExporter] Invalid or out-of-range facet");
      if (view) values.forEach((n, j) => view.setFloat32(84 + facet * 50 + j * 4, n, true));
      else lines!.push(`facet normal ${values.slice(0, 3).join(" ")}`, "outer loop", ...[3, 6, 9].map(j => `vertex ${values.slice(j, j + 3).join(" ")}`), "endloop", "endfacet");
      facet++;
    }
  }
  options.onProgress?.({phase: "Writing STL facets", current: count, total: count});
  if (binary) return binary;
  lines!.push("endsolid xeokit");
  return new TextEncoder().encode(lines!.join("\n")).buffer;
}
