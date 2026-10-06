import {SDKErrorType, type SDKResult} from "../../../base/core";
import type {SceneModel} from "../SceneModel";
import type {SceneAnimationState} from "./SceneAnimationState";

/**
 * Applies an evaluated SceneAnimationState to live SceneTransform instances.
 *
 * Evaluation remains non-mutating; this class is the explicit mutation boundary.
 * It writes only the transform properties present in the evaluated state.
 */
export class SceneAnimationStateApplier {
  /**
   * Applies evaluated transform values to matching SceneTransform IDs.
   */
  apply(model: SceneModel, state: SceneAnimationState): SDKResult<void> {
    for (const transformId in state.transforms) {
      const transform = model.transforms[transformId];
      if (!transform) {
        return model.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneAnimationStateApplier.apply] SceneTransform not found: '${transformId}'`
        });
      }
      const transformState = state.transforms[transformId];
      if (transformState.translation) {
        transform.position = transformState.translation;
      }
      if (transformState.rotation) {
        transform.quaternion = transformState.rotation;
      }
      if (transformState.scale) {
        transform.scale = transformState.scale;
      }
    }
    for (const meshId in state.morphWeights) {
      const mesh = model.meshes[meshId];
      if (!mesh) {
        return model.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneAnimationStateApplier.apply] SceneMesh not found: '${meshId}'`
        });
      }
      const result = mesh.setMorphWeights(state.morphWeights[meshId]);
      if (!result.ok) {
        return result;
      }
    }
    for (const meshId in state.vertexStates) {
      const mesh = model.meshes[meshId];
      if (!mesh) {
        return model.scene.logError({
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[SceneAnimationStateApplier.apply] SceneMesh not found: '${meshId}'`
        });
      }
      const vertexState = state.vertexStates[meshId];
      const result = mesh.setVertexState(vertexState.stateAIndex, vertexState.stateBIndex, vertexState.factor);
      if (!result.ok) {
        return result;
      }
    }
    return {ok: true, value: undefined};
  }
}
