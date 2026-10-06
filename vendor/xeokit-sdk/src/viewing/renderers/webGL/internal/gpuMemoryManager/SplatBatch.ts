import {SplatDataTexture} from "./dataTextures/SplatDataTexture";
import {packSplats, SPLAT_FLOATS_PER_ITEM, type SplatAttributes} from "../../../../../formats/gaussiansplat/utils/packSplats";
import type {PortionHandle} from "./dataTextures/PortionDataTexture";
import {SDKErrorType, type SDKResult} from "../../../../../base/core";
import type {FloatArrayParam} from "../../../../../base/math";
import {VertexPositionTexture} from "./dataTextures/VertexPositionTexture";
import {FramePositionDecodeTexture} from "./dataTextures/FramePositionDecodeTexture";
import {SplatFrameStateTexture} from "./dataTextures/SplatFrameStateTexture";
import type {SceneGeometry} from "../../../../../model/scene";

/** A live splat portion: first splat item-index (`base`) and splat `count`. */
export interface SplatPortion {
  base: number;
  count: number;
}

const FRAME_FLAG_POSITIONS = 1 << 0;
const MAX_SPLAT_FRAME_POSITION_ITEMS = 4_000_000;
const MAX_SPLAT_FRAME_DECODE_ITEMS = 4096;
const MAX_SPLAT_FRAME_STATE_ITEMS = 65536;

export type SplatFrameStorage = {
  positionsHandle: PortionHandle;
  decodesHandle: PortionHandle;
  frameTimes: number[];
  frameCount: number;
  vertexCount: number;
  refCount: number;
};

type SplatFrameState = {
  frameAOffset: number;
  frameBOffset: number;
  frameADecodeBase: number;
  frameBDecodeBase: number;
  frameFactor: number;
  frameFlags: number;
};

function resolveSplatFrameTime(storage: SplatFrameStorage | null, frameTime: number | undefined): SplatFrameState {
  if (!storage || storage.frameCount === 0) {
    return {
      frameAOffset: 0,
      frameBOffset: 0,
      frameADecodeBase: 0,
      frameBDecodeBase: 0,
      frameFactor: 0,
      frameFlags: 0
    };
  }
  const times = storage.frameTimes;
  const absoluteTime = times[0] + (frameTime ?? 0);
  let frameA = 0;
  let frameB = 0;
  let factor = 0;
  if (absoluteTime <= times[0]) {
    frameA = 0;
    frameB = 0;
  } else if (absoluteTime >= times[storage.frameCount - 1]) {
    frameA = storage.frameCount - 1;
    frameB = frameA;
  } else {
    for (let i = 0; i < storage.frameCount - 1; i++) {
      const t0 = times[i];
      const t1 = times[i + 1];
      if (absoluteTime <= t1) {
        frameA = i;
        frameB = i + 1;
        factor = (absoluteTime - t0) / (t1 - t0);
        break;
      }
    }
  }
  return {
    frameAOffset: storage.positionsHandle.base + frameA * storage.vertexCount,
    frameBOffset: storage.positionsHandle.base + frameB * storage.vertexCount,
    frameADecodeBase: (storage.decodesHandle.base + frameA) * 2,
    frameBDecodeBase: (storage.decodesHandle.base + frameB) * 2,
    frameFactor: factor,
    frameFlags: FRAME_FLAG_POSITIONS
  };
}

function packSplatsWithFrameLocalIndices(attrs: SplatAttributes, worldMatrix?: FloatArrayParam, meshPickId = 0): Float32Array {
  const packed = packSplats(attrs, worldMatrix, meshPickId);
  const count = (packed.length / SPLAT_FLOATS_PER_ITEM) | 0;
  for (let i = 0; i < count; i++) {
    packed[i * SPLAT_FLOATS_PER_ITEM + 15] = i;
  }
  return packed;
}

/**
 * Streamable GPU storage for gaussian splats — the splat analogue of a
 * {@link GPUMemoryBatch}, but far thinner (no geometry/material/edge machinery).
 *
 * Splats are added/removed as freeable {@link PortionDataTexture} portions, so a
 * splat geometry streams in and out exactly like mesh vertex data. Each portion's
 * `{base, size}` gives the first splat index and splat count for the draw + sort.
 *
 * NOT unit-tested (owns a live GL texture) — the load-bearing packing it relies on
 * ({@link packSplats}) is. Verify end-to-end in the browser.
 */
export class SplatBatch {

  /** The shared splat-record texture (read by the GaussianSplatTechnique). */
  public readonly texture: SplatDataTexture;
  public readonly framePositionTexture: VertexPositionTexture;
  public readonly framePositionDecodeTexture: FramePositionDecodeTexture;
  public readonly frameStateTexture: SplatFrameStateTexture;

