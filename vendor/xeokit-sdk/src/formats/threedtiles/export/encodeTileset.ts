import {TrianglesPrimitive, LinesPrimitive, PointsPrimitive} from "../../../base/constants";
import {yieldToHost} from "../../../base/utils";
import {getMeshWorldMatrix, type CoordinateSystem} from "../../../model/scene";
import type {ModelEncodeParams} from "../../ModelEncodeParams";
import {DataModelExporter} from "../../datamodel";
import {readMeshPositions} from "../../internal/readMeshPositions";
import type {ThreeDTilesExportOptions, ThreeDTilesExportResult, ExportedTile} from "../ThreeDTilesExportOptions";
import {partitionObjects, boundingBox, type ExportObject, type ObjectPartition} from "./partitionObjects";
import {writeTileGLB} from "./writeTileGLB";

/** @internal */
export async function encodeTileset({sceneModel, dataModel}: ModelEncodeParams, options: ThreeDTilesExportOptions = {}): Promise<ThreeDTilesExportResult> {
  if (!sceneModel) throw new Error("[ThreeDTilesExporter] sceneModel is required");
  const limit = options.maxObjectsPerTile ?? 64;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("[ThreeDTilesExporter] maxObjectsPerTile must be a positive integer");
  if (options.rootTransform && (options.rootTransform.length !== 16 || !options.rootTransform.every(Number.isFinite) || options.rootTransform[3] !== 0 || options.rootTransform[7] !== 0 || options.rootTransform[11] !== 0 || options.rootTransform[15] !== 1)) throw new Error("[ThreeDTilesExporter] rootTransform must be a finite affine matrix");
  const basis = [1, 0, 0, 0, 0, 1, 0, 1, 0];
  const target = options.coordinateSystem ?? {basis, origin: [0, 0, 0], units: "meters", scaleToMeters: 1};
  if (target.units !== "meters" || (target.scaleToMeters ?? 1) !== 1 || target.basis.some((v, i) => v !== basis[i])) throw new Error("[ThreeDTilesExporter] coordinateSystem must use Z-up meters");
  const warn = options.onWarning ?? console.warn;
  if (Object.keys(sceneModel.animations).length || Object.values(sceneModel.geometries).some(g => g.morphTargets?.length || g.vertexStatesCompressed?.length)) warn("[ThreeDTilesExporter] Animation and deformation are omitted; exports stored base geometry at current mesh/parent transforms.");
  const objects: ExportObject[] = [];
  for (const object of Object.values(sceneModel.objects)) {
    await yieldToHost(options.signal);
    const meshes: ExportObject["meshes"] = [];
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const mesh of object.meshes) {
      if (mesh.model !== sceneModel) continue;
      if (![TrianglesPrimitive, LinesPrimitive, PointsPrimitive].includes(mesh.geometry.primitive)) throw new Error(`[ThreeDTilesExporter] Unsupported primitive in '${mesh.id}'`);
      const matrix = getMeshWorldMatrix(mesh, target as CoordinateSystem);
      const positions = await readMeshPositions(mesh, matrix, options.signal);
      if (!positions.length) continue;
      for (let j = 0; j < positions.length; j++) {
        if (j % 12288 === 0) await yieldToHost(options.signal);
        const axis = j % 3;
        bounds[axis] = Math.min(bounds[axis], positions[j]); bounds[axis + 3] = Math.max(bounds[axis + 3], positions[j]);
      }
      meshes.push({mesh, matrix});
    }
    if (meshes.length) objects.push({object, meshes, bounds});
  }
  if (!objects.length) throw new Error("[ThreeDTilesExporter] No object geometry to export");
  const files: ThreeDTilesExportResult["files"] = Object.create(null);
  let nextTile = 0, writtenObjects = 0;
  async function encodePartition(partition: ObjectPartition): Promise<ExportedTile> {
    await yieldToHost(options.signal);
    const b = partition.bounds;
    const tile: ExportedTile = {boundingVolume: {box: boundingBox(b)}, geometricError: 0};
    if (partition.children) {
      tile.geometricError = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
      tile.children = [];
      for (const child of partition.children) tile.children.push(await encodePartition(child));
    } else {
      const center: [number, number, number] = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const uri = `tiles/tile-${nextTile++}.glb`;
      files[uri] = await writeTileGLB(partition.objects!, center, dataModel, options);
      tile.content = {uri};
      tile.transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...center, 1];
      // A tile's box is in its own (translated) frame, not its parent's frame.
      tile.boundingVolume.box[0] = 0; tile.boundingVolume.box[1] = 0; tile.boundingVolume.box[2] = 0;
      writtenObjects += partition.objects!.length;
      options.onProgress?.({phase: "Writing 3D Tiles", current: writtenObjects, total: objects.length});
    }
    return tile;
  }
  const partition = partitionObjects(objects, limit);
  const root = await encodePartition(partition);
  root.refine = "ADD";
  // A wrapper keeps geolocation independent of the leaf's precision-recentering transform.
  const placedRoot: ExportedTile = options.rootTransform ? {boundingVolume: {box: boundingBox(partition.bounds)}, geometricError: root.geometricError, refine: "ADD", transform: Array.from(options.rootTransform), children: [root]} : root;
  const tileset: ThreeDTilesExportResult["tileset"] = {asset: {version: "1.1", generator: "xeokit"}, geometricError: Math.max(root.geometricError, 1), root: placedRoot};
  if (dataModel) {
    files["datamodel.json"] = await new DataModelExporter().write({dataModel}, {signal: options.signal});
    tileset.extras = {dataModelUri: "datamodel.json"};
    warn("[ThreeDTilesExporter] DataModel semantics are preserved in datamodel.json; this is a xeokit sidecar, not standardized per-feature 3D Tiles metadata.");
  }
  files["tileset.json"] = tileset;
  return {entryPoint: "tileset.json", tileset, files};
}
