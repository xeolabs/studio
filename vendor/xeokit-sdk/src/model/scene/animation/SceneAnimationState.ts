import type {Vec3} from "../../../base/math/vector";
import type {Quat} from "../../../base/math/quat";

/**
 * Evaluated transform values for one SceneTransform.
 *
 * Missing properties mean the evaluated animation did not produce a value for
 * that transform property at the sampled time.
 */
export interface SceneAnimationTransformState {
  translation?: Vec3;
  rotation?: Quat;
  scale?: Vec3;
}

/**
 * Evaluated complete vertex-state sample for one SceneMesh.
 *
 * `stateAIndex` and `stateBIndex` identify complete vertex states owned by the
 * mesh geometry. `factor` is in `[0..1]` for LINEAR interpolation and `0` for
 * STEP or clamped exact samples.
 */
export interface SceneAnimationVertexStateState {
  stateAIndex: number;
  stateBIndex: number;
  factor: number;
}

/**
 * Explicit evaluated animation state.
 *
 * This is separate from live Scene state so application code and tools can
 * evaluate any authored animation time without mutating a SceneModel. The
 * structure is intentionally grouped by animation domain; this iteration
 * populates transform values, mesh-local morph weights and vertex-state
 * samples.
 */
export interface SceneAnimationState {
  animationId: string;
  time: number;
  transforms: {[transformId: string]: SceneAnimationTransformState};
  morphWeights: {[meshId: string]: number[]};
  vertexStates: {[meshId: string]: SceneAnimationVertexStateState};
}
