import type {ModelParseParams} from "../../../ModelParseParams";
import {xgfToModel} from "../v2/xgfToModel";
import {unpackXGF} from "../v2/unpackXGF";
import {copyRepresentationParams} from "../../../../model/scene/representation/copyRepresentationParams";
import {type SceneRepresentationParams} from "../../../../model/scene/representation/SceneRepresentationParams";
import {validateDataResourceParams} from "../../../../model/scene/representation/validateDataResourceParams";
import {type SceneDataResourceParams} from "../../../../model/scene/representation/SceneDataResourceParams";

/** Validate the envelope before publishing model content. Numerical payloads stay binary. */
export async function parse(params: ModelParseParams, options: any = {}): Promise<void> {
  const {fileData: buffer, sceneModel, dataModel} = params;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 24) throw new Error("Truncated XGF3 header");
  const header = new DataView(buffer);
  const [version, jsonLength, geometryOffset, geometryLength, resourcesOffset, resourcesLength] = Array.from(
    {length: 6},
    (_, i) => header.getUint32(i * 4, true)
  );
  if (
    version !== 3 ||
    jsonLength > 16 * 1024 * 1024 ||
    geometryOffset < 24 + jsonLength ||
    geometryOffset % 8 ||
    geometryLength < 12 ||
    resourcesOffset < geometryOffset + geometryLength ||
    resourcesOffset % 8 ||
    resourcesOffset + resourcesLength !== buffer.byteLength
  )
    throw new Error("Invalid XGF3 section bounds");
  const metadata = JSON.parse(
    new TextDecoder("utf-8", {fatal: true}).decode(new Uint8Array(buffer, 24, jsonLength))
  );
  if (
    metadata.schema !== 2 ||
    !Array.isArray(metadata.resources) ||
    !Array.isArray(metadata.representations) ||
    !metadata.bindings ||
    typeof metadata.bindings !== "object" ||
    Array.isArray(metadata.bindings)
  )
    throw new Error("Invalid XGF3 declarations");
  const prefix = (id: string) => `${options.idPrefix ?? ""}${id}`;
  const seen = new Set<string>();
  let lastEnd = 0;
  const resources = metadata.resources.map((entry: any): SceneDataResourceParams => {
    const {byteOffset, byteLength, ...descriptor} = entry;
    if (typeof entry.id !== "string" || !entry.id || seen.has(entry.id))
      throw new Error("Duplicate or invalid XGF3 resource id");
    seen.add(entry.id);
    if (
      !Number.isSafeInteger(byteOffset) ||
      !Number.isSafeInteger(byteLength) ||
      byteOffset < lastEnd ||
      byteLength < 0 ||
      byteOffset + byteLength > resourcesLength ||
      byteOffset % 4
    )
      throw new Error("Invalid XGF3 resource range");
    lastEnd = byteOffset + byteLength;
    const component =
      entry.kind === "texture2d"
        ? entry.format === "rgba8unorm"
          ? "uint8"
          : "float32"
        : entry.componentType;
    const Type = {float32: Float32Array, uint32: Uint32Array, uint8: Uint8Array}[component];
    if (!Type || byteLength % Type.BYTES_PER_ELEMENT)
      throw new Error("Invalid XGF3 component type or alignment");
    const data = new Type(byteLength / Type.BYTES_PER_ELEMENT);
    for (let i = 0; i < data.length; i++) {
      const offset = resourcesOffset + byteOffset + i * Type.BYTES_PER_ELEMENT;
      data[i] =
        component === "float32"
          ? header.getFloat32(offset, true)
          : component === "uint32"
          ? header.getUint32(offset, true)
          : header.getUint8(offset);
    }
    // Validate without mutating the destination; SceneModel takes its own CPU copy on commit.
    const params = {...descriptor, id: prefix(entry.id), data} as SceneDataResourceParams;
    validateDataResourceParams(params);
    return params;
  });
  seen.clear();
  const representations = metadata.representations.map((entry: SceneRepresentationParams) => {
    const source = copyRepresentationParams(entry);
    if (seen.has(source.id)) throw new Error("Duplicate XGF3 representation id");
    seen.add(source.id);
    return {
      ...source,
      id: prefix(source.id),
      resources: Object.fromEntries(Object.entries(source.resources).map(([name, id]) => [name, prefix(id)])),
    };
  });
  const bindings: Record<string, {representationId: string; mode: "replace" | "augment"}> = Object.create(null);
  for (const [meshId, value] of Object.entries(metadata.bindings)) {
    const binding = value as {representationId?: unknown; mode?: unknown};
    if (!meshId || !binding || typeof binding.representationId !== "string" || !binding.representationId ||
        (binding.mode !== "replace" && binding.mode !== "augment")) throw new Error("Invalid XGF3 representation binding");
    bindings[meshId] = {representationId: prefix(binding.representationId), mode: binding.mode};
  }
  const geometryBytes = buffer.slice(geometryOffset, geometryOffset + geometryLength);
  if (new DataView(geometryBytes).getUint32(0, true) !== 2) throw new Error("Invalid XGF3 geometry section");
  const geometry = unpackXGF(geometryBytes);
  const storedIds = new Set(geometry.eachMeshId);
  if (Object.keys(bindings).some((id) => !storedIds.has(id)))
    throw new Error("XGF3 binding references a missing mesh");
  const ownsBatch = !!sceneModel && !sceneModel.activeBatch;
  if (ownsBatch) {
    const result = sceneModel.beginBatch({id: "xgf3-load"});
    if (result.ok === false) throw new Error(result.error);
  }
  try {
    if (sceneModel) {
      for (const resource of resources)
        if (sceneModel.dataResources[resource.id]) throw new Error(`Existing resource ${resource.id}`);
      for (const representation of representations)
        if (sceneModel.representations[representation.id])
          throw new Error(`Existing representation ${representation.id}`);
      for (const resource of resources) {
        const result = sceneModel.createDataResource(resource);
        if (result.ok === false) throw new Error(result.error);
      }
      for (const representation of representations) {
        const result = sceneModel.createRepresentation(representation);
        if (result.ok === false) throw new Error(result.error);
      }
    }
    // Bind before mesh-created events: source geometry must never briefly render normally.
    const createdIds = options.createdIds ?? {geometries: [], textures: [], materials: [], meshes: [], objects: [], transforms: [], animations: [], variantSets: []};
    await xgfToModel({
      xgfData: geometry,
      sceneModel,
      dataModel,
      options: {
        ...options,
        createdIds,
        coordinateSystem: options.coordinateSystem ?? metadata.coordinateSystem,
        representationBindings: bindings,
      },
    });
    if (createdIds.error) throw new Error(createdIds.error);
    if (ownsBatch) {
      const result = sceneModel.commitBatch();
      if (result.ok === false) throw new Error(result.error);
    }
  } catch (error) {
    if (ownsBatch) sceneModel.rollbackBatch();
    throw error;
  }
}
