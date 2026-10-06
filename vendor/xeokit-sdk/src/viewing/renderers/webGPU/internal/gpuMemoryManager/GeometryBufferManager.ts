import {SDKErrorType, type SDKResult} from "../../../../../base/core";
import {GaussianSplatsPrimitive, LinesPrimitive, PointsPrimitive, SolidPrimitive, SurfacePrimitive, TrianglesPrimitive} from "../../../../../base/constants";
import {decompressPositions3WithAABB3, octDecodeNormalsU16} from "../../../../../base/math/compression";
import {
  SCENE_GEOMETRY_UPDATE_INDICES,
  SCENE_GEOMETRY_UPDATE_NORMALS_COMPRESSED,
  SCENE_GEOMETRY_UPDATE_UVS_COMPRESSED,
  SCENE_GEOMETRY_UPDATE_POSITIONS_COMPRESSED,
  type SceneGeometry
} from "../../../../../model/scene";
import {GPU_BUFFER_USAGE} from "../constants";
import type {RenderContext} from "../RenderContext";
import type {RendererGeometry, RendererGeometryFrameState, RendererGeometryFrameStorage} from "./RendererGeometry";

const FRAME_FLAG_POSITIONS = 1;
const FRAME_FLAG_NORMALS = 2;
const FRAME_FLAG_UVS = 4;

/**
 * Owns CPU-side geometry decode state and immutable per-geometry GPU frame data
 * for WebGPU packed triangle batching.
 *
 * @internal
 */
export class GeometryBufferManager {

  private readonly _renderContext: RenderContext;
  private _geometryStates: {[geometryUniqueId: string]: RendererGeometry} = {};

  constructor(renderContext: RenderContext) {
    this._renderContext = renderContext;
  }

