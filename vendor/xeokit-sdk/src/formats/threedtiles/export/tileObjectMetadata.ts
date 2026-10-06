import type {DataModel} from "../../../model/data";
import type {ExportObject} from "./partitionObjects";

/**
 * Adds object identity to glTF extras without touching its binary payload.
 * Mesh child names are omitted so the existing glTF loader groups them under
 * their named SceneObject parent instead of creating one object per mesh.
 * @internal
 */
export function tileObjectMetadata(glb: Uint8Array, objects: ExportObject[], dataModel?: DataModel): ArrayBuffer {
  const source = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = source.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  const byId = new Map(objects.map(object => [object.object.id, object.object]));
  const roots: number[] = json.scenes[json.scene ?? 0].nodes;
  for (const index of roots) {
    const node = json.nodes[index];
    if (!byId.has(node.name)) continue;
    const dataObject = dataModel?.objects[node.name];
    node.extras = {...node.extras, xeokit: {objectId: node.name, ...(dataObject ? {name: dataObject.name, type: dataObject.type} : {})}};
    for (const child of node.children || []) delete json.nodes[child].name;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const tail = glb.subarray(20 + jsonLength);
  const output = new Uint8Array(20 + paddedLength + tail.length);
  output.set(glb.subarray(0, 20));
  const header = new DataView(output.buffer);
  header.setUint32(8, output.length, true);
  header.setUint32(12, paddedLength, true);
  output.fill(32, 20, 20 + paddedLength);
  output.set(encoded, 20);
  output.set(tail, 20 + paddedLength);
  return output.buffer;
}
