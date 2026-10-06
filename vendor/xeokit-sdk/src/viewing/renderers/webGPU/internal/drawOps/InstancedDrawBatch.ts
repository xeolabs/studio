import type {PackedMeshBatch} from "./PackedMeshBatch";

export interface InstancedDrawBatch {
  packedBatch: PackedMeshBatch;

  /** Source meshes used to recompute transparent sorting after camera/transform changes. */
  sortMeshes?: readonly import("../meshManager").RendererMesh[];
}
