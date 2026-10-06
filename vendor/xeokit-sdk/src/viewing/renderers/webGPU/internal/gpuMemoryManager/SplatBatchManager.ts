import {GaussianSplatsPrimitive} from "../../../../../base/constants";
import {SDKErrorType, type SDKResult} from "../../../../../base/core";
import type {FloatArrayParam} from "../../../../../base/math";
import type {View} from "../../../../viewer";
import type {WebGPUBindGroupLike, WebGPUBufferLike} from "../../core";
import {GPU_BUFFER_USAGE} from "../constants";
import type {InstancedDrawBatch, PackedMeshBatch} from "../drawOps";
import type {MeshManager, RendererMesh} from "../meshManager";
import {RenderContext} from "../RenderContext";
import {packSplats, SPLAT_FLOATS_PER_ITEM, type SplatAttributes} from "../../../../../formats/gaussiansplat/utils/packSplats";
import {sortSplatsByDepth} from "../../../webGL/internal/gpuMemoryManager/sortSplats";
import {BindGroupLayoutManager} from "./BindGroupLayoutManager";
import {resolveFrameTime} from "./GeometryBufferManager";
import type {RendererGeometry} from "./RendererGeometry";

const SPLAT_FRAME_STATE_FLOATS = 24;

export interface SplatBatchSet {
  batches: InstancedDrawBatch[];
  meshStateByGlobalSlot: Map<number, RendererMesh>;
  slotCount: number;
  splatCount: number;
}

/**
 * Packs SceneModel gaussian splats into WebGPU storage buffers and keeps their
 * sorted item-index buffer current for alpha blending and ID picking.
 *
 * @internal
 */
export class SplatBatchManager {

  private readonly _renderContext: RenderContext;
  private readonly _bindGroupLayoutManager: BindGroupLayoutManager;
  private readonly _meshStateByGlobalSlot = new Map<number, RendererMesh>();
  private _packedData: Float32Array = new Float32Array(0);
  private _centres: Float32Array = new Float32Array(0);
  private _itemIndices: Uint32Array = new Uint32Array(0);
  private _sortedIndices: Uint32Array = new Uint32Array(0);
  private _slotFrameStates: Float32Array = new Float32Array(0);
  private _dataBuffer: WebGPUBufferLike | null = null;
  private _indexBuffer: WebGPUBufferLike | null = null;
  private _framePositionBuffer: WebGPUBufferLike | null = null;
  private _framePositionDecodeBuffer: WebGPUBufferLike | null = null;
  private _slotFrameStateBuffer: WebGPUBufferLike | null = null;
  private _bindGroup: WebGPUBindGroupLike | null = null;
  private _batch: InstancedDrawBatch | null = null;
  private _frameBasesByGeometry = new Map<RendererGeometry, {
    frameDataBase: number;
    frameDecodeBase: number;
  }>();
  private _structureKey = "";
  private _cameraKey = "";
  private _slotCount = 0;
  private _splatCount = 0;

  constructor(params: {
    renderContext: RenderContext;
    bindGroupLayoutManager: BindGroupLayoutManager;
  }) {
    this._renderContext = params.renderContext;
    this._bindGroupLayoutManager = params.bindGroupLayoutManager;
  }

  public prepare(params: {
    meshManager: MeshManager;
    view: View;
    baseGlobalSlot: number;
  }): SDKResult<SplatBatchSet> {
    const splatMeshes = this._collectVisibleSplatMeshes(params.meshManager, params.view);
    const structureKey = this._createStructureKey(splatMeshes, params.baseGlobalSlot);
    if (structureKey !== this._structureKey) {
      const rebuildResult = this._rebuildBuffers(params.meshManager, splatMeshes, params.baseGlobalSlot);
      if (rebuildResult.ok === false) {
        return rebuildResult;
      }
      this._structureKey = structureKey;
      this._cameraKey = "";
    }

    if (this._splatCount === 0 || !this._batch) {
      return {
        ok: true,
        value: {
          batches: [],
          meshStateByGlobalSlot: this._meshStateByGlobalSlot,
          slotCount: 0,
          splatCount: 0
        }
      };
    }

    this._updateSlotFrameStates();

    const cameraKey = this._createCameraKey(params.view);
    if (cameraKey !== this._cameraKey) {
      this._sortedIndices = sortSplatsByDepth(this._centres, this._itemIndices, params.view.camera.viewMatrix as unknown as Float32Array);
      this._renderContext.device.queue.writeBuffer(this._indexBuffer!, 0, this._sortedIndices);
      this._cameraKey = cameraKey;
    }

    return {
      ok: true,
      value: {
        batches: [this._batch],
        meshStateByGlobalSlot: this._meshStateByGlobalSlot,
        slotCount: this._slotCount,
        splatCount: this._splatCount
      }
    };
  }

