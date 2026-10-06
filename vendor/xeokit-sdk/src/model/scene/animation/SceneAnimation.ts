import {SDKErrorType, type SDKResult} from "../../../base/core";
import type {SceneModel} from "../SceneModel";
import type {
  SceneAnimationChannelParams,
  SceneAnimationInterpolation,
  SceneAnimationParams,
  SceneAnimationSamplerParams,
  SceneAnimationTargetParams
} from "./SceneAnimationParams";

function cloneNumberArray(values: ArrayLike<number>): number[] {
  return Array.from(values);
}

function validateSampler(target: SceneAnimationTargetParams, sampler: SceneAnimationSamplerParams): string | null {
  if (!sampler) {
    return "Missing sampler.";
  }
  const times = sampler.times;
  const values = sampler.values;
  if (!times || times.length === 0) {
    return "Sampler times must contain at least one time.";
  }
  if (!values || values.length === 0) {
    return "Sampler values must contain at least one value.";
  }
  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i])) {
      return `Sampler time at index ${i} is not finite.`;
    }
    if (i > 0 && times[i] <= times[i - 1]) {
      return "Sampler times must be strictly increasing.";
    }
  }
  const interpolation = sampler.interpolation ?? "LINEAR";
  if (interpolation !== "STEP" && interpolation !== "LINEAR") {
    return `Unsupported interpolation '${interpolation}'.`;
  }
  let valueSize: number;
  if (target.type === "transform") {
    valueSize = target.property === "rotation" ? 4 : 3;
  } else if (target.type === "vertexState") {
    valueSize = 1;
  } else {
    if (!Number.isInteger(sampler.valueSize) || sampler.valueSize! <= 0) {
      return "Morph-weight sampler requires a positive integer valueSize.";
    }
    valueSize = sampler.valueSize!;
  }
  if (values.length !== times.length * valueSize) {
    return `Sampler values length must be times.length * ${valueSize}.`;
  }
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      return `Sampler value at index ${i} is not finite.`;
    }
    if (target.type === "vertexState" && (!Number.isInteger(values[i]) || values[i] < 0)) {
      return `Vertex-state sampler value at index ${i} must be a non-negative integer state index.`;
    }
  }
  return null;
}

function validateTarget(target: SceneAnimationTargetParams): string | null {
  if (!target) {
    return "Missing channel target.";
  }
  if (target.type === "vertexState") {
    if (!target.meshId) {
      return "Vertex-state animation target requires target.meshId.";
    }
    return null;
  }
  if (target.type === "morphWeights") {
    if (!target.meshId) {
      return "Morph-weight animation target requires target.meshId.";
    }
    return null;
  }
  if (target.type !== "transform") {
    return `Unsupported animation target type '${(target as any).type}'.`;
  }
  if (!target.transformId) {
    return "Transform animation target requires target.transformId.";
  }
  if (target.property !== "translation" && target.property !== "rotation" && target.property !== "scale") {
    return `Unsupported transform animation property '${(target as any).property}'.`;
  }
  return null;
}

function cloneChannel(channel: SceneAnimationChannelParams): SceneAnimationChannelParams {
  const times = Object.freeze(cloneNumberArray(channel.sampler.times)) as unknown as number[];
  const values = Object.freeze(cloneNumberArray(channel.sampler.values)) as unknown as number[];
  return {
    target: Object.freeze({...channel.target}) as SceneAnimationTargetParams,
    sampler: Object.freeze({
      times,
      values,
      ...(channel.sampler.valueSize !== undefined ? {valueSize: channel.sampler.valueSize} : {}),
      interpolation: channel.sampler.interpolation ?? "LINEAR"
    }) as SceneAnimationSamplerParams
  };
}

/**
 * Immutable authored scene animation asset owned by a SceneModel.
 *
 * SceneAnimation stores semantic sampled channels only. It has no runtime
 * playback state such as play/pause, loop, speed or current time.
 *
 * Use SceneAnimationEvaluator to evaluate this authored data into explicit
 * SceneAnimationState values. Use SceneAnimationStateApplier or
 * SceneAnimationPlayer when those values should affect live SceneTransform
 * instances.
 */
export class SceneAnimation {
  readonly id: string;
  readonly name?: string;
  readonly model: SceneModel;
  readonly channels: ReadonlyArray<SceneAnimationChannelParams>;
  destroyed: boolean = false;

  constructor(model: SceneModel, params: SceneAnimationParams) {
    this.model = model;
    this.id = params.id;
    this.name = params.name;
    this.channels = Object.freeze(params.channels.map(cloneChannel));
  }

  get startTime(): number {
    let startTime = Infinity;
    for (const channel of this.channels) {
      startTime = Math.min(startTime, channel.sampler.times[0]);
    }
    return startTime === Infinity ? 0 : startTime;
  }

  /**
   * Last authored sample time across all channels.
   */
  get endTime(): number {
    let endTime = -Infinity;
    for (const channel of this.channels) {
      const times = channel.sampler.times;
      endTime = Math.max(endTime, times[times.length - 1]);
    }
    return endTime === -Infinity ? 0 : endTime;
  }

  /**
   * Difference between the first and last authored sample times.
   */
  get duration(): number {
    return Math.max(0, this.endTime - this.startTime);
  }

  /**
   * Serializes this immutable animation asset back to JSON-friendly params.
   */
  toParams(): SDKResult<SceneAnimationParams> {
    if (this.destroyed) {
      return this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneAnimation.toParams] Cannot serialize destroyed SceneAnimation ${this.id}`
      });
    }
    return {
      ok: true,
      value: {
        id: this.id,
        ...(this.name !== undefined ? {name: this.name} : {}),
        channels: this.channels.map(cloneChannel)
      }
    };
  }

  /**
   * Removes this animation from its owning SceneModel.
   */
  destroy(): SDKResult<void> {
    if (this.destroyed) {
      return this.model.scene.logError({
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[SceneAnimation.destroy] SceneAnimation ${this.id} already destroyed`
      });
    }
    this.model._destroyAnimation(this);
    this.destroyed = true;
    return {ok: true, value: undefined};
  }

  /**
   * Validates animation params without creating a SceneAnimation.
   */
  static validateParams(params: SceneAnimationParams): string | null {
    if (!params) {
      return "Missing SceneAnimationParams.";
    }
    if (!params.id) {
      return "SceneAnimationParams.id is required.";
    }
    if (!params.channels || !Array.isArray(params.channels)) {
      return "SceneAnimationParams.channels must be an array.";
    }
    for (let i = 0; i < params.channels.length; i++) {
      const channel = params.channels[i];
      const targetError = validateTarget(channel?.target);
      if (targetError) {
        return `Channel ${i}: ${targetError}`;
      }
      const samplerError = validateSampler(channel.target, channel.sampler);
      if (samplerError) {
        return `Channel ${i}: ${samplerError}`;
      }
    }
    return null;
  }
}

export type {SceneAnimationInterpolation};
