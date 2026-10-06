import type {Mat4} from "../../../../../base/math/matrix";
import type {SceneMesh, SceneModel} from "../../../../../model/scene";
import type {LODVariantMembership} from "../../../../lod/LODVariantMembership";
import type {RendererGeometry} from "../gpuMemoryManager";

export interface RendererMesh {
  mesh: SceneMesh;
  /** Per-view ordinary fallback participation; allocations remain cached when inactive. */
  representationViews?: Record<string, boolean>;
  sceneModel: SceneModel | null;
  geometryState: RendererGeometry;
  worldMatrix: Mat4;
  matrixDirty: boolean;
  packedVertexStart: number;
  instanceDataVersion: number;
  createdStructureVersion: number;
  lodVariantMemberships: readonly LODVariantMembership[];
  lodVariantMembershipKey: string;
}