  public destroy(): void {
    try {
      this._dataBuffer?.destroy?.();
      this._indexBuffer?.destroy?.();
      this._framePositionBuffer?.destroy?.();
      this._framePositionDecodeBuffer?.destroy?.();
      this._slotFrameStateBuffer?.destroy?.();
    } catch {
      // Ignore backend destruction failures during renderer teardown.
    }
    this._dataBuffer = null;
    this._indexBuffer = null;
    this._framePositionBuffer = null;
    this._framePositionDecodeBuffer = null;
    this._slotFrameStateBuffer = null;
    this._bindGroup = null;
    this._batch = null;
    this._packedData = new Float32Array(0);
    this._centres = new Float32Array(0);
    this._itemIndices = new Uint32Array(0);
    this._sortedIndices = new Uint32Array(0);
    this._slotFrameStates = new Float32Array(0);
    this._meshStateByGlobalSlot.clear();
    this._frameBasesByGeometry.clear();
    this._structureKey = "";
    this._cameraKey = "";
    this._slotCount = 0;
    this._splatCount = 0;
  }

  private _collectVisibleSplatMeshes(meshManager: MeshManager, view: View): RendererMesh[] {
    const meshes: RendererMesh[] = [];
    for (let i = 0, len = meshManager.meshStates.length; i < len; i++) {
      const meshState = meshManager.meshStates[i];
      if (meshState.geometryState.geometry.primitive !== GaussianSplatsPrimitive) {
        continue;
      }
      if (!meshManager.isMeshVisibleInView(meshState, view) || meshManager.getMeshOpacityInView(meshState, view) <= 0) {
        continue;
      }
      meshes.push(meshState);
    }
    return meshes;
  }

