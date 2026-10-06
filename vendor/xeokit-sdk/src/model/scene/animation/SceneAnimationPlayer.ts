import {SDKTask, type SDKResult} from "../../../base/core";
import type {SceneModel} from "../SceneModel";
import type {SceneAnimation} from "./SceneAnimation";
import {SceneAnimationEvaluator} from "./SceneAnimationEvaluator";
import {SceneAnimationStateApplier} from "./SceneAnimationStateApplier";

/**
 * Runtime playback controller for a SceneAnimation.
 *
 * The player owns playback state only. It delegates all sampling to
 * SceneAnimationEvaluator and all Scene mutation to SceneAnimationStateApplier.
 * It can loop, clamp, scrub and advance authored time, but does not contain
 * interpolation logic.
 */
export class SceneAnimationPlayer {
  readonly model: SceneModel;
  readonly evaluator: SceneAnimationEvaluator;
  readonly applier: SceneAnimationStateApplier;
  animation: SceneAnimation | null;
  currentTime: number;
  speed: number;
  loop: boolean;
  playing: boolean = false;
  private _lastWallTime: number = 0;
  private _task: SDKTask;

  constructor(params: {
    model: SceneModel;
    animation?: SceneAnimation;
    evaluator?: SceneAnimationEvaluator;
    applier?: SceneAnimationStateApplier;
    loop?: boolean;
    speed?: number;
    currentTime?: number;
  }) {
    this.model = params.model;
    this.animation = params.animation ?? null;
    this.evaluator = params.evaluator ?? new SceneAnimationEvaluator();
    this.applier = params.applier ?? new SceneAnimationStateApplier();
    this.loop = params.loop ?? true;
    this.speed = params.speed ?? 1;
    this.currentTime = params.currentTime ?? this.animation?.startTime ?? 0;
    this._task = new SDKTask({
      name: "SceneAnimationPlayer._update",
      stage: SDKTask.AnimateStage,
      repeat: true,
      task: () => this.update()
    });
  }

  /**
   * Starts advancing currentTime on the SDK animation task stage.
   */
  play(): void {
    this.playing = true;
    this._lastWallTime = this._now();
  }

  /**
   * Stops automatic time advancement without changing currentTime.
   */
  pause(): void {
    this.playing = false;
  }

  /**
   * Stops playback and applies the animation at its authored start time.
   */
  stop(): void {
    this.playing = false;
    this.currentTime = this.animation?.startTime ?? 0;
    this.apply();
  }

  /**
   * Selects the animation to play and resets currentTime to its start time.
   */
  setAnimation(animation: SceneAnimation | null): void {
    this.animation = animation;
    this.currentTime = animation?.startTime ?? 0;
    this.apply();
  }

  /**
   * Moves to an authored time and applies the evaluated state.
   *
   * When looping is enabled the time wraps into the animation range. Otherwise
   * the time clamps to the authored range.
   */
  seek(time: number): SDKResult<void> {
    this.currentTime = this.animation ? this._advanceTime(time) : time;
    return this.apply();
  }

  /**
   * Advances playback by deltaSeconds, or by wall-clock time when omitted.
   */
  update(deltaSeconds?: number): SDKResult<void> | undefined {
    if (!this.playing || !this.animation) {
      return;
    }
    const now = this._now();
    const delta = deltaSeconds !== undefined ? deltaSeconds : (now - this._lastWallTime) / 1000;
    this._lastWallTime = now;
    this.currentTime = this._advanceTime(this.currentTime + delta * this.speed);
    return this.apply();
  }

  /**
   * Evaluates currentTime and applies the resulting state to the live model.
   */
  apply(): SDKResult<void> {
    if (!this.animation) {
      return {ok: true, value: undefined};
    }
    return this.applier.apply(this.model, this.evaluator.evaluate(this.model, this.animation, this.currentTime));
  }

  /**
   * Stops the player and releases its scheduled task.
   */
  destroy(): void {
    this._task.destroy();
    this.playing = false;
    this.animation = null;
  }

  private _advanceTime(time: number): number {
    const animation = this.animation!;
    const start = animation.startTime;
    const end = animation.endTime;
    const duration = animation.duration;
    if (duration <= 0) {
      return start;
    }
    if (this.loop) {
      const wrapped = (time - start) % duration;
      return start + (wrapped < 0 ? wrapped + duration : wrapped);
    }
    return Math.max(start, Math.min(end, time));
  }

  private _now(): number {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }
}