  private readonly _portions = new Map<PortionHandle, SplatPortion>();
  private readonly _frameStorageByGeometry = new Map<string, SplatFrameStorage>();

  /** Bumped on every add/remove, so consumers (the sort worker) know to re-read. */
  private _revision = 0;
  private _maxFrameStateItem = 0;

  constructor(gl: WebGL2RenderingContext, maxSplats: number) {
    this.texture = new SplatDataTexture({gl, maxItems: maxSplats, description: "SplatBatch"});
    this.framePositionTexture = new VertexPositionTexture({
      gl,
      maxItems: Math.max(maxSplats, MAX_SPLAT_FRAME_POSITION_ITEMS),
      description: "SplatBatch frame positions"
    });
    this.framePositionDecodeTexture = new FramePositionDecodeTexture({
      gl,
      maxItems: MAX_SPLAT_FRAME_DECODE_ITEMS,
      description: "SplatBatch frame position decodes"
    });
    this.frameStateTexture = new SplatFrameStateTexture({
      gl,
      maxItems: MAX_SPLAT_FRAME_STATE_ITEMS,
      description: "SplatBatch frame states",
      getNumItems: () => this._maxFrameStateItem
    });
  }

  /** Allocates the GPU texture. Call once before the first {@link addSplats}. */
  allocate(): SDKResult<void> {
    const splatResult = this.texture.allocate();
    if (splatResult.ok === false) return splatResult;
    const framePositionResult = this.framePositionTexture.allocate();
    if (framePositionResult.ok === false) return framePositionResult;
    const frameDecodeResult = this.framePositionDecodeTexture.allocate();
    if (frameDecodeResult.ok === false) return frameDecodeResult;
    return this.frameStateTexture.allocate();
  }

  /** Streams a splat geometry in. Returns its portion handle (`base`, `size`). */
  addSplats(attrs: SplatAttributes, worldMatrix?: FloatArrayParam, meshPickId = 0): SDKResult<PortionHandle> {
    const packed = packSplatsWithFrameLocalIndices(attrs, worldMatrix, meshPickId);
    const count = (packed.length / SPLAT_FLOATS_PER_ITEM) | 0;
    const portion: SplatPortion = {base: 0, count};
    // onMove keeps `base` valid if the texture packs/compacts later.
    const handle = this.texture.getPortion(packed, (newBase) => { portion.base = newBase; });
    if (!handle) {
      return {
        ok: false,
        type: SDKErrorType.MemoryAllocationFailed,
        error: "[SplatBatch.addSplats] Out of splat texture memory.",
      };
    }
    portion.base = handle.base;
    this._portions.set(handle, portion);
    this._revision++;
    return {ok: true, value: handle};
  }

