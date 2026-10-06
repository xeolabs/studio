import {createUUID, yieldToHost} from "../../base/utils";
import {createCoordinateSystemTransform, type CoordinateSystem} from "../../model/scene";
import {createMat4Float64, transformPoint3} from "../../base/math/matrix";
import {createVec3Float64} from "../../base/math/vector";
import type {ModelParseParams} from "../ModelParseParams";
import type {LandXMLLoadOptions} from "./LandXMLLoadOptions";
import {readDocument} from "./readDocument";
import {landXMLCoordinates} from "./coordinates";

/** @internal */
export async function parse({fileData, sceneModel, dataModel}: ModelParseParams, options: LandXMLLoadOptions = {}): Promise<void> {
  const document = await readDocument(fileData, options.signal);
  const source = options.coordinateSystem ?? landXMLCoordinates(document.linearUnit);
  const matrix = sceneModel ? createCoordinateSystemTransform(source as CoordinateSystem, sceneModel.coordinateSystem, createMat4Float64()) : undefined;
  const position = createVec3Float64();
  const transformed = createVec3Float64();
  const prefix = createUUID();
  for (const warning of document.warnings) (options.onWarning ?? console.warn)(`[LandXMLLoader] ${warning}`);
  for (let i = 0; i < document.features.length; i++) {
    await yieldToHost(options.signal);
    const feature = document.features[i], id = `${prefix}:${i}`;
    if (sceneModel) {
      const positions = feature.positions;
      for (let j = 0; j < positions.length; j += 3) {
        if (j % 12288 === 0) await yieldToHost(options.signal);
        position[0] = positions[j]; position[1] = positions[j + 1]; position[2] = positions[j + 2];
        transformPoint3(matrix!, position, transformed);
        positions[j] = transformed[0]; positions[j + 1] = transformed[1]; positions[j + 2] = transformed[2];
      }
      const geometry = sceneModel.createGeometry({id, primitive: feature.primitive, positions, indices: feature.indices});
      if (geometry.ok === false) throw new Error(geometry.error);
      const mesh = sceneModel.createMesh({id, geometryId: id, color: feature.type === "Surface" ? [0.63, 0.73, 0.46] : [0.95, 0.45, 0.12]});
      if (mesh.ok === false) throw new Error(mesh.error);
      const object = sceneModel.createObject({id, meshIds: [id], layerId: options.layerId});
      if (object.ok === false) throw new Error(object.error);
    }
    if (dataModel) {
      const ps = dataModel.createPropertySet({id, name: "LandXML source", type: "LandXML", properties: [
        {name: "attributes", value: feature.attributes}, {name: "linearUnit", value: document.linearUnit},
        {name: "coordinateSystem", value: document.coordinateSystem}, {name: "version", value: document.version}
      ]});
      if (ps.ok === false) throw new Error(ps.error);
      const object = dataModel.createObject({id, name: feature.name, type: feature.type, originalSystemId: feature.name, propertySetIds: [id]});
      if (object.ok === false) throw new Error(object.error);
    }
    options.onProgress?.({phase: "Loading LandXML", current: i + 1, total: document.features.length});
  }
}