  private _rebuildBuffers(meshManager: MeshManager, meshes: RendererMesh[], baseGlobalSlot: number): SDKResult<void> {
    this._meshStateByGlobalSlot.clear();
    const packedParts: Float32Array[] = [];
    let splatCount = 0;
    for (let i = 0, len = meshes.length; i < len; i++) {
      const meshState = meshes[i];
      const attrs = this._getSplatAttributes(meshState);
      if (!attrs) {
        continue;
      }
      const globalSlot = baseGlobalSlot + this._meshStateByGlobalSlot.size;
      this._meshStateByGlobalSlot.set(globalSlot, meshState);
      const packed = packSplats(attrs, meshManager.getMeshWorldMatrix(meshState) as unknown as FloatArrayParam, globalSlot);
      for (let splatIndex = 0, splatLen = packed.length / SPLAT_FLOATS_PER_ITEM; splatIndex < splatLen; splatIndex++) {
        packed[splatIndex * SPLAT_FLOATS_PER_ITEM + 15] = splatIndex;
      }
      packedParts.push(packed);
      splatCount += packed.length / SPLAT_FLOATS_PER_ITEM;
    }

    if (splatCount === 0) {
      this.destroy();
      return {ok: true, value: undefined};
    }

    this._packedData = new Float32Array(splatCount * SPLAT_FLOATS_PER_ITEM);
    this._centres = new Float32Array(splatCount * 3);
    this._itemIndices = new Uint32Array(splatCount);
    let dataOffset = 0;
    let centreOffset = 0;
    let itemIndex = 0;
    for (let partIndex = 0, partLen = packedParts.length; partIndex < partLen; partIndex++) {
      const part = packedParts[partIndex];
      this._packedData.set(part, dataOffset);
      const partSplatCount = part.length / SPLAT_FLOATS_PER_ITEM;
      for (let i = 0; i < partSplatCount; i++) {
        const sourceOffset = i * SPLAT_FLOATS_PER_ITEM;
        this._centres[centreOffset++] = part[sourceOffset + 0];
        this._centres[centreOffset++] = part[sourceOffset + 1];
        this._centres[centreOffset++] = part[sourceOffset + 2];
        this._itemIndices[itemIndex] = itemIndex;
        itemIndex++;
      }
      dataOffset += part.length;
    }
    this._sortedIndices = this._itemIndices.slice();
    this._slotCount = this._meshStateByGlobalSlot.size;
    this._splatCount = splatCount;
    const frameBuffers = this._createFrameBuffers(meshes, baseGlobalSlot);

    try {
      this._dataBuffer?.destroy?.();
      this._indexBuffer?.destroy?.();
      this._framePositionBuffer?.destroy?.();
      this._framePositionDecodeBuffer?.destroy?.();
      this._slotFrameStateBuffer?.destroy?.();
      this._dataBuffer = this._renderContext.device.createBuffer({
        label: "xeokit-webgpu-splat-data",
        size: Math.max(4, this._packedData.byteLength),
        usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST
      });
      this._indexBuffer = this._renderContext.device.createBuffer({
        label: "xeokit-webgpu-splat-indices",
        size: Math.max(4, this._sortedIndices.byteLength),
        usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST
      });
      this._framePositionBuffer = this._renderContext.device.createBuffer({
        label: "xeokit-webgpu-splat-frame-positions",
        size: Math.max(8, frameBuffers.positions.byteLength),
        usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST
      });
      this._framePositionDecodeBuffer = this._renderContext.device.createBuffer({
        label: "xeokit-webgpu-splat-frame-position-decodes",
        size: Math.max(32, frameBuffers.decodes.byteLength),
        usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST
      });
      this._slotFrameStateBuffer = this._renderContext.device.createBuffer({
        label: "xeokit-webgpu-splat-frame-states",
        size: Math.max(32, this._slotFrameStates.byteLength),
        usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST
      });
      this._renderContext.device.queue.writeBuffer(this._dataBuffer, 0, this._packedData);
      this._renderContext.device.queue.writeBuffer(this._indexBuffer, 0, this._sortedIndices);
      this._renderContext.device.queue.writeBuffer(this._framePositionBuffer, 0, frameBuffers.positions);
      this._renderContext.device.queue.writeBuffer(this._framePositionDecodeBuffer, 0, frameBuffers.decodes);
      this._updateSlotFrameStates();
    } catch (e) {
      return {
        ok: false,
        type: SDKErrorType.InitializationFailed,
        error: `[SplatBatchManager._rebuildBuffers] Failed to create WebGPU splat buffers: ${e instanceof Error ? e.message : String(e)}`
      };
    }

    const bindGroupLayoutResult = this._bindGroupLayoutManager.getSplatBindGroupLayout();
    if (bindGroupLayoutResult.ok === false) {
      return bindGroupLayoutResult;
    }
    try {
      this._bindGroup = this._renderContext.device.createBindGroup({
        label: "xeokit-webgpu-splat-bind-group",
        layout: bindGroupLayoutResult.value,
        entries: [{
          binding: 0,
          resource: {buffer: this._dataBuffer}
        }, {
          binding: 1,
          resource: {buffer: this._indexBuffer}
        }, {
          binding: 2,
          resource: {buffer: this._framePositionBuffer!}
        }, {
          binding: 3,
          resource: {buffer: this._framePositionDecodeBuffer!}
        }, {
          binding: 4,
          resource: {buffer: this._slotFrameStateBuffer!}
        }]
      });
    } catch (e) {
      return {
        ok: false,
        type: SDKErrorType.InitializationFailed,
        error: `[SplatBatchManager._rebuildBuffers] Failed to create WebGPU splat bind group: ${e instanceof Error ? e.message : String(e)}`
      };
    }

    const packedBatch = {
      primitive: GaussianSplatsPrimitive,
      label: "xeokit-webgpu-splat-batch",
      segmentKey: "splats",
      splatDataBuffer: this._dataBuffer,
      splatIndexBuffer: this._indexBuffer,
      splatBindGroup: this._bindGroup,
      splatCount: this._splatCount,
      destroy: () => undefined
    } as unknown as PackedMeshBatch;
    this._batch = {packedBatch};

    return {ok: true, value: undefined};
  }

  private _createFrameBuffers(meshes: RendererMesh[], baseGlobalSlot: number): {
    positions: Uint32Array;
    decodes: Float32Array;
  } {
    this._frameBasesByGeometry.clear();
    let packedPositionCount = 0;
    let decodeFloatCount = 0;
    for (let i = 0, len = meshes.length; i < len; i++) {
      const geometryState = meshes[i].geometryState;
      const storage = geometryState.frameStorage;
      if (!storage || this._frameBasesByGeometry.has(geometryState)) {
        continue;
      }
      this._frameBasesByGeometry.set(geometryState, {
        frameDataBase: packedPositionCount,
        frameDecodeBase: decodeFloatCount / 8
      });
      packedPositionCount += storage.vertexCount * storage.frameCount;
      decodeFloatCount += storage.frameCount * 8;
    }

    const positions = new Uint32Array(Math.max(2, packedPositionCount * 2));
    const decodes = new Float32Array(Math.max(8, decodeFloatCount));
    for (const [geometryState, frameBase] of this._frameBasesByGeometry) {
      const frames = geometryState.geometry.framesCompressed;
      const storage = geometryState.frameStorage;
      if (!frames || !storage) {
        continue;
      }
      const vertexCount = storage.vertexCount;
      for (let frameIndex = 0, frameCount = frames.length; frameIndex < frameCount; frameIndex++) {
        const frame = frames[frameIndex];
        const frameVertexBase = frameBase.frameDataBase + frameIndex * vertexCount;
        for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
          const sourceOffset = vertexIndex * 3;
          const targetOffset = (frameVertexBase + vertexIndex) * 2;
          positions[targetOffset] = (frame.positionsCompressed[sourceOffset] & 0xFFFF) | ((frame.positionsCompressed[sourceOffset + 1] & 0xFFFF) << 16);
          positions[targetOffset + 1] = frame.positionsCompressed[sourceOffset + 2] & 0xFFFF;
        }
        const aabb = frame.aabb!;
        const decodeOffset = (frameBase.frameDecodeBase + frameIndex) * 8;
        decodes[decodeOffset] = aabb[0];
        decodes[decodeOffset + 1] = aabb[1];
        decodes[decodeOffset + 2] = aabb[2];
        decodes[decodeOffset + 3] = 0;
        decodes[decodeOffset + 4] = (aabb[3] - aabb[0]) / 65535;
        decodes[decodeOffset + 5] = (aabb[4] - aabb[1]) / 65535;
        decodes[decodeOffset + 6] = (aabb[5] - aabb[2]) / 65535;
        decodes[decodeOffset + 7] = 0;
      }
    }