  addGeometryFrames(sceneGeometry: SceneGeometry): SDKResult<SplatFrameStorage | null> {
    const frames = sceneGeometry.framesCompressed;
    if (!frames || frames.length === 0) {
      return {ok: true, value: null};
    }
    const key = sceneGeometry.uniqueId;
    const existing = this._frameStorageByGeometry.get(key);
    if (existing) {
      existing.refCount++;
      return {ok: true, value: existing};
    }
    const vertexCount = (frames[0].positionsCompressed.length / 3) | 0;
    const frameCount = frames.length;
    const positionData = new Uint16Array(vertexCount * frameCount * 3);
    const decodeData = new Float32Array(frameCount * 8);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const frame = frames[frameIndex];
      positionData.set(frame.positionsCompressed, frameIndex * vertexCount * 3);
      const aabb = frame.aabb!;
      const decodeOffset = frameIndex * 8;
      decodeData[decodeOffset] = aabb[0];
      decodeData[decodeOffset + 1] = aabb[1];
      decodeData[decodeOffset + 2] = aabb[2];
      decodeData[decodeOffset + 3] = 0;
      decodeData[decodeOffset + 4] = (aabb[3] - aabb[0]) / 65535;
      decodeData[decodeOffset + 5] = (aabb[4] - aabb[1]) / 65535;
      decodeData[decodeOffset + 6] = (aabb[5] - aabb[2]) / 65535;
      decodeData[decodeOffset + 7] = 0;
    }
    const positionsHandle = this.framePositionTexture.getPortion(positionData);
    if (!positionsHandle) {
      return {
        ok: false,
        type: SDKErrorType.MemoryAllocationFailed,
        error: `[SplatBatch.addGeometryFrames] Out of splat frame position texture memory for geometry '${sceneGeometry.id}'.`
      };
    }
    const decodesHandle = this.framePositionDecodeTexture.getPortion(decodeData);
    if (!decodesHandle) {
      this.framePositionTexture.putPortion(positionsHandle);
      return {
        ok: false,
        type: SDKErrorType.MemoryAllocationFailed,
        error: `[SplatBatch.addGeometryFrames] Out of splat frame decode texture memory for geometry '${sceneGeometry.id}'.`
      };
    }
    const storage: SplatFrameStorage = {
      positionsHandle,
      decodesHandle,
      frameTimes: frames.map((frame) => frame.time),
      frameCount,
      vertexCount,
      refCount: 1
    };
    this._frameStorageByGeometry.set(key, storage);
    return {ok: true, value: storage};
  }

  releaseGeometryFrames(sceneGeometry: SceneGeometry): void {
    const storage = this._frameStorageByGeometry.get(sceneGeometry.uniqueId);
    if (!storage) return;
    storage.refCount--;
    if (storage.refCount > 0) return;
    this.framePositionTexture.putPortion(storage.positionsHandle);
    this.framePositionDecodeTexture.putPortion(storage.decodesHandle);
    this._frameStorageByGeometry.delete(sceneGeometry.uniqueId);
  }

  setFrameState(meshPickId: number, storage: SplatFrameStorage | null, frameTime: number | undefined, worldMatrix?: FloatArrayParam): SDKResult<void> {
    if (meshPickId < 0 || meshPickId >= MAX_SPLAT_FRAME_STATE_ITEMS) {
      return {
        ok: false,
        type: SDKErrorType.MemoryAllocationFailed,
        error: `[SplatBatch.setFrameState] Splat mesh pick id ${meshPickId} exceeds frame-state texture capacity.`
      };
    }
    const frameState = resolveSplatFrameTime(storage, frameTime);
    this._maxFrameStateItem = Math.max(this._maxFrameStateItem, meshPickId + 1);
    this.frameStateTexture.setItem(meshPickId, {
      ...frameState,
      worldMatrix
    });
    this._revision++;
    return {ok: true, value: undefined};
  }

  /**
   * Re-packs an existing portion with a new world matrix (live re-transform).
   * In-place (same splat count) and bumps the revision so the sort re-runs.
   */
  updateSplats(handle: PortionHandle, attrs: SplatAttributes, worldMatrix?: FloatArrayParam, meshPickId = 0): void {
    if (!this._portions.has(handle)) return;
    const packed = packSplatsWithFrameLocalIndices(attrs, worldMatrix, meshPickId);
    this.texture.setPortionData(handle, packed);
    this._revision++;
  }

  /** Streams a splat geometry out, freeing its portion back to the texture. */
  removeSplats(handle: PortionHandle): void {
    if (this._portions.delete(handle)) {
      this.texture.putPortion(handle);
      this._revision++;
    }
  }

  /** Flushes dirty portions to the GPU. Call after add/remove, before draw. */
  uploadChanges(): void {
    this.texture.uploadChanges();
    this.framePositionTexture.uploadChanges();
    this.framePositionDecodeTexture.uploadChanges();
    this.frameStateTexture.uploadChanges();
  }

  /**
   * Recreates the splat texture after a WebGL context restore, re-uploading the
   * packed splat records from the texture's CPU mirror. Bumps the revision so
   * the draw technique re-feeds its sort worker.
   */
  webglContextRestored(): SDKResult<void> {
    const result = this.texture.webglContextRestored();
    if (result.ok === false) {
      return result;
    }
    const framePositionResult = this.framePositionTexture.webglContextRestored();
    if (framePositionResult.ok === false) {
      return framePositionResult;
    }
    const frameDecodeResult = this.framePositionDecodeTexture.webglContextRestored();
    if (frameDecodeResult.ok === false) {
      return frameDecodeResult;
    }
    const frameStateResult = this.frameStateTexture.webglContextRestored();
    if (frameStateResult.ok === false) {
      return frameStateResult;
    }
    this._revision++;
    return {ok: true, value: undefined};
  }

  /**
   * Rebinds this wrapper to a restored WebGL context before reallocating its
   * splat texture.
   * @internal
   */
  setWebGLContext(gl: WebGL2RenderingContext): void {
    this.texture.setWebGLContext(gl);
    this.framePositionTexture.setWebGLContext(gl);
    this.framePositionDecodeTexture.setWebGLContext(gl);
    this.frameStateTexture.setWebGLContext(gl);
  }

  /** Live portions, each carrying `{base, count}` for the sort/draw. */
  get portions(): Iterable<SplatPortion> {
    return this._portions.values();
  }

  /** Total splats currently resident. */
  get numSplats(): number {
    return this.texture.numItems;
  }

  /** Increments whenever splats or their frame-state centers change. */
  get revision(): number {
    return this._revision;
  }

  /**
   * Extracts current world-space splat centers for depth sorting.
   *
   * Static splats use the baked center in the splat record. Framed splats use
   * the same frame offsets, interpolation factor, and world matrix that the
   * shader uses for drawing, so sort order tracks the morphed centers without
   * uploading blended splat positions to the GPU.
   */
  extractSortCenters(): {positions: Float32Array; itemIndices: Uint32Array} {
    const splatBuffer = this.texture.buffer as Float32Array;
    const framePositionBuffer = this.framePositionTexture.buffer as Uint16Array;
    const frameDecodeBuffer = this.framePositionDecodeTexture.buffer as Float32Array;
    const frameStateBuffer = this.frameStateTexture.buffer as Float32Array;
    const epi = this.texture.elementsPerItem;
    const stateElementsPerItem = this.frameStateTexture.elementsPerItem;
    const positions = new Float32Array(this.numSplats * 3);
    const itemIndices = new Uint32Array(this.numSplats);
    let k = 0;
    for (const p of this._portions.values()) {
      for (let i = 0; i < p.count; i++) {
        const item = p.base + i;
        const o = item * epi;
        const meshPickId = Math.round(splatBuffer[o + 7]);
        const stateBase = meshPickId * stateElementsPerItem;
        const frameFlags = Math.round(frameStateBuffer[stateBase + 5] || 0);
        if ((frameFlags & FRAME_FLAG_POSITIONS) !== 0) {
          const localSplatIndex = Math.round(splatBuffer[o + 15]);
          const factor = frameStateBuffer[stateBase + 4];
          const frameAOffset = Math.round(frameStateBuffer[stateBase]);
          const frameBOffset = Math.round(frameStateBuffer[stateBase + 1]);
          const frameADecodeBase = Math.round(frameStateBuffer[stateBase + 2]);
          const frameBDecodeBase = Math.round(frameStateBuffer[stateBase + 3]);
          const ax = decodeFramePositionComponent(framePositionBuffer, frameDecodeBuffer, frameAOffset + localSplatIndex, frameADecodeBase, 0);
          const ay = decodeFramePositionComponent(framePositionBuffer, frameDecodeBuffer, frameAOffset + localSplatIndex, frameADecodeBase, 1);
          const az = decodeFramePositionComponent(framePositionBuffer, frameDecodeBuffer, frameAOffset + localSplatIndex, frameADecodeBase, 2);
          const bx = decodeFramePositionComponent(framePositionBuffer, frameDecodeBuffer, frameBOffset + localSplatIndex, frameBDecodeBase, 0);
          const by = decodeFramePositionComponent(framePositionBuffer, frameDecodeBuffer, frameBOffset + localSplatIndex, frameBDecodeBase, 1);
          const bz = decodeFramePositionComponent(framePositionBuffer, frameDecodeBuffer, frameBOffset + localSplatIndex, frameBDecodeBase, 2);
          const lx = ax + (bx - ax) * factor;
          const ly = ay + (by - ay) * factor;
          const lz = az + (bz - az) * factor;
          positions[k * 3] = frameStateBuffer[stateBase + 8] * lx + frameStateBuffer[stateBase + 12] * ly + frameStateBuffer[stateBase + 16] * lz + frameStateBuffer[stateBase + 20];
          positions[k * 3 + 1] = frameStateBuffer[stateBase + 9] * lx + frameStateBuffer[stateBase + 13] * ly + frameStateBuffer[stateBase + 17] * lz + frameStateBuffer[stateBase + 21];
          positions[k * 3 + 2] = frameStateBuffer[stateBase + 10] * lx + frameStateBuffer[stateBase + 14] * ly + frameStateBuffer[stateBase + 18] * lz + frameStateBuffer[stateBase + 22];
        } else {
          positions[k * 3] = splatBuffer[o];
          positions[k * 3 + 1] = splatBuffer[o + 1];
          positions[k * 3 + 2] = splatBuffer[o + 2];
        }
        itemIndices[k] = item;
        k++;
      }
    }
    return {positions, itemIndices};
  }

  destroy(): void {
    this.texture.destroy();
    this.framePositionTexture.destroy();
    this.framePositionDecodeTexture.destroy();
    this.frameStateTexture.destroy();
    this._frameStorageByGeometry.clear();
  }
}

function decodeFramePositionComponent(
  positionBuffer: Uint16Array,
  decodeBuffer: Float32Array,
  positionIndex: number,
  decodeTexelBase: number,
  component: 0 | 1 | 2
): number {
  return decodeBuffer[decodeTexelBase * 4 + component] +
    positionBuffer[positionIndex * 3 + component] * decodeBuffer[(decodeTexelBase + 1) * 4 + component];
}