  public getOrCreateGeometryState(sceneGeometry: SceneGeometry): SDKResult<RendererGeometry> {
    const existing = this._geometryStates[sceneGeometry.uniqueId];
    if (existing) {
      return {
        ok: true,
        value: existing
      };
    }

    if (!sceneGeometry.aabb || !sceneGeometry.positionsCompressed) {
      return {
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[GeometryBufferManager.getOrCreateGeometryState] SceneGeometry '${sceneGeometry.uniqueId}' is missing positions or AABB.`
      };
    }
    if (sceneGeometry.framesCompressed && sceneGeometry.framesCompressed.length > 0 && !(
      sceneGeometry.primitive === TrianglesPrimitive ||
      sceneGeometry.primitive === SolidPrimitive ||
      sceneGeometry.primitive === SurfacePrimitive ||
      sceneGeometry.primitive === PointsPrimitive ||
      sceneGeometry.primitive === LinesPrimitive ||
      sceneGeometry.primitive === GaussianSplatsPrimitive
    )) {
      return {
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[GeometryBufferManager.getOrCreateGeometryState] SceneGeometry '${sceneGeometry.uniqueId}' has framesCompressed, but WebGPU frame animation currently supports triangle, point, line and gaussian-splat geometry only.`
      };
    }
    const isPointLike = sceneGeometry.primitive === PointsPrimitive || sceneGeometry.primitive === GaussianSplatsPrimitive;
    if (!isPointLike && !sceneGeometry.indices) {
      return {
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[GeometryBufferManager.getOrCreateGeometryState] SceneGeometry '${sceneGeometry.uniqueId}' is missing indices.`
      };
    }

    const positions = decompressPositions3WithAABB3(
      sceneGeometry.positionsCompressed,
      sceneGeometry.aabb,
      new Float32Array(sceneGeometry.positionsCompressed.length)
    ) as Float32Array;
    const normals = sceneGeometry.normalsCompressed
      ? octDecodeNormalsU16(
          sceneGeometry.normalsCompressed,
          new Float32Array((sceneGeometry.normalsCompressed.length / 2) * 3)
        ) as Float32Array
      : null;
    const indexData = isPointLike ? null : this._createIndexData(sceneGeometry.indices!);
    const edgeIndexData = sceneGeometry.edgeIndices && sceneGeometry.edgeIndices.length > 0
      ? this._createIndexData(sceneGeometry.edgeIndices)
      : null;
    const frameStorageResult = this._createFrameStorage(sceneGeometry);
    if (frameStorageResult.ok === false) {
      return frameStorageResult;
    }
    const renderAABB = frameStorageResult.value?.unionAABB ?? new Float32Array(sceneGeometry.aabb);
    const geometryState: RendererGeometry = {
      geometry: sceneGeometry,
      renderAABB,
      positions,
      uvs: sceneGeometry.uvsCompressed
        ? (sceneGeometry.uvsCompressed instanceof Float32Array
            ? sceneGeometry.uvsCompressed
            : new Float32Array(sceneGeometry.uvsCompressed))
        : null,
      texCoords: createTexCoordState(sceneGeometry),
      normals,
      indices: indexData?.data ?? null,
      edgeIndices: edgeIndexData?.data ?? null,
      indexFormat: indexData?.indexFormat ?? null,
      indexCount: indexData?.data.length ?? 0,
      edgeIndexCount: edgeIndexData?.data.length ?? 0,
      frameStorage: frameStorageResult.value,
      numMeshes: 0
    };
    this._geometryStates[sceneGeometry.uniqueId] = geometryState;

    return {
      ok: true,
      value: geometryState
    };
  }

  public destroyGeometryState(sceneGeometry: SceneGeometry): void {
    const geometryState = this._geometryStates[sceneGeometry.uniqueId];
    if (!geometryState) {
      return;
    }
    geometryState.frameStorage?.destroy();
    delete this._geometryStates[sceneGeometry.uniqueId];
  }

  public updateGeometryState(sceneGeometry: SceneGeometry, updateFlags: number): boolean {
    const geometryState = this._geometryStates[sceneGeometry.uniqueId];
    if (!geometryState || !sceneGeometry.aabb) {
      return false;
    }
    if ((updateFlags & SCENE_GEOMETRY_UPDATE_POSITIONS_COMPRESSED) !== 0) {
      decompressPositions3WithAABB3(sceneGeometry.positionsCompressed, sceneGeometry.aabb, geometryState.positions);
    }
    if ((updateFlags & SCENE_GEOMETRY_UPDATE_INDICES) !== 0) {
      const isPointLike = sceneGeometry.primitive === PointsPrimitive || sceneGeometry.primitive === GaussianSplatsPrimitive;
      if (isPointLike || !sceneGeometry.indices) {
        return false;
      }
      const indexData = this._createIndexData(sceneGeometry.indices);
      if (indexData.indexFormat !== geometryState.indexFormat || indexData.data.length !== geometryState.indexCount) {
        return false;
      }
      geometryState.indices = indexData.data;
      geometryState.indexFormat = indexData.indexFormat;
      geometryState.indexCount = indexData.data.length;
    }
    if ((updateFlags & SCENE_GEOMETRY_UPDATE_NORMALS_COMPRESSED) !== 0) {
      if (!sceneGeometry.normalsCompressed || !geometryState.normals) {
        return false;
      }
      if ((sceneGeometry.normalsCompressed.length / 2) * 3 !== geometryState.normals.length) {
        return false;
      }
      octDecodeNormalsU16(sceneGeometry.normalsCompressed, geometryState.normals);
    }
    if ((updateFlags & SCENE_GEOMETRY_UPDATE_UVS_COMPRESSED) !== 0) {
      if (!sceneGeometry.uvsCompressed || !geometryState.uvs || sceneGeometry.uvsCompressed.length !== geometryState.uvs.length) {
        return false;
      }
      geometryState.uvs = sceneGeometry.uvsCompressed instanceof Float32Array
        ? sceneGeometry.uvsCompressed : new Float32Array(sceneGeometry.uvsCompressed);
      geometryState.texCoords[0] = geometryState.uvs;
    }
    return true;
  }

  public destroyAll(): void {
    for (const geometryUniqueId of Object.keys(this._geometryStates)) {
      this.destroyGeometryState(this._geometryStates[geometryUniqueId].geometry);
    }
    this._geometryStates = {};
  }

  private _createIndexData(indices: ArrayLike<number>): {
    data: Uint16Array | Uint32Array;
    indexFormat: "uint16" | "uint32";
  } {
    let maxIndex = 0;
    for (let i = 0, len = indices.length; i < len; i++) {
      if (indices[i] > maxIndex) {
        maxIndex = indices[i];
      }
    }
    if (maxIndex > 65535) {
      return {
        data: indices instanceof Uint32Array ? indices : new Uint32Array(indices),
        indexFormat: "uint32"
      };
    }
    return {
      data: indices instanceof Uint16Array ? indices : new Uint16Array(indices),
      indexFormat: "uint16"
    };
  }

  private _createFrameStorage(sceneGeometry: SceneGeometry): SDKResult<RendererGeometryFrameStorage | null> {
    const frames = sceneGeometry.framesCompressed;
    if (!frames || frames.length === 0) {
      return {
        ok: true,
        value: null
      };
    }
    const vertexCount = sceneGeometry.positionsCompressed!.length / 3;
    const firstHasNormals = !!frames[0].normalsCompressed;
    const firstHasUVs = !!frames[0].uvsCompressed;
    for (let i = 0, len = frames.length; i < len; i++) {
      const frame = frames[i];
      if (!!frame.normalsCompressed !== firstHasNormals) {
        return {
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[GeometryBufferManager.getOrCreateGeometryState] SceneGeometry '${sceneGeometry.uniqueId}' has inconsistent frame normals at framesCompressed[${i}].`
        };
      }
      if (firstHasNormals && frame.normalsCompressed!.length !== vertexCount * 2) {
        return {
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[GeometryBufferManager.getOrCreateGeometryState] SceneGeometry '${sceneGeometry.uniqueId}' has mismatched frame normal count at framesCompressed[${i}].`
        };
      }
      if (!!frame.uvsCompressed !== firstHasUVs) {
        return {
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[GeometryBufferManager.getOrCreateGeometryState] SceneGeometry '${sceneGeometry.uniqueId}' has inconsistent frame UVs at framesCompressed[${i}].`
        };
      }
      if (firstHasUVs && frame.uvsCompressed!.length !== vertexCount * 2) {
        return {
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[GeometryBufferManager.getOrCreateGeometryState] SceneGeometry '${sceneGeometry.uniqueId}' has mismatched frame UV count at framesCompressed[${i}].`
        };
      }
    }

    const frameCount = frames.length;
    const packedPositions = new Uint32Array(frameCount * vertexCount * 2);
    const packedNormals = firstHasNormals ? new Uint32Array(frameCount * vertexCount) : null;
    const frameUVs = firstHasUVs ? new Float32Array(frameCount * vertexCount * 2) : null;
    const decodes = new Float32Array(frameCount * 8);
    const times = new Float32Array(frameCount);
    const unionAABB = new Float32Array([
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY
    ]);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const frame = frames[frameIndex];
      const positions = frame.positionsCompressed;
      const normals = frame.normalsCompressed;
      const frameVertexBase = frameIndex * vertexCount;
      for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
        const sourceOffset = vertexIndex * 3;
        const targetOffset = (frameVertexBase + vertexIndex) * 2;
        packedPositions[targetOffset] = (positions[sourceOffset] & 0xFFFF) | ((positions[sourceOffset + 1] & 0xFFFF) << 16);
        packedPositions[targetOffset + 1] = positions[sourceOffset + 2] & 0xFFFF;
      }
      if (packedNormals && normals) {
        for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
          const sourceOffset = vertexIndex * 2;
          packedNormals[frameVertexBase + vertexIndex] = (normals[sourceOffset] & 0xFFFF) | ((normals[sourceOffset + 1] & 0xFFFF) << 16);
        }
      }
      if (frameUVs && frame.uvsCompressed) {
        frameUVs.set(frame.uvsCompressed, frameIndex * vertexCount * 2);
      }
      const aabb = frame.aabb!;
      times[frameIndex] = frame.time;
      decodes[frameIndex * 8] = aabb[0];
      decodes[frameIndex * 8 + 1] = aabb[1];
      decodes[frameIndex * 8 + 2] = aabb[2];
      decodes[frameIndex * 8 + 3] = 0;
      decodes[frameIndex * 8 + 4] = (aabb[3] - aabb[0]) / 65535;
      decodes[frameIndex * 8 + 5] = (aabb[4] - aabb[1]) / 65535;
      decodes[frameIndex * 8 + 6] = (aabb[5] - aabb[2]) / 65535;
      decodes[frameIndex * 8 + 7] = 0;
      expandAABB(unionAABB, aabb);
    }

    const label = sceneGeometry.uniqueId.replace(/[^a-zA-Z0-9_.:-]/g, "_");
    const positionBuffer = this._renderContext.createGPUBuffer(
      `xeokit-webgpu-frame-positions:${label}`,
      packedPositions,
      GPU_BUFFER_USAGE.STORAGE
    );
    const positionDecodeBuffer = this._renderContext.createGPUBuffer(
      `xeokit-webgpu-frame-position-decodes:${label}`,
      decodes,
      GPU_BUFFER_USAGE.STORAGE
    );
    const normalBuffer = packedNormals
      ? this._renderContext.createGPUBuffer(
          `xeokit-webgpu-frame-normals:${label}`,
          packedNormals,
          GPU_BUFFER_USAGE.STORAGE
        )
      : null;
    const uvBuffer = frameUVs
      ? this._renderContext.createGPUBuffer(
          `xeokit-webgpu-frame-uvs:${label}`,
          frameUVs,
          GPU_BUFFER_USAGE.STORAGE
        )
      : null;

    return {
      ok: true,
      value: {
        vertexCount,
        frameCount,
        times,
        unionAABB,
        positionBuffer,
        positionDecodeBuffer,
        normalBuffer,
        uvBuffer,
        hasNormals: !!packedNormals,
        hasUVs: !!frameUVs,
        destroy: () => {
          this._renderContext.destroyGPUBuffer(positionBuffer);
          this._renderContext.destroyGPUBuffer(positionDecodeBuffer);
          this._renderContext.destroyGPUBuffer(normalBuffer);
          this._renderContext.destroyGPUBuffer(uvBuffer);
        }
      }
    };
  }

}

export function resolveFrameTime(
  geometryState: RendererGeometry,
  frameTime: number
): RendererGeometryFrameState {
  const storage = geometryState.frameStorage;
  if (!storage || storage.frameCount === 0) {
    return {
      frameAOffset: 0,
      frameBOffset: 0,
      frameADecodeIndex: 0,
      frameBDecodeIndex: 0,
      normalAOffset: 0,
      normalBOffset: 0,
      factor: 0,
      flags: 0
    };
  }

  const times = storage.times;
  const absoluteTime = times[0] + frameTime;
  let frameA = 0;
  let frameB = 0;
  let factor = 0;
  if (absoluteTime >= times[times.length - 1]) {
    frameA = times.length - 1;
    frameB = frameA;
  } else if (absoluteTime > times[0]) {
    for (let i = 1, len = times.length; i < len; i++) {
      if (absoluteTime <= times[i]) {
        if (absoluteTime === times[i]) {
          frameA = i;
          frameB = i;
        } else {
          frameA = i - 1;
          frameB = i;
          factor = (absoluteTime - times[frameA]) / (times[frameB] - times[frameA]);
        }
        break;
      }
    }
  }

  const frameAOffset = frameA * storage.vertexCount;
  const frameBOffset = frameB * storage.vertexCount;
  return {
    frameAOffset,
    frameBOffset,
    frameADecodeIndex: frameA,
    frameBDecodeIndex: frameB,
    normalAOffset: storage.hasNormals ? frameAOffset : 0,
    normalBOffset: storage.hasNormals ? frameBOffset : 0,
    factor,
    flags: FRAME_FLAG_POSITIONS | (storage.hasNormals ? FRAME_FLAG_NORMALS : 0) | (storage.hasUVs ? FRAME_FLAG_UVS : 0)
  };
}

function expandAABB(target: Float32Array, source: ArrayLike<number>): void {
  target[0] = Math.min(target[0], source[0]);
  target[1] = Math.min(target[1], source[1]);
  target[2] = Math.min(target[2], source[2]);
  target[3] = Math.max(target[3], source[3]);
  target[4] = Math.max(target[4], source[4]);
  target[5] = Math.max(target[5], source[5]);
}

function createTexCoordState(sceneGeometry: SceneGeometry): {[channel: number]: Float32Array} {
  const result: {[channel: number]: Float32Array} = {};
  const channels = sceneGeometry.texCoordsCompressed ?? (sceneGeometry.uvsCompressed ? {0: sceneGeometry.uvsCompressed} : undefined);
  if (!channels) {
    return result;
  }
  for (const key of Object.keys(channels)) {
    const channel = Number(key);
    const texCoords = channels[channel];
    if (!Number.isInteger(channel) || channel < 0 || !texCoords) {
      continue;
    }
    result[channel] = texCoords instanceof Float32Array ? texCoords : new Float32Array(texCoords);
  }
  return result;
}
