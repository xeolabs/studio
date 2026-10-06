import type {FloatArrayParam} from "../../base/math";
import type {SceneGeometry} from "./SceneGeometry";

/**
 * Evaluates weighted morph target position deltas for a geometry.
 *
 * This is a deterministic, non-mutating helper for import/export tooling,
 * baking and tests. It follows conventional morph semantics:
 *
 * `result = basePositions + sum(target.positions * weight)`
 *
 * Weights are not clamped. Negative and greater-than-one weights are valid
 * authored values in common interchange formats.
 */
export function evaluateMorphTargetPositions(
  basePositions: FloatArrayParam,
  morphTargets: SceneGeometry["morphTargets"],
  morphWeights: ArrayLike<number>,
  out: Float32Array = new Float32Array(basePositions.length)
): Float32Array {
  if (out.length !== basePositions.length) {
    throw new Error("[evaluateMorphTargetPositions] Output length must match base positions length.");
  }
  for (let i = 0; i < basePositions.length; i++) {
    out[i] = basePositions[i];
  }
  if (!morphTargets || morphTargets.length === 0) {
    return out;
  }
  if (morphWeights.length !== morphTargets.length) {
    throw new Error("[evaluateMorphTargetPositions] Morph weight count must match morph target count.");
  }
  for (let targetIndex = 0; targetIndex < morphTargets.length; targetIndex++) {
    const weight = morphWeights[targetIndex];
    if (!Number.isFinite(weight)) {
      throw new Error("[evaluateMorphTargetPositions] Morph weights must be finite.");
    }
    if (weight === 0) {
      continue;
    }
    const delta = morphTargets[targetIndex].positions;
    if (!delta) {
      continue;
    }
    if (delta.length !== basePositions.length) {
      throw new Error("[evaluateMorphTargetPositions] Morph target position delta length must match base positions length.");
    }
    for (let i = 0; i < basePositions.length; i++) {
      out[i] += delta[i] * weight;
    }
  }
  return out;
}

/**
 * Evaluates channel-0 UV deltas using the mesh's ordinary morph weights:
 * `result = baseUVs + sum(target.uvs * weight)`.
 *
 * Missing UV deltas contribute zero, including in mixed position/UV target banks.
 * UV-only targets are valid. Negative and greater-than-one weights are supported;
 * UVs are not clamped or wrapped. Base/target buffers are read-only inputs; callers
 * may supply a separate reusable output buffer to avoid per-frame allocation.
 * This helper has no renderer or animation-player dependencies.
 */
export function evaluateMorphTargetUVs(
  baseUVs: FloatArrayParam,
  morphTargets: SceneGeometry["morphTargets"],
  morphWeights: ArrayLike<number>,
  out: Float32Array = new Float32Array(baseUVs.length)
): Float32Array {
  if (baseUVs.length % 2 !== 0 || out.length !== baseUVs.length) {
    throw new Error("[evaluateMorphTargetUVs] Output length must match base UVs, with two values per vertex.");
  }
  if (morphWeights.length !== (morphTargets?.length ?? 0)) {
    throw new Error("[evaluateMorphTargetUVs] Morph weight count must match morph target count.");
  }
  out.set(baseUVs);
  for (let targetIndex = 0; targetIndex < (morphTargets?.length ?? 0); targetIndex++) {
    const weight = morphWeights[targetIndex];
    if (!Number.isFinite(weight)) throw new Error("[evaluateMorphTargetUVs] Morph weights must be finite.");
    const delta = morphTargets![targetIndex].uvs;
    if (!delta) continue;
    if (delta.length !== baseUVs.length) {
      throw new Error("[evaluateMorphTargetUVs] Morph target UV delta length must match base UVs length.");
    }
    if (weight === 0) continue;
    for (let i = 0; i < out.length; i++) out[i] += delta[i] * weight;
  }
  return out;
}
