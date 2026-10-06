import {createQuatFloat64} from "../../../base/math/quat";
import {createVec3Float64} from "../../../base/math/vector";
import type {SceneModel} from "../SceneModel";
import type {SceneAnimation} from "./SceneAnimation";
import type {SceneAnimationChannelParams} from "./SceneAnimationParams";
import type {SceneAnimationState, SceneAnimationTransformState} from "./SceneAnimationState";
import {interpolateQuaternion, readQuaternionSample} from "./interpolation/interpolateQuaternion";
import {interpolateVec3, readVec3Sample} from "./interpolation/interpolateVec3";

function findSampleInterval(times: ArrayLike<number>, time: number): {a: number; b: number; t: number} {
  if (time <= times[0]) {
    return {a: 0, b: 0, t: 0};
  }
  const last = times.length - 1;
  if (time >= times[last]) {
    return {a: last, b: last, t: 0};
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return {a: lo, b: hi, t: (time - times[lo]) / (times[hi] - times[lo])};
}

function ensureTransformState(state: SceneAnimationState, transformId: string): SceneAnimationTransformState {
  return state.transforms[transformId] || (state.transforms[transformId] = {});
}

function readWeightSample(values: ArrayLike<number>, sampleIndex: number, valueSize: number): number[] {
  const offset = sampleIndex * valueSize;
  const out = new Array(valueSize);
  for (let i = 0; i < valueSize; i++) {
    out[i] = values[offset + i];
  }
  return out;
}

function interpolateWeightSample(values: ArrayLike<number>, a: number, b: number, t: number, valueSize: number): number[] {
  const aOffset = a * valueSize;
  const bOffset = b * valueSize;
  const out = new Array(valueSize);
  for (let i = 0; i < valueSize; i++) {
    const av = values[aOffset + i];
    out[i] = av + (values[bOffset + i] - av) * t;
  }
  return out;
}

function readVertexStateIndex(values: ArrayLike<number>, sampleIndex: number): number {
  return Math.trunc(values[sampleIndex]);
}

function evaluateChannel(channel: SceneAnimationChannelParams, time: number, state: SceneAnimationState): void {
  const {target, sampler} = channel;
  if (target.type === "morphWeights") {
    const valueSize = sampler.valueSize!;
    const interval = findSampleInterval(sampler.times, time);
    const sample = sampler.interpolation === "STEP" || interval.a === interval.b ? interval.a : -1;
    state.morphWeights[target.meshId] = sample >= 0
      ? readWeightSample(sampler.values, sample, valueSize)
      : interpolateWeightSample(sampler.values, interval.a, interval.b, interval.t, valueSize);
    return;
  }
  if (target.type === "vertexState") {
    const interval = findSampleInterval(sampler.times, time);
    if (sampler.interpolation === "STEP" || interval.a === interval.b) {
      const index = readVertexStateIndex(sampler.values, interval.a);
      state.vertexStates[target.meshId] = {stateAIndex: index, stateBIndex: index, factor: 0};
    } else {
      state.vertexStates[target.meshId] = {
        stateAIndex: readVertexStateIndex(sampler.values, interval.a),
        stateBIndex: readVertexStateIndex(sampler.values, interval.b),
        factor: interval.t
      };
    }
    return;
  }
  if (target.type !== "transform") {
    return;
  }
  const interval = findSampleInterval(sampler.times, time);
  const sample = sampler.interpolation === "STEP" || interval.a === interval.b ? interval.a : -1;
  const transformState = ensureTransformState(state, target.transformId);
  if (target.property === "rotation") {
    transformState.rotation = sample >= 0
      ? readQuaternionSample(sampler.values, sample, createQuatFloat64())
      : interpolateQuaternion(sampler.values, interval.a, interval.b, interval.t, createQuatFloat64());
  } else if (target.property === "translation") {
    transformState.translation = sample >= 0
      ? readVec3Sample(sampler.values, sample, createVec3Float64())
      : interpolateVec3(sampler.values, interval.a, interval.b, interval.t, createVec3Float64());
  } else {
    transformState.scale = sample >= 0
      ? readVec3Sample(sampler.values, sample, createVec3Float64())
      : interpolateVec3(sampler.values, interval.a, interval.b, interval.t, createVec3Float64());
  }
}

/**
 * Deterministically evaluates SceneAnimation assets without mutating Scene state.
 *
 * The evaluator is independent of playback. Calling evaluate() with the same
 * model, animation and time produces the same SceneAnimationState and does not
 * write to SceneTransform instances.
 *
 * Times outside a sampler's authored range are clamped to that sampler's first
 * or last sample. Non-finite times evaluate at the animation start time.
 */
export class SceneAnimationEvaluator {
  /**
   * Evaluates an animation at an arbitrary authored time.
   *
   * The model argument provides the scene-model context for the animation API.
   * This method currently samples transform channels and returns explicit
   * transform values in the resulting SceneAnimationState.
   */
  evaluate(_model: SceneModel, animation: SceneAnimation, time: number): SceneAnimationState {
    const sampleTime = Number.isFinite(time) ? time : animation.startTime;
    const state: SceneAnimationState = {
      animationId: animation.id,
      time: sampleTime,
      transforms: {},
      morphWeights: {},
      vertexStates: {}
    };
    for (const channel of animation.channels) {
      evaluateChannel(channel, sampleTime, state);
    }
    return state;
  }
}
