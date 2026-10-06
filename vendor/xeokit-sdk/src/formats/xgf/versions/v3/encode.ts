import type {ModelEncodeParams} from "../../../ModelEncodeParams";
import {modelToXGF} from "../v2/modelToXGF";
import {packXGF} from "../v2/packXGF";

/** XGF3 is an explicit envelope: header, UTF-8 declarations, ordinary XGF2, numerical bytes.
 * Older loaders reject version 3 before seeing any source geometry. No executable code is stored.
 * All offsets in the header are absolute; resource offsets are relative to the numerical section.
 */
export async function encode(params: ModelEncodeParams, options?: any): Promise<ArrayBuffer> {
  const model = params.sceneModel;
  if (!model) throw new Error("XGF3 requires a SceneModel");
  if (options?.assetMode && options.assetMode !== "full")
    throw new Error("XGF3 currently requires a full model payload");
  const geometry = packXGF(
    await modelToXGF({sceneModel: model, options: {...options, preserveMeshIds: true}})
  );
  const resources = Object.values(model.dataResources);
  let resourceBytes = 0;
  const descriptors = resources.map((resource) => {
    resourceBytes = Math.ceil(resourceBytes / 4) * 4;
    const entry = {...resource.descriptor, byteOffset: resourceBytes, byteLength: resource.data.byteLength};
    resourceBytes += entry.byteLength;
    return entry;
  });
  const bindings: Record<string, {representationId: string; mode: string}> = Object.create(null);
  for (const mesh of Object.values(model.meshes)) {
    if (mesh.representationId !== undefined) {
      if (!mesh.object) throw new Error(`XGF3 representation mesh ${mesh.id} must belong to a SceneObject`);
      bindings[mesh.id] = {representationId: mesh.representationId, mode: mesh.representationMode};
    }
  }
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      schema: 2,
      coordinateSystem: options?.coordinateSystem ?? model.coordinateSystem.toParams(),
      representations: Object.values(model.representations).map((rep) => rep.toParams()),
      resources: descriptors,
      bindings,
    })
  );
  const geometryOffset = Math.ceil((24 + metadata.byteLength) / 8) * 8;
  const resourcesOffset = Math.ceil((geometryOffset + geometry.byteLength) / 8) * 8;
  const bytes = new Uint8Array(resourcesOffset + resourceBytes);
  const header = new DataView(bytes.buffer);
  [3, metadata.byteLength, geometryOffset, geometry.byteLength, resourcesOffset, resourceBytes].forEach(
    (value, i) => header.setUint32(i * 4, value, true)
  );
  bytes.set(metadata, 24);
  bytes.set(new Uint8Array(geometry), geometryOffset);
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  resources.forEach((resource, index) => {
    const data = resource.data;
    const offset = resourcesOffset + descriptors[index].byteOffset;
    if (littleEndian || data.BYTES_PER_ELEMENT === 1) {
      bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
    } else {
      for (let i = 0; i < data.length; i++) {
        if (data instanceof Float32Array) header.setFloat32(offset + i * 4, data[i], true);
        else header.setUint32(offset + i * 4, data[i], true);
      }
    }
  });
  return bytes.buffer;
}