    const maxGlobalSlot = baseGlobalSlot + this._slotCount;
    this._slotFrameStates = new Float32Array(Math.max(1, maxGlobalSlot + 1) * SPLAT_FRAME_STATE_FLOATS);
    return {positions, decodes};
  }

  private _updateSlotFrameStates(): void {
    if (!this._slotFrameStateBuffer || this._slotFrameStates.length === 0) {
      return;
    }
    this._slotFrameStates.fill(0);
    for (const [globalSlot, meshState] of this._meshStateByGlobalSlot) {
      const geometryFrameBase = this._frameBasesByGeometry.get(meshState.geometryState);
      if (!geometryFrameBase) {
        continue;
      }
      const frameState = resolveFrameTime(meshState.geometryState, meshState.mesh.frameTime);
      const offset = globalSlot * SPLAT_FRAME_STATE_FLOATS;
      this._slotFrameStates[offset] = frameState.frameAOffset;
      this._slotFrameStates[offset + 1] = frameState.frameBOffset;
      this._slotFrameStates[offset + 2] = frameState.factor;
      this._slotFrameStates[offset + 3] = frameState.flags;
      this._slotFrameStates[offset + 4] = frameState.frameADecodeIndex;
      this._slotFrameStates[offset + 5] = frameState.frameBDecodeIndex;
      this._slotFrameStates[offset + 6] = geometryFrameBase.frameDataBase;
      this._slotFrameStates[offset + 7] = geometryFrameBase.frameDecodeBase;
      const matrix = (meshState.mesh.worldMatrix ?? meshState.mesh.matrix) as ArrayLike<number> | undefined;
      if (matrix) {
        for (let i = 0; i < 16; i++) {
          this._slotFrameStates[offset + 8 + i] = matrix[i];
        }
      } else {
        this._slotFrameStates[offset + 8] = 1;
        this._slotFrameStates[offset + 13] = 1;
        this._slotFrameStates[offset + 18] = 1;
        this._slotFrameStates[offset + 23] = 1;
      }
    }
    this._renderContext.device.queue.writeBuffer(this._slotFrameStateBuffer, 0, this._slotFrameStates);
  }

  private _getSplatAttributes(meshState: RendererMesh): SplatAttributes | null {
    const geometry = meshState.geometryState.geometry as any;
    const positionsCompressed = geometry.positionsCompressed ?? geometry.positions;
    const aabb = geometry.aabb;
    const scales = geometry.scales;
    const rotations = geometry.rotations;
    if (!positionsCompressed || !aabb || !scales || !rotations) {
      return null;
    }
    return {
      positionsCompressed,
      aabb,
      scales,
      rotations,
      colorsCompressed: geometry.colorsCompressed ?? geometry.colors
    };
  }

  private _createStructureKey(meshes: RendererMesh[], baseGlobalSlot: number): string {
    let key = `${baseGlobalSlot}|${meshes.length}`;
    for (let i = 0, len = meshes.length; i < len; i++) {
      const meshState = meshes[i];
      const matrix = (meshState.mesh.worldMatrix ?? meshState.mesh.matrix) as ArrayLike<number> | undefined;
      key += `|${meshState.mesh.uniqueId}:${meshState.geometryState.geometry.uniqueId}`;
      if (matrix) {
        for (let j = 0; j < 16; j++) {
          key += `,${matrix[j]}`;
        }
      }
    }
    return key;
  }

  private _createCameraKey(view: View): string {
    const matrix = view.camera.viewMatrix as unknown as ArrayLike<number>;
    let key = "";
    for (let i = 0; i < 16; i++) {
      key += `${matrix[i]},`;
    }
    return key;
  }
}
