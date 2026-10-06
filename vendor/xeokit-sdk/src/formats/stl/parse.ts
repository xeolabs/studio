import {TrianglesPrimitive} from "../../base/constants";
import {createUUID, yieldToHost} from "../../base/utils";
import type {ModelParser} from "../ModelParser";
import {createCoordinateSystemTransform, type CoordinateSystem} from "../../model/scene";
import {createMat4Float64} from "../../base/math/matrix";

/** @internal */
export const parse: ModelParser = async ({fileData, sceneModel, dataModel}, options = {}) => {
  if (!sceneModel) throw new Error("[STLLoader] sceneModel is required");
  const bytes = new Uint8Array(fileData);
  const view = new DataView(fileData);
  const count = bytes.length >= 84 ? view.getUint32(80, true) : -1;
  const positions: number[] = [];
  let name = "STL mesh";
  // Binary headers may begin with 'solid'. Length is the reliable discriminator.
  if (count >= 0 && bytes.length === 84 + count * 50) {
    for (let f = 0; f < count; f++) {
      if ((f & 4095) === 0) {
        await yieldToHost(options.signal);
        options.onProgress?.({phase: "Reading STL facets", current: f, total: count});
      }
      const offset = 84 + f * 50 + 12;
      for (let i = 0; i < 9; i++) positions.push(view.getFloat32(offset + i * 4, true));
    }
  } else {
    const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "").trim();
    if (!/^solid(?:\s|$)/i.test(text)) throw new Error("[STLLoader] Invalid or truncated binary STL");
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    let i = 0;
    const take = (pattern: RegExp): RegExpMatchArray => {
      const match = (lines[i++] || "").match(pattern);
      if (!match) throw new Error(`[STLLoader] Invalid ASCII STL near line ${i}`);
      return match;
    };
    while (i < lines.length) {
      name = take(/^solid(?:\s+(.*))?$/i)[1] || name;
      while (i < lines.length && !/^endsolid(?:\s|$)/i.test(lines[i])) {
        if (positions.length % 36864 === 0) await yieldToHost(options.signal);
        take(/^facet\s+normal\s+\S+\s+\S+\s+\S+$/i);
        take(/^outer\s+loop$/i);
        for (let v = 0; v < 3; v++) {
          const vertex = take(/^vertex\s+(\S+)\s+(\S+)\s+(\S+)$/i);
          positions.push(Number(vertex[1]), Number(vertex[2]), Number(vertex[3]));
        }
        take(/^endloop$/i);
        take(/^endfacet$/i);
      }
      take(/^endsolid(?:\s+.*)?$/i);
    }
  }
  if (!positions.length || !positions.every(Number.isFinite)) throw new Error("[STLLoader] Empty mesh or non-finite vertex coordinates");
  await yieldToHost(options.signal);
  const id = createUUID();
  // Recompute face shading from winding instead of trusting frequently stale STL facet normals.
  const geometry = sceneModel.createGeometry({id, primitive: TrianglesPrimitive, positions, indices: Array.from({length: positions.length / 3}, (_, i) => i)});
  if (geometry.ok === false) throw new Error(geometry.error);
  const matrix = options.coordinateSystem
    ? createCoordinateSystemTransform(options.coordinateSystem as CoordinateSystem, sceneModel.coordinateSystem, createMat4Float64())
    : undefined;
  const mesh = sceneModel.createMesh({id, geometryId: id, matrix});
  if (mesh.ok === false) throw new Error(mesh.error);
  const object = sceneModel.createObject({id, meshIds: [id], layerId: options.layerId});
  if (object.ok === false) throw new Error(object.error);
  if (dataModel) {
    const result = dataModel.createObject({id, type: "STLMesh", name});
    if (result.ok === false) throw new Error(result.error);
  }
  options.onProgress?.({phase: "Reading STL facets", current: positions.length / 9, total: positions.length / 9});
};
