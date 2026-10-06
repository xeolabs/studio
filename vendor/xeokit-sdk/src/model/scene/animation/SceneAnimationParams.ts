import type {Vec3} from "../../../base/math/vector";
import type {Quat} from "../../../base/math/quat";

/**
 * Interpolation mode for sampled scene animation data.
 *
 * `STEP` holds the previous sample until the next key time.
 * `LINEAR` linearly interpolates vectors and spherical-linearly interpolates
 * quaternions. Evaluation clamps times outside the authored sample range to
 * the first or last sample.
 */
export type SceneAnimationInterpolation = "STEP" | "LINEAR";

/**
 * Supported semantic properties on a SceneTransform.
 *
 * These are authored transform channels, not arbitrary property paths. Keeping
 * the target semantic allows serialization and tooling to preserve the meaning
 * of the animated value.
 */
export type SceneAnimationTransformProperty = "translation" | "rotation" | "scale";

/**
 * Semantic target for transform animation.
 *
 * This iteration targets SceneTransform IDs because SceneTransform is the
 * scene module's authored transform resource. SceneObjects can then use meshes
 * attached to those transforms. Other animation target domains can be added by
 * extending the target union without changing the sampler representation.
 */
export interface SceneAnimationTransformTargetParams {
  type: "transform";
  transformId: string;
  property: SceneAnimationTransformProperty;
}

/**
 * Semantic target for complete fixed-topology vertex-state animation.
 *
 * The referenced mesh samples complete replacement states owned by its
 * geometry. The sampler values are vertex state indices; the sampler times and
 * interpolation mode belong to the animation asset, not to the geometry.
 */
export interface SceneAnimationVertexStateTargetParams {
  type: "vertexState";
  meshId: string;
}

/**
 * Semantic target for mesh-local morph weights.
 *
 * The sampler stores all weights for the target mesh at each key time as a
 * vector. The vector length is declared by `sampler.valueSize`.
 */
export interface SceneAnimationMorphWeightsTargetParams {
  type: "morphWeights";
  meshId: string;
}

/**
 * Semantic animation target.
 */
export type SceneAnimationTargetParams =
  | SceneAnimationTransformTargetParams
  | SceneAnimationVertexStateTargetParams
  | SceneAnimationMorphWeightsTargetParams;

/**
 * Sampled scalar/vector/quaternion animation data.
 *
 * Sample times do not need to be uniformly spaced, but they must be finite and
 * strictly increasing. Values are flattened in sample order. Translation and
 * scale channels use three values per sample; rotation channels use four
 * quaternion values `[x, y, z, w]` per sample. Morph-weight channels use
 * `valueSize` values per sample.
 *
 * The default interpolation mode is `LINEAR`.
 */
export interface SceneAnimationSamplerParams {
  times: number[] | Float32Array | Float64Array;
  values: number[] | Float32Array | Float64Array;
  valueSize?: number;
  interpolation?: SceneAnimationInterpolation;
}

/**
 * One sampled channel targeting one semantic scene property.
 *
 * Channels are intentionally small: a target identifies what is animated and a
 * sampler supplies the authored values. Runtime playback state is held
 * elsewhere.
 */
export interface SceneAnimationChannelParams {
  target: SceneAnimationTargetParams;
  sampler: SceneAnimationSamplerParams;
}

/**
 * Authored scene animation asset parameters.
 *
 * A SceneModel may own multiple animations. Runtime playback state such as
 * current time, speed and looping belongs to SceneAnimationPlayer, not to this
 * serializable parameter object.
 */
export interface SceneAnimationParams {
  id: string;
  name?: string;
  channels: SceneAnimationChannelParams[];
}

export type SceneAnimationVec3Value = Vec3 | [number, number, number];
export type SceneAnimationQuatValue = Quat | [number, number, number, number];
