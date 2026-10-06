import {SDKErrorType, type SDKResult} from "../../../../../base/core";
import {GaussianSplatsPrimitive, LinesPrimitive, PointsPrimitive, TrianglesPrimitive} from "../../../../../base/constants";
import {
  SCENE_GEOMETRY_UPDATE_INDICES,
  SCENE_GEOMETRY_UPDATE_NORMALS_COMPRESSED,
  SCENE_GEOMETRY_UPDATE_UVS_COMPRESSED,
  SCENE_GEOMETRY_UPDATE_POSITIONS_COMPRESSED,
  type SceneMesh,
  type SceneTexture
} from "../../../../../model/scene";
import type {SceneTextureUVTransform} from "../../../../../model/scene/SceneTextureParams";
import type {View} from "../../../../viewer";
import type {WebGPUBindGroupLike, WebGPUBufferLike} from "../../core";
import {GPU_BUFFER_USAGE, INSTANCE_FLOATS} from "../constants";
import type {InstancedDrawBatch} from "../drawOps";
import {
  TRIANGLE_POSITION_DECODE_UNIFORM_BYTES,
  TRIANGLE_POSITION_DECODE_UNIFORM_FLOATS
} from "../drawOps/techniques/triangles/TrianglePositionPacking";
import type {DrawItem} from "../renderState";
import {InstanceBufferManager, type InstanceBufferFrame} from "./InstanceBufferManager";
import {MeshManager, type MeshRTCTileResolver, type RendererMesh} from "../meshManager";
import {RenderContext} from "../RenderContext";
import type {MemoryConfigs} from "../../MemoryConfigs";
import {BindGroupLayoutManager} from "./BindGroupLayoutManager";
import {TextureBindGroupManager} from "./TextureBindGroupManager";
import type {LODVariantMembership} from "../../../../lod/LODVariantMembership";
import type {RendererGeometry} from "./RendererGeometry";

const TRIANGLE_MATERIAL_FLOATS_PER_VERTEX = 20;
const TRIANGLE_MATERIAL_VERTEX_STRIDE_BYTES = TRIANGLE_MATERIAL_FLOATS_PER_VERTEX * 4;
const TEXTURE_TRANSFORM_FLOATS = 40;
const IDENTITY_UV_TRANSFORM: SceneTextureUVTransform = [1, 0, 0, 1, 0, 0];
type TriangleRenderClass = "flat" | "pbr";

interface TriangleFrameBinding {
  positionBuffer: WebGPUBufferLike;
  positionDecodeBuffer: WebGPUBufferLike;
  normalBuffer: WebGPUBufferLike;
  uvBuffer: WebGPUBufferLike;
}

interface InstanceWriteState {
  bufferVersion: number;
  meshInstanceDataVersion: number;
  viewStateVersion: number;
}

export interface WebGPUTriangleMeshSlot {
  meshState: RendererMesh;
  signature: string;
  globalSlot: number;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
  edgeIndexStart: number;
  edgeIndexCount: number;
  instanceWriteStateByViewId: {[viewId: string]: InstanceWriteState};
}

export interface TriangleBatchSegment {
  key: string;
  baseKey: string;
  bufferPageKey: string;
  label: string;
  signature: string;
  primitive: number;
  hasNormals: boolean;
  triangleRenderClass: TriangleRenderClass;
  baseSlot: number;
  slotCount: number;
  slotEnd: number;
  vertexBuffer: WebGPUBufferLike;
  vertexBufferOffset: number;
  colorBuffer: WebGPUBufferLike | null;
  colorBufferOffset: number;
  uvBuffer: WebGPUBufferLike | null;
  uvBufferOffset: number;
  normalBuffer: WebGPUBufferLike | null;
  normalBufferOffset: number;
  materialBuffer: WebGPUBufferLike | null;
  materialBufferOffset: number;
  lineOtherVertexBuffer: WebGPUBufferLike | null;
  lineOtherVertexBufferOffset: number;
  positionDecodeBuffer: WebGPUBufferLike;
  positionDecodeBindGroup: WebGPUBindGroupLike;
  frameBinding: TriangleFrameBinding;
  colorBindGroup: WebGPUBindGroupLike;
  maskedShadowColorBindGroup: WebGPUBindGroupLike;
  textureTransformBuffer: WebGPUBufferLike | null;
  vertexMetadataBuffer: WebGPUBufferLike;
  indexBuffer: WebGPUBufferLike;
  edgeIndexBuffer: WebGPUBufferLike | null;
  indexBufferOffset: number;
  edgeIndexBufferOffset: number;
  vertexMetadataBufferOffset: number;
  slots: WebGPUTriangleMeshSlot[];
  slotByMeshId: {[meshId: string]: WebGPUTriangleMeshSlot};
  indices: Uint16Array | Uint32Array;
  edgeIndices: Uint16Array | Uint32Array;
  indexFormat: "uint16" | "uint32";
  positionAABB: Float32Array;
  indicesPageLocal: boolean;
  textureKey: string;
  skipDepthPrepass: boolean;
  lodVariantMemberships: readonly LODVariantMembership[];
  worldAABB: Float64Array;
  boundsVersion: string;
  destroy(): void;
}

interface TriangleBufferPage {
  key: string;
  indexFormat: "uint16" | "uint32";
  vertexCapacity: number;
  indexCapacity: number;
  edgeIndexCapacity: number;
  positionDecodeCapacity: number;
  usedVertices: number;
  usedIndices: number;
  usedEdgeIndices: number;
  usedPositionDecodes: number;
  refCount: number;
  vertexBuffer: WebGPUBufferLike;
  colorBuffer: WebGPUBufferLike | null;
  uvBuffer: WebGPUBufferLike | null;
  normalBuffer: WebGPUBufferLike | null;
  materialBuffer: WebGPUBufferLike | null;
  lineOtherVertexBuffer: WebGPUBufferLike | null;
  vertexMetadataBuffer: WebGPUBufferLike;
  positionDecodeBuffer: WebGPUBufferLike;
  positionDecodeBindGroup: WebGPUBindGroupLike;
  frameBinding: TriangleFrameBinding;
  indexBuffer: WebGPUBufferLike;
  edgeIndexBuffer: WebGPUBufferLike | null;
  destroy(): void;
}

export interface TriangleBatchSet {
  structureVersion: number;
  instanceCapacity: number;
  projectedInstanceCapacity: number;
  segments: TriangleBatchSegment[];
  segmentByMeshId: {[meshId: string]: TriangleBatchSegment};
  pendingSegmentCount: number;
  builtSegmentCount: number;
  buildTelemetry: TriangleSegmentBuildTelemetry;
}

export interface TriangleSegmentBuildSample {
  key: string;
  baseKey: string;
  meshCount: number;
  vertexCount: number;
  indexCount: number;
  edgeIndexCount: number;
  totalMs: number;
  packMs: number;
  uploadMs: number;
  indexFormat: "uint16" | "uint32";
}

export interface TriangleSegmentBuildTelemetry {
  totalSegmentsBuilt: number;
  totalBuildMs: number;
  totalPackMs: number;
  totalUploadMs: number;
  totalMeshCount: number;
  totalVertexCount: number;
  totalIndexCount: number;
  totalEdgeIndexCount: number;
  lastBuildSegments: number;
  lastBuildMs: number;
  lastBuildPackMs: number;
  lastBuildUploadMs: number;
  lastBuildPendingBefore: number;
  lastBuildPendingAfter: number;
  recentSamples: TriangleSegmentBuildSample[];
  slowestSamples: TriangleSegmentBuildSample[];
}

export interface TriangleBatchMemoryStats {
  pages: number;
  segments: number;
  totalBytes: number;
  vertexBytes: number;
  uvBytes: number;
  normalBytes: number;
  vertexMetadataBytes: number;
  indexBytes: number;
  edgeIndexBytes: number;
  positionDecodeBytes: number;
  usedVertexBytes: number;
  usedUVBytes: number;
  usedNormalBytes: number;
  usedVertexMetadataBytes: number;
  usedIndexBytes: number;
  usedEdgeIndexBytes: number;
  usedPositionDecodeBytes: number;
  pageDetails: TriangleBatchPageMemoryStats[];
  segmentsByLoadingMode: {[loadingMode: string]: number};
  segmentsByMemoryPolicy: {[memoryPolicy: string]: number};
}

export interface TriangleBatchPageMemoryStats {
  key: string;
  indexFormat: "uint16" | "uint32";
  segmentCount: number;
  vertexCapacity: number;
  usedVertices: number;
  indexCapacity: number;
  usedIndices: number;
  edgeIndexCapacity: number;
  usedEdgeIndices: number;
  positionDecodeCapacity: number;
  usedPositionDecodes: number;
  bytes: number;
  usedBytes: number;
  vertexBytes: number;
  uvBytes: number;
  normalBytes: number;
  vertexMetadataBytes: number;
  indexBytes: number;
  edgeIndexBytes: number;
  positionDecodeBytes: number;
  usedVertexBytes: number;
  usedUVBytes: number;
  usedNormalBytes: number;
  usedVertexMetadataBytes: number;
  usedIndexBytes: number;
  usedEdgeIndexBytes: number;
  usedPositionDecodeBytes: number;
}

interface SlotRange {
  base: number;
  count: number;
}

interface TriangleSegmentBuildJob {
  structureVersion: number;
  baseKey: string;
  key: string;
  meshStates: RendererMesh[];
  memoryConfigs: MemoryConfigs;
  signature: string;
}

interface TriangleSegmentBuildResult {
  builtSegments: TriangleBatchSegment[];
}

export interface TriangleBatchPrepareOptions {
  buildPendingSegments?: boolean;
  buildAllPendingSegments?: boolean;
  forceRepack?: boolean;
  maxBuildSegments?: number;
}

const nowMs = (): number => {
  const performanceLike = (globalThis as {performance?: {now?: () => number}}).performance;
  return performanceLike?.now ? performanceLike.now() : Date.now();
};
const IDENTITY_MATRIX: ReadonlyArray<number> = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const TRIANGLE_BUFFER_PAGE_SEGMENT_MULTIPLIER = 4;
const MAX_SEGMENT_BUILD_SAMPLES = 16;
const MIN_PACKED_POSITION_DECODE_EXTENT = 1024;
const PACKED_POSITION_DECODE_TILE_EXTENT_MULTIPLIER = 8;
const DEFAULT_TEXTURE_KEY = "default";

/**
 * Owns packed color-triangle mesh storage for the WebGPU renderer.
 *
 * The manager keeps persistent loading-mode-aware segments rather than one global
 * packed array. Tile streamers create and destroy SceneModels frequently; a
 * segment gives each model stable vertex storage and stable global instance
 * slots, so adding or evicting one model does not repack unrelated models.
 *
 * @internal
 */
export class TriangleBatchManager {

  private readonly _renderContext: RenderContext;
  private readonly _bindGroupLayoutManager: BindGroupLayoutManager;
  private readonly _textureBindGroupManager: TextureBindGroupManager;
  private readonly _memoryConfigs: MemoryConfigs;
  private readonly _rtcTileResolver: MeshRTCTileResolver;
  private readonly _segmentsByKey = new Map<string, TriangleBatchSegment>();
  private readonly _segmentByMeshId = new Map<string, TriangleBatchSegment>();
  private readonly _pageCountersByBaseKey = new Map<string, number>();
  private readonly _bufferPagesByKey = new Map<string, TriangleBufferPage>();
  private readonly _currentBufferPageByKey = new Map<string, TriangleBufferPage>();
  private readonly _freeSlotRanges: SlotRange[] = [];
  private readonly _pendingSegmentJobs: TriangleSegmentBuildJob[] = [];
  private readonly _partialDrawBatchCache = new Map<string, InstancedDrawBatch>();
  private readonly _recentBuildSamples: TriangleSegmentBuildSample[] = [];
  private readonly _slowestBuildSamples: TriangleSegmentBuildSample[] = [];
  private _lastSegmentBuildSample: TriangleSegmentBuildSample | null = null;
  private _totalSegmentsBuilt = 0;
  private _totalBuildMs = 0;
  private _totalPackMs = 0;
  private _totalUploadMs = 0;
  private _totalMeshCount = 0;
  private _totalVertexCount = 0;
  private _totalIndexCount = 0;
  private _totalEdgeIndexCount = 0;
  private _lastBuildSegments = 0;
  private _lastBuildMs = 0;
  private _lastBuildPackMs = 0;
  private _lastBuildUploadMs = 0;
  private _lastBuildPendingBefore = 0;
  private _lastBuildPendingAfter = 0;
  private _batchSet: TriangleBatchSet | null = null;
  private _nextSlot = 0;
  private _identityTextureTransformBufferValue: WebGPUBufferLike | null = null;

  constructor(params: {
    renderContext: RenderContext;
    bindGroupLayoutManager: BindGroupLayoutManager;
    memoryConfigs: MemoryConfigs;
    rtcTileResolver: MeshRTCTileResolver;
  }) {
    this._renderContext = params.renderContext;
    this._bindGroupLayoutManager = params.bindGroupLayoutManager;
    this._textureBindGroupManager = new TextureBindGroupManager({
      renderContext: params.renderContext,
      bindGroupLayoutManager: params.bindGroupLayoutManager
    });
    this._memoryConfigs = params.memoryConfigs;
    this._rtcTileResolver = params.rtcTileResolver;
  }

  public prepare(meshManager: MeshManager, options: TriangleBatchPrepareOptions = {}): SDKResult<TriangleBatchSet> {
    const buildPendingSegments = options.buildPendingSegments ?? true;
    const buildAllPendingSegments = options.buildAllPendingSegments ?? false;
    const forceRepack = options.forceRepack === true;
    const structureVersion = meshManager.structureVersion;
    if (forceRepack) {
      this._clearPackedSegmentsForRepack();
    }
    if (!forceRepack && this._batchSet?.structureVersion === structureVersion) {
      let builtSegments: TriangleBatchSegment[] = [];
      if (buildPendingSegments) {
        const pendingResult = this._buildPendingSegmentJobs(structureVersion, buildAllPendingSegments, options.maxBuildSegments);
        if (pendingResult.ok === false) {
          return pendingResult;
        }
        builtSegments = pendingResult.value.builtSegments;
      }
      this._batchSet = this._extendBatchSet(this._batchSet, structureVersion, builtSegments);
      return {
        ok: true,
        value: this._batchSet
      };
    }

    if (!forceRepack) {
      const appendOnlyResult = this._prepareAppendOnly(meshManager, structureVersion, buildPendingSegments, buildAllPendingSegments, options.maxBuildSegments);
      if (appendOnlyResult) {
        return appendOnlyResult;
      }
    }

    this._pendingSegmentJobs.length = 0;

    const liveMeshStatesById = new Map<string, RendererMesh>();
    for (let i = 0, len = meshManager.meshStates.length; i < len; i++) {
      const meshState = meshManager.meshStates[i];
      liveMeshStatesById.set(meshState.mesh.uniqueId, meshState);
    }

    const assignedMeshIds = new Set<string>();
    const segmentByMeshId: {[meshId: string]: TriangleBatchSegment} = {};

    for (const [key, segment] of Array.from(this._segmentsByKey)) {
      const meshStates: RendererMesh[] = [];
      let needsRebuild = false;
      let needsRegroup = false;
      for (let i = 0, len = segment.slots.length; i < len; i++) {
        const slot = segment.slots[i];
        const meshId = slot.meshState.mesh.uniqueId;
        const liveMeshState = liveMeshStatesById.get(meshId);
        if (!liveMeshState) {
          needsRebuild = true;
          continue;
        }
        if (slot.signature !== this._getMeshSignature(liveMeshState) || slot.meshState !== liveMeshState) {
          needsRebuild = true;
        }
        if (segment.baseKey !== this._getSegmentBaseKey(liveMeshState)) {
          needsRegroup = true;
        }
        meshStates.push(liveMeshState);
      }

      if (meshStates.length === 0 || needsRegroup) {
        this._destroySegment(segment);
        this._segmentsByKey.delete(key);
        continue;
      }

      let activeSegment = segment;
      if (needsRebuild) {
        this._destroySegment(segment);
        const replacementResult = this._createSegment(segment.baseKey, key, meshStates, this._getModelMemoryConfigs(meshStates[0]), this._getSegmentSignature(meshStates));
        if (replacementResult.ok === false) {
          return replacementResult;
        }
        activeSegment = replacementResult.value;
        this._segmentsByKey.set(key, activeSegment);
      }

      this._trackSegment(activeSegment, assignedMeshIds, segmentByMeshId);
    }

    const newGroups = this._groupNewMeshStates(meshManager.meshStates, assignedMeshIds);
    for (const [baseKey, meshStates] of newGroups) {
      this._enqueueSegments(structureVersion, baseKey, meshStates);
    }

    if (buildPendingSegments) {
      const pendingResult = this._buildPendingSegmentJobs(structureVersion, buildAllPendingSegments, options.maxBuildSegments);
      if (pendingResult.ok === false) {
        return pendingResult;
      }
    }

    this._batchSet = this._createBatchSet(structureVersion);

    if (this._batchSet.segments.length === 0 && this._pendingSegmentJobs.length === 0) {
      this._nextSlot = 0;
      this._freeSlotRanges.length = 0;
      this._pageCountersByBaseKey.clear();
    }

    return {
      ok: true,
      value: this._batchSet
    };
  }

  public buildPendingSegments(meshManager: MeshManager, options: TriangleBatchPrepareOptions = {}): SDKResult<TriangleBatchSet> {
    const prepareResult = this.prepare(meshManager, {buildPendingSegments: false});
    if (prepareResult.ok === false) {
      return prepareResult;
    }

    const structureVersion = meshManager.structureVersion;
    const pendingResult = this._buildPendingSegmentJobs(structureVersion, options.buildAllPendingSegments === true, options.maxBuildSegments);
    if (pendingResult.ok === false) {
      return pendingResult;
    }

    this._batchSet = this._batchSet?.structureVersion === structureVersion
      ? this._extendBatchSet(this._batchSet, structureVersion, pendingResult.value.builtSegments)
      : this._createBatchSet(structureVersion);
    return {
      ok: true,
      value: this._batchSet
    };
  }

  private _prepareAppendOnly(
    meshManager: MeshManager,
    structureVersion: number,
    buildPendingSegments: boolean,
    buildAllPendingSegments: boolean,
    maxBuildSegments?: number
  ): SDKResult<TriangleBatchSet> | null {
    if (!this._batchSet) {
      return null;
    }
    const changes = meshManager.getStructureChangesSince(this._batchSet.structureVersion);
    if (!changes.appendOnly || changes.createdMeshStates.length === 0) {
      return null;
    }

    this._retargetPendingSegments(structureVersion);
    const segmentByMeshId = {...this._batchSet.segmentByMeshId};
    const newGroups = this._groupNewMeshStates(changes.createdMeshStates, new Set<string>());
    for (const [baseKey, meshStates] of newGroups) {
      this._enqueueSegments(structureVersion, baseKey, meshStates);
    }
    void segmentByMeshId;

    if (buildPendingSegments) {
      const pendingResult = this._buildPendingSegmentJobs(structureVersion, buildAllPendingSegments, maxBuildSegments);
      if (pendingResult.ok === false) {
        return pendingResult;
      }
      this._batchSet = this._extendBatchSet(this._batchSet, structureVersion, pendingResult.value.builtSegments);
      return {
        ok: true,
        value: this._batchSet
      };
    }

    this._batchSet = this._extendBatchSet(this._batchSet, structureVersion, []);

    return {
      ok: true,
      value: this._batchSet
    };
  }

  private _enqueueSegments(structureVersion: number, baseKey: string, meshStates: RendererMesh[]): void {
    const pageMeshStates: RendererMesh[] = [];
    const pagePositionAABB = createEmptyAABB();
    const memoryConfigs = this._getModelMemoryConfigs(meshStates[0]);
    let pageVertexCount = 0;
    let pageIndexCount = 0;
    let pageEdgeIndexCount = 0;
    const maxPositionDecodeExtent = this._getMaxPackedPositionDecodeExtent();

    const flushPage = (): void => {
      if (pageMeshStates.length === 0) {
        return;
      }
      const key = this._nextSegmentKey(baseKey);
      const meshStatesForJob = pageMeshStates.slice();
      this._pendingSegmentJobs.push({
        structureVersion,
        baseKey,
        key,
        meshStates: meshStatesForJob,
        memoryConfigs,
        signature: this._getSegmentSignature(meshStatesForJob)
      });
      pageMeshStates.length = 0;
      resetAABB(pagePositionAABB);
      pageVertexCount = 0;
      pageIndexCount = 0;
      pageEdgeIndexCount = 0;
    };

    for (let i = 0, len = meshStates.length; i < len; i++) {
      const meshState = meshStates[i];
      const sourceVertexCount = meshState.geometryState.positions.length / 3;
      const primitive = meshState.geometryState.geometry.primitive;
      const isPoints = primitive === PointsPrimitive;
      const isLines = primitive === LinesPrimitive;
      const lineSegmentCount = isLines ? Math.floor((meshState.geometryState.indices?.length ?? 0) / 2) : 0;
      const vertexCount = isPoints ? sourceVertexCount * 6 : (isLines ? lineSegmentCount * 6 : sourceVertexCount);
      const indexCount = isPoints ? sourceVertexCount * 6 : (isLines ? lineSegmentCount * 6 : meshState.geometryState.indices!.length);
      const edgeIndexCount = isPoints || isLines ? 0 : meshState.geometryState.edgeIndexCount;
      if (
        pageMeshStates.length > 0 &&
        (
          pageMeshStates.length >= memoryConfigs.maxBatchMeshes ||
          pageMeshStates.length >= memoryConfigs.maxBatchGeometries ||
          pageVertexCount + vertexCount > memoryConfigs.maxBatchVertices ||
          pageIndexCount + indexCount > memoryConfigs.maxBatchIndices ||
          pageEdgeIndexCount + edgeIndexCount > memoryConfigs.maxBatchIndices ||
          Math.floor((pageIndexCount + indexCount) / 3) > memoryConfigs.maxBatchPrims ||
          wouldExceedPackedPositionDecodeExtent(pagePositionAABB, meshState, maxPositionDecodeExtent)
        )
      ) {
        flushPage();
      }

      pageMeshStates.push(meshState);
      expandAABB(pagePositionAABB, meshState.geometryState.renderAABB);
      pageVertexCount += vertexCount;
      pageIndexCount += indexCount;
      pageEdgeIndexCount += edgeIndexCount;
    }

    flushPage();
  }

  private _getMaxPackedPositionDecodeExtent(): number {
    const tileSize = this._memoryConfigs.tileSize;
    const tileExtent = Number.isFinite(tileSize) && tileSize > 0
      ? tileSize * PACKED_POSITION_DECODE_TILE_EXTENT_MULTIPLIER
      : 0;
    return Math.max(MIN_PACKED_POSITION_DECODE_EXTENT, tileExtent);
  }

  private _buildPendingSegmentJobs(structureVersion: number, buildAllSegments = false, maxBuildSegments = -1): SDKResult<TriangleSegmentBuildResult> {
    const startedAt = nowMs();
    let builtCount = 0;
    let buildMs = 0;
    let packMs = 0;
    let uploadMs = 0;
    const builtSegments: TriangleBatchSegment[] = [];
    const pendingBefore = this._countPendingSegmentJobs(structureVersion);
    while (this._pendingSegmentJobs.length > 0) {
      const job = this._pendingSegmentJobs[0];
      if (job.structureVersion !== structureVersion) {
        this._pendingSegmentJobs.shift();
        continue;
      }
      if (
        !buildAllSegments &&
        builtCount > 0 &&
        maxBuildSegments >= 0 &&
        builtCount >= maxBuildSegments
      ) {
        break;
      }
      if (
        !buildAllSegments &&
        builtCount > 0 &&
        job.memoryConfigs.maxBatchBuildTimeMs >= 0 &&
        nowMs() - startedAt >= job.memoryConfigs.maxBatchBuildTimeMs
      ) {
        break;
      }
      if (
        !buildAllSegments &&
        builtCount > 0 &&
        job.memoryConfigs.maxBatchBuildSegments >= 0 &&
        builtCount >= job.memoryConfigs.maxBatchBuildSegments
      ) {
        break;
      }
      this._lastSegmentBuildSample = null;
      const segmentStartedAt = nowMs();
      const segmentResult = this._createSegment(job.baseKey, job.key, job.meshStates, job.memoryConfigs, job.signature);
      if (segmentResult.ok === false) {
        return segmentResult;
      }
      const sample = this._lastSegmentBuildSample;
      if (sample) {
        buildMs += sample.totalMs;
        packMs += sample.packMs;
        uploadMs += sample.uploadMs;
        this._recordBuildSample(sample);
      } else {
        buildMs += nowMs() - segmentStartedAt;
      }
      const segment = segmentResult.value;
      this._segmentsByKey.set(segment.key, segment);
      builtSegments.push(segment);
      this._pendingSegmentJobs.shift();
      builtCount++;
    }

    this._lastBuildSegments = builtCount;
    this._lastBuildMs = buildMs;
    this._lastBuildPackMs = packMs;
    this._lastBuildUploadMs = uploadMs;
    this._lastBuildPendingBefore = pendingBefore;
    this._lastBuildPendingAfter = this._countPendingSegmentJobs(structureVersion);

    return {
      ok: true,
      value: {
        builtSegments
      }
    };
  }

  private _retargetPendingSegments(structureVersion: number): void {
    for (let i = 0, len = this._pendingSegmentJobs.length; i < len; i++) {
      this._pendingSegmentJobs[i].structureVersion = structureVersion;
    }
  }

  private _createBatchSet(structureVersion: number): TriangleBatchSet {
    const segments = Array.from(this._segmentsByKey.values()).sort((a, b) => a.key.localeCompare(b.key));
    const segmentByMeshId: {[meshId: string]: TriangleBatchSegment} = {};
    const assignedMeshIds = new Set<string>();
    for (let i = 0, len = segments.length; i < len; i++) {
      this._trackSegment(segments[i], assignedMeshIds, segmentByMeshId);
    }
    const pendingSegmentCount = this._countPendingSegmentJobs(structureVersion);
    const instanceCapacity = this._getInstanceCapacity(segments);
    return {
      structureVersion,
      instanceCapacity,
      projectedInstanceCapacity: Math.max(
        instanceCapacity + this._getPendingSegmentInstanceCapacity(structureVersion),
        this._nextSlot
      ),
      segments,
      segmentByMeshId,
      pendingSegmentCount,
      builtSegmentCount: segments.length,
      buildTelemetry: this._createBuildTelemetrySnapshot()
    };
  }

  private _extendBatchSet(previous: TriangleBatchSet, structureVersion: number, builtSegments: TriangleBatchSegment[]): TriangleBatchSet {
    const segmentByMeshId = previous.segmentByMeshId;
    let instanceCapacity = previous.instanceCapacity;
    let segments = previous.segments;
    if (builtSegments.length > 0) {
      segments = this._mergeSortedSegments(previous.segments, builtSegments);
      const assignedMeshIds = new Set<string>();
      for (let i = 0, len = builtSegments.length; i < len; i++) {
        this._trackSegment(builtSegments[i], assignedMeshIds, segmentByMeshId);
        instanceCapacity += builtSegments[i].slotCount;
      }
    }
    const pendingSegmentCount = this._countPendingSegmentJobs(structureVersion);
    return {
      structureVersion,
      instanceCapacity,
      projectedInstanceCapacity: instanceCapacity + this._getPendingSegmentInstanceCapacity(structureVersion),
      segments,
      segmentByMeshId,
      pendingSegmentCount,
      builtSegmentCount: segments.length,
      buildTelemetry: this._createBuildTelemetrySnapshot()
    };
  }

  private _mergeSortedSegments(existing: TriangleBatchSegment[], appended: TriangleBatchSegment[]): TriangleBatchSegment[] {
    if (appended.length === 0) {
      return existing;
    }
    const sortedAppended = appended.length === 1
      ? appended
      : appended.slice().sort((a, b) => a.key.localeCompare(b.key));
    const merged: TriangleBatchSegment[] = [];
    let existingIndex = 0;
    let appendedIndex = 0;
    while (existingIndex < existing.length && appendedIndex < sortedAppended.length) {
      if (existing[existingIndex].key.localeCompare(sortedAppended[appendedIndex].key) <= 0) {
        merged.push(existing[existingIndex++]);
      } else {
        merged.push(sortedAppended[appendedIndex++]);
      }
    }
    while (existingIndex < existing.length) {
      merged.push(existing[existingIndex++]);
    }
    while (appendedIndex < sortedAppended.length) {
      merged.push(sortedAppended[appendedIndex++]);
    }
    return merged;
  }

  private _countPendingSegmentJobs(structureVersion: number): number {
    let count = 0;
    for (let i = 0, len = this._pendingSegmentJobs.length; i < len; i++) {
      if (this._pendingSegmentJobs[i].structureVersion === structureVersion) {
        count++;
      }
    }
    return count;
  }

  private _getPendingSegmentInstanceCapacity(structureVersion: number): number {
    let capacity = 0;
    for (let i = 0, len = this._pendingSegmentJobs.length; i < len; i++) {
      const job = this._pendingSegmentJobs[i];
      if (job.structureVersion === structureVersion) {
        capacity += job.meshStates.length;
      }
    }
    return capacity;
  }

  private _createSegment(
    baseKey: string,
    key: string,
    meshStates: RendererMesh[],
    memoryConfigs: MemoryConfigs,
    signature: string
  ): SDKResult<TriangleBatchSegment> {
    let totalVertices = 0;
    let totalIndices = 0;
    let totalEdgeIndices = 0;
    const primitive = meshStates[0]?.geometryState.geometry.primitive;
    const isPoints = primitive === PointsPrimitive;
    const isLines = primitive === LinesPrimitive;
    const isTriangles = !isPoints && !isLines;
    const hasNormals = isTriangles && !!meshStates[0]?.geometryState.normals;
    const triangleRenderClass = isTriangles ? getTriangleRenderClassFromBaseKey(baseKey) : "flat";
    const pbrTriangleColor = isTriangles && triangleRenderClass === "pbr";
    const includeEdges = isTriangles && this._renderContext.renderConfigs.edges;
    for (let i = 0, len = meshStates.length; i < len; i++) {
      const geometryState = meshStates[i].geometryState;
      const pointCount = geometryState.positions.length / 3;
      const lineSegmentCount = isLines ? Math.floor((geometryState.indices?.length ?? 0) / 2) : 0;
      totalVertices += isPoints ? pointCount * 6 : (isLines ? lineSegmentCount * 6 : pointCount);
      totalIndices += isPoints ? pointCount * 6 : (isLines ? lineSegmentCount * 6 : geometryState.indices!.length);
      totalEdgeIndices += includeEdges ? geometryState.edgeIndexCount : 0;
    }

    if (totalVertices > 0xFFFFFFFF) {
      return {
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[TriangleBatchManager.prepare] Packed triangle segment '${key}' exceeds the uint32 index range.`
      };
    }

    let vertexBuffer: WebGPUBufferLike | null = null;
    let bufferPage: TriangleBufferPage | null = null;
    const baseSlot = this._allocateSlots(meshStates.length);
    const segmentLabel = this._sanitizeSegmentLabel(key);
    const segmentStartedAt = nowMs();
    let packMs = 0;
    let uploadMs = 0;
    this._lastSegmentBuildSample = null;

    try {
      const positionAABB = createPackedPositionAABB(meshStates);
      const positions = new Uint16Array(totalVertices * 4);
      const colors = (isPoints || isLines || pbrTriangleColor) ? new Uint8Array(totalVertices * 4) : null;
      const lineOtherPositions = isLines ? new Uint16Array(totalVertices * 4) : null;
      const positionDecode = createPositionDecodeUniform(positionAABB);
      const vertexMetadata = new Uint32Array(totalVertices * 4);
      const firstMesh = meshStates[0]?.mesh;
      const sanitizeAlphaMaskRGB = pbrTriangleColor && !!firstMesh && getEffectiveAlphaMode(firstMesh) === 1;
      const textureBindingResult = this._textureBindGroupManager.getBinding(pbrTriangleColor ? firstMesh?.effectiveColorTexture : null, "color", "white", sanitizeAlphaMaskRGB);
      if (textureBindingResult.ok === false) {
        this._freeSlots(baseSlot, meshStates.length);
        return textureBindingResult;
      }
      const albedoBinding = textureBindingResult.value;
      const metallicRoughnessBindingResult = this._textureBindGroupManager.getBinding(pbrTriangleColor ? firstMesh?.effectiveMetallicRoughnessTexture : null, "metallicRoughness");
      if (metallicRoughnessBindingResult.ok === false) {
        this._freeSlots(baseSlot, meshStates.length);
        return metallicRoughnessBindingResult;
      }
      const normalBindingResult = this._textureBindGroupManager.getBinding(pbrTriangleColor ? firstMesh?.effectiveNormalsTexture : null, "normal");
      if (normalBindingResult.ok === false) {
        this._freeSlots(baseSlot, meshStates.length);
        return normalBindingResult;
      }
      const emissiveBindingResult = this._textureBindGroupManager.getBinding(pbrTriangleColor ? firstMesh?.effectiveEmissiveTexture : null, "emissive");
      if (emissiveBindingResult.ok === false) {
        this._freeSlots(baseSlot, meshStates.length);
        return emissiveBindingResult;
      }
      const occlusionBindingResult = this._textureBindGroupManager.getBinding(pbrTriangleColor ? firstMesh?.effectiveOcclusionTexture : null, "occlusion");
      if (occlusionBindingResult.ok === false) {
        this._freeSlots(baseSlot, meshStates.length);
        return occlusionBindingResult;
      }
      const metallicRoughnessBinding = metallicRoughnessBindingResult.value;
      const normalBinding = normalBindingResult.value;
      const emissiveBinding = emissiveBindingResult.value;
      const occlusionBinding = occlusionBindingResult.value;
      const colorBindGroupLayoutResult = this._bindGroupLayoutManager.getTriangleColorBindGroupLayout();
      if (colorBindGroupLayoutResult.ok === false) {
        this._freeSlots(baseSlot, meshStates.length);
        return colorBindGroupLayoutResult;
      }
      const maskedShadowColorBindGroupLayoutResult = this._bindGroupLayoutManager.getTriangleMaskedShadowColorBindGroupLayout();
      if (maskedShadowColorBindGroupLayoutResult.ok === false) {
        this._freeSlots(baseSlot, meshStates.length);
        return maskedShadowColorBindGroupLayoutResult;
      }
      const textureTupleKey = pbrTriangleColor ? getPBRTextureTupleKey(this._textureBindGroupManager, firstMesh) : DEFAULT_TEXTURE_KEY;
      const textureTransformData = pbrTriangleColor ? createTextureTransformData(firstMesh) : null;
      const uvs = pbrTriangleColor && textureTupleKey !== DEFAULT_TEXTURE_KEY ? new Float32Array(totalVertices * 2) : null;
      const normals = pbrTriangleColor ? new Float32Array(totalVertices * 4) : null;
      const materials = pbrTriangleColor ? new Float32Array(totalVertices * TRIANGLE_MATERIAL_FLOATS_PER_VERTEX) : null;
      const skipDepthPrepass = isTriangles && meshStates.some((meshState) =>
        getEffectiveAlphaMode(meshState.mesh) !== 0 ||
        materialNeedsColorPassDepth(meshState.mesh) ||
        (pbrTriangleColor && meshHasAnyPBRTexture(meshState.mesh))
      );
      const indexFormat = totalVertices > 65535 ? "uint32" : "uint16";
      const frameBinding = this._getFrameBinding(meshStates[0]?.geometryState);
      const pageAllocationResult = this._allocateBufferPageRange(baseKey, segmentLabel, indexFormat, totalVertices, totalIndices, totalEdgeIndices, memoryConfigs, frameBinding);
      if (pageAllocationResult.ok === false) {
        this._freeSlots(baseSlot, meshStates.length);
        return pageAllocationResult;
      }
      const pageAllocation = pageAllocationResult.value;
      bufferPage = pageAllocation.page;
      const indicesPageLocal = false;
      const indexVertexBase = 0;
      const indices = indexFormat === "uint32"
        ? new Uint32Array(totalIndices)
        : new Uint16Array(totalIndices);
      const edgeIndices = indexFormat === "uint32"
        ? new Uint32Array(totalEdgeIndices)
        : new Uint16Array(totalEdgeIndices);
      const slots: WebGPUTriangleMeshSlot[] = [];
      const slotByMeshId: {[meshId: string]: WebGPUTriangleMeshSlot} = {};
      const worldAABB = createEmptyAABB();

      const packStartedAt = nowMs();
      let vertexOffset = 0;
      let indexOffset = 0;
      let edgeIndexOffset = 0;
      for (let slotIndex = 0, len = meshStates.length; slotIndex < len; slotIndex++) {
        const meshState = meshStates[slotIndex];
        const geometryState = meshState.geometryState;
        const sourceVertexCount = geometryState.geometry.positionsCompressed!.length / 3;
        const lineSegmentCount = isLines ? Math.floor((geometryState.indices?.length ?? 0) / 2) : 0;
        const vertexCount = isPoints ? sourceVertexCount * 6 : (isLines ? lineSegmentCount * 6 : sourceVertexCount);
        const indexCount = isPoints ? sourceVertexCount * 6 : (isLines ? lineSegmentCount * 6 : geometryState.indices!.length);
        const edgeIndexCount = includeEdges ? geometryState.edgeIndexCount : 0;

        if (isPoints) {
          quantizeCompressedPointQuadsInto(
            geometryState.geometry.positionsCompressed!,
            geometryState.geometry.aabb!,
            positions,
            vertexOffset,
            positionAABB
          );
          copyCompressedPointQuadColorsInto(
            geometryState.geometry.colorsCompressed,
            colors!,
            vertexOffset,
            sourceVertexCount
          );
        } else if (isLines) {
          quantizeCompressedLineSegmentQuadsInto(
            geometryState.geometry.positionsCompressed!,
            geometryState.geometry.aabb!,
            geometryState.indices!,
            positions,
            lineOtherPositions!,
            vertexOffset,
            positionAABB
          );
          copyCompressedLineSegmentQuadColorsInto(
            geometryState.geometry.colorsCompressed,
            geometryState.indices!,
            colors!,
            vertexOffset,
            lineSegmentCount
          );
        } else {
          quantizeCompressedPositionsInto(
            geometryState.geometry.positionsCompressed!,
            geometryState.geometry.aabb!,
            positions,
            vertexOffset,
            positionAABB
          );
          if (pbrTriangleColor) {
            copyCompressedTriangleColorsInto(
              geometryState.geometry.colorsCompressed,
              colors!,
              vertexOffset,
              sourceVertexCount
            );
            copyUVsInto(
              geometryState.uvs,
              uvs,
              vertexOffset,
              sourceVertexCount
            );
            copyNormalsInto(
              geometryState.normals,
              normals!,
              vertexOffset,
              sourceVertexCount
            );
            copyMaterialInto(
              meshState.mesh,
              materials!,
              vertexOffset,
              sourceVertexCount,
              geometryState.uvs !== null && geometryState.uvs.length > 0
            );
          }
        }
        for (let i = 0; i < vertexCount; i++) {
          const metadataOffset = (vertexOffset + i) * 4;
          vertexMetadata[metadataOffset] = baseSlot + slotIndex;
          vertexMetadata[metadataOffset + 1] = pageAllocation.positionDecodeIndex;
          if (isPoints) {
            vertexMetadata[metadataOffset + 2] = Math.floor(i / 6);
            vertexMetadata[metadataOffset + 3] = vertexMetadata[metadataOffset + 2];
          } else if (isLines) {
            const lineSegmentIndex = Math.floor(i / 6) * 2;
            const corner = i % 6;
            const currentIsA = corner === 0 || corner === 3 || corner === 5;
            const indexA = geometryState.indices![lineSegmentIndex];
            const indexB = geometryState.indices![lineSegmentIndex + 1];
            vertexMetadata[metadataOffset + 2] = currentIsA ? indexA : indexB;
            vertexMetadata[metadataOffset + 3] = currentIsA ? indexB : indexA;
          } else {
            vertexMetadata[metadataOffset + 2] = i;
            vertexMetadata[metadataOffset + 3] = i;
          }
        }
        if (isPoints) {
          for (let i = 0; i < indexCount; i++) {
            indices[indexOffset + i] = vertexOffset + i + indexVertexBase;
          }
        } else if (isLines) {
          for (let i = 0; i < indexCount; i++) {
            indices[indexOffset + i] = vertexOffset + i + indexVertexBase;
          }
        } else {
          for (let i = 0; i < indexCount; i++) {
            indices[indexOffset + i] = geometryState.indices![i] + vertexOffset + indexVertexBase;
          }
        }
        if (includeEdges && geometryState.edgeIndices) {
          for (let i = 0; i < edgeIndexCount; i++) {
            edgeIndices[edgeIndexOffset + i] = geometryState.edgeIndices[i] + vertexOffset + indexVertexBase;
          }
        }

        const slot: WebGPUTriangleMeshSlot = {
          meshState,
          signature: this._getMeshSignature(meshState),
          globalSlot: baseSlot + slotIndex,
          vertexStart: vertexOffset,
          vertexCount,
          indexStart: indexOffset,
          indexCount,
          edgeIndexStart: edgeIndexOffset,
          edgeIndexCount,
          instanceWriteStateByViewId: {}
        };
        meshState.packedVertexStart = vertexOffset;
        slots.push(slot);
        slotByMeshId[meshState.mesh.uniqueId] = slot;
        expandWorldAABB(worldAABB, geometryState.renderAABB, getMeshWorldMatrix(meshState));

        vertexOffset += vertexCount;
        indexOffset += indexCount;
        edgeIndexOffset += edgeIndexCount;
      }
      packMs = nowMs() - packStartedAt;

      const uploadStartedAt = nowMs();
      this._renderContext.writeGPUBuffer(bufferPage.vertexBuffer, pageAllocation.vertexByteOffset, positions);
      if (colors && bufferPage.colorBuffer) {
        this._renderContext.writeGPUBuffer(bufferPage.colorBuffer, pageAllocation.vertexColorByteOffset, colors);
      }
      if (uvs && bufferPage.uvBuffer) {
        this._renderContext.writeGPUBuffer(bufferPage.uvBuffer, pageAllocation.vertexUVByteOffset, uvs);
      }
      if (normals && bufferPage.normalBuffer) {
        this._renderContext.writeGPUBuffer(bufferPage.normalBuffer, pageAllocation.vertexNormalByteOffset, normals);
      }
      if (materials && bufferPage.materialBuffer) {
        this._renderContext.writeGPUBuffer(bufferPage.materialBuffer, pageAllocation.vertexMaterialByteOffset, materials);
      }
      if (lineOtherPositions && bufferPage.lineOtherVertexBuffer) {
        this._renderContext.writeGPUBuffer(bufferPage.lineOtherVertexBuffer, pageAllocation.vertexByteOffset, lineOtherPositions);
      }
      this._renderContext.writeGPUBuffer(bufferPage.vertexMetadataBuffer, pageAllocation.vertexMetadataByteOffset, vertexMetadata);
      this._renderContext.writeGPUBuffer(bufferPage.positionDecodeBuffer, pageAllocation.positionDecodeByteOffset, positionDecode);
      this._renderContext.writeGPUBuffer(bufferPage.indexBuffer, pageAllocation.indexByteOffset, indices);
      if (edgeIndices.length > 0 && bufferPage.edgeIndexBuffer) {
        this._renderContext.writeGPUBuffer(bufferPage.edgeIndexBuffer, pageAllocation.edgeIndexByteOffset, edgeIndices);
      }
      uploadMs = nowMs() - uploadStartedAt;

      const textureTransformBuffer = textureTransformData
        ? this._renderContext.createGPUBuffer(
            `xeokit-webgpu-texture-transforms:triangles:${segmentLabel}`,
            textureTransformData,
            GPU_BUFFER_USAGE.UNIFORM
          )
        : null;

      const colorBindGroup = this._renderContext.device.createBindGroup({
        label: `xeokit-webgpu-triangle-color-bind-group:triangles:${segmentLabel}`,
        layout: colorBindGroupLayoutResult.value,
        entries: [{
          binding: 0,
          resource: {
            buffer: bufferPage.positionDecodeBuffer
          }
        }, {
          binding: 1,
          resource: albedoBinding.sampler
        }, {
          binding: 2,
          resource: albedoBinding.textureView
        }, {
          binding: 3,
          resource: metallicRoughnessBinding.sampler
        }, {
          binding: 4,
          resource: metallicRoughnessBinding.textureView
        }, {
          binding: 5,
          resource: normalBinding.sampler
        }, {
          binding: 6,
          resource: normalBinding.textureView
        }, {
          binding: 7,
          resource: emissiveBinding.sampler
        }, {
          binding: 8,
          resource: emissiveBinding.textureView
        }, {
          binding: 9,
          resource: occlusionBinding.sampler
        }, {
          binding: 10,
          resource: occlusionBinding.textureView
        }, {
          binding: 11,
          resource: {
            buffer: textureTransformBuffer ?? this._identityTextureTransformBuffer()
          }
        }, {
          binding: 12,
          resource: {
            buffer: bufferPage.frameBinding.positionBuffer
          }
        }, {
          binding: 13,
          resource: {
            buffer: bufferPage.frameBinding.positionDecodeBuffer
          }
        }, {
          binding: 14,
          resource: {
            buffer: bufferPage.frameBinding.normalBuffer
          }
        }, {
          binding: 15,
          resource: {
            buffer: bufferPage.frameBinding.uvBuffer
          }
        }]
      });
      const maskedShadowColorBindGroup = this._renderContext.device.createBindGroup({
        label: `xeokit-webgpu-triangle-masked-shadow-color-bind-group:triangles:${segmentLabel}`,
        layout: maskedShadowColorBindGroupLayoutResult.value,
        entries: [{
          binding: 1,
          resource: albedoBinding.sampler
        }, {
          binding: 2,
          resource: albedoBinding.textureView
        }, {
          binding: 11,
          resource: {
            buffer: textureTransformBuffer ?? this._identityTextureTransformBuffer()
          }
        }]
      });

      const segment: TriangleBatchSegment = {
        key,
        baseKey,
        bufferPageKey: bufferPage.key,
        label: segmentLabel,
        signature,
        primitive: isPoints ? PointsPrimitive : (isLines ? LinesPrimitive : TrianglesPrimitive),
        hasNormals,
        triangleRenderClass,
        baseSlot,
        slotCount: slots.length,
        slotEnd: baseSlot + slots.length,
        vertexBuffer: bufferPage.vertexBuffer,
        vertexBufferOffset: pageAllocation.vertexByteOffset,
        colorBuffer: bufferPage.colorBuffer,
        colorBufferOffset: pageAllocation.vertexColorByteOffset,
        uvBuffer: bufferPage.uvBuffer,
        uvBufferOffset: pageAllocation.vertexUVByteOffset,
        normalBuffer: bufferPage.normalBuffer,
        normalBufferOffset: pageAllocation.vertexNormalByteOffset,
        materialBuffer: bufferPage.materialBuffer,
        materialBufferOffset: pageAllocation.vertexMaterialByteOffset,
        lineOtherVertexBuffer: bufferPage.lineOtherVertexBuffer,
        lineOtherVertexBufferOffset: pageAllocation.vertexByteOffset,
        positionDecodeBuffer: bufferPage.positionDecodeBuffer,
        positionDecodeBindGroup: bufferPage.positionDecodeBindGroup,
        frameBinding: bufferPage.frameBinding,
        colorBindGroup,
        maskedShadowColorBindGroup,
        textureTransformBuffer,
        vertexMetadataBuffer: bufferPage.vertexMetadataBuffer,
        indexBuffer: bufferPage.indexBuffer,
        edgeIndexBuffer: bufferPage.edgeIndexBuffer,
        indexBufferOffset: pageAllocation.indexByteOffset,
        edgeIndexBufferOffset: pageAllocation.edgeIndexByteOffset,
        vertexMetadataBufferOffset: pageAllocation.vertexMetadataByteOffset,
        slots,
        slotByMeshId,
        indices,
        edgeIndices,
        indexFormat,
        positionAABB,
        indicesPageLocal,
        textureKey: textureTupleKey,
        skipDepthPrepass,
        lodVariantMemberships: meshStates[0]?.lodVariantMemberships ?? [],
        worldAABB,
        boundsVersion: this._getBoundsVersion(slots),
        destroy: () => {
          textureTransformBuffer?.destroy?.();
          if (bufferPage) {
            this._releaseBufferPage(bufferPage);
          }
        }
      };

      this._lastSegmentBuildSample = {
        key,
        baseKey,
        meshCount: meshStates.length,
        vertexCount: totalVertices,
        indexCount: totalIndices,
        edgeIndexCount: totalEdgeIndices,
        totalMs: nowMs() - segmentStartedAt,
        packMs,
        uploadMs,
        indexFormat
      };

      return {
        ok: true,
        value: segment
      };
    } catch (e) {
      if (bufferPage) {
        this._releaseBufferPage(bufferPage);
      }
      this._freeSlots(baseSlot, meshStates.length);
      return {
        ok: false,
        type: SDKErrorType.InitializationFailed,
        error: `[TriangleBatchManager.prepare] Failed to create packed triangle segment '${key}': ${e instanceof Error ? e.message : String(e)}`
      };
    }
  }

  public writeInstances(params: {
    batchSet: TriangleBatchSet;
    segments?: TriangleBatchSegment[];
    view: View;
    meshManager: MeshManager;
    instanceFrame: InstanceBufferFrame;
  }): void {
    const {batchSet, view, meshManager, instanceFrame} = params;
    const viewStateVersion = meshManager.getViewStateVersion(view);
    const segments = instanceFrame.forceFullUpload ? batchSet.segments : (params.segments ?? batchSet.segments);
    let dirtyBaseSlot = -1;
    let dirtyEndSlot = -1;
    const flushDirtyRange = () => {
      if (dirtyBaseSlot < 0) {
        return;
      }
      InstanceBufferManager.markDirtySlotRange(instanceFrame, dirtyBaseSlot, dirtyEndSlot - dirtyBaseSlot);
      dirtyBaseSlot = -1;
      dirtyEndSlot = -1;
    };
    const markDirtySlot = (globalSlot: number) => {
      if (instanceFrame.forceFullUpload) {
        return;
      }
      if (dirtyBaseSlot < 0) {
        dirtyBaseSlot = globalSlot;
        dirtyEndSlot = globalSlot + 1;
        return;
      }
      if (globalSlot === dirtyEndSlot) {
        dirtyEndSlot++;
        return;
      }
      flushDirtyRange();
      dirtyBaseSlot = globalSlot;
      dirtyEndSlot = globalSlot + 1;
    };

    for (let segmentIndex = 0, segmentLen = segments.length; segmentIndex < segmentLen; segmentIndex++) {
      const segment = segments[segmentIndex];
      for (let i = 0, len = segment.slots.length; i < len; i++) {
        const slot = segment.slots[i];
        const meshState = slot.meshState;
        const writeState = slot.instanceWriteStateByViewId[view.id];
        if (
          !instanceFrame.forceFullUpload &&
          writeState?.bufferVersion === instanceFrame.bufferVersion &&
          writeState.meshInstanceDataVersion === meshState.instanceDataVersion &&
          writeState.viewStateVersion === viewStateVersion
        ) {
          continue;
        }
        const drawItem: DrawItem = {
          meshState,
          opacity: meshManager.getMeshOpacityInView(meshState, view),
          viewDepth: 0,
          style: null
        };
        meshManager.writeInstanceData(drawItem, view, instanceFrame.data, slot.globalSlot * INSTANCE_FLOATS, this._rtcTileResolver);
        slot.instanceWriteStateByViewId[view.id] = {
          bufferVersion: instanceFrame.bufferVersion,
          meshInstanceDataVersion: meshState.instanceDataVersion,
          viewStateVersion
        };
        markDirtySlot(slot.globalSlot);
      }
    }
    flushDirtyRange();
    instanceFrame.instanceCount = batchSet.instanceCapacity;
  }

  public getMemoryStats(): TriangleBatchMemoryStats {
    const stats: TriangleBatchMemoryStats = {
      pages: this._bufferPagesByKey.size,
      segments: this._segmentsByKey.size,
      totalBytes: 0,
      vertexBytes: 0,
      uvBytes: 0,
      normalBytes: 0,
      vertexMetadataBytes: 0,
      indexBytes: 0,
      edgeIndexBytes: 0,
      positionDecodeBytes: 0,
      usedVertexBytes: 0,
      usedUVBytes: 0,
      usedNormalBytes: 0,
      usedVertexMetadataBytes: 0,
      usedIndexBytes: 0,
      usedEdgeIndexBytes: 0,
      usedPositionDecodeBytes: 0,
      pageDetails: [],
      segmentsByLoadingMode: {},
      segmentsByMemoryPolicy: {}
    };

    const segmentCountsByPageKey = new Map<string, number>();
    for (const segment of this._segmentsByKey.values()) {
      segmentCountsByPageKey.set(segment.bufferPageKey, (segmentCountsByPageKey.get(segment.bufferPageKey) ?? 0) + 1);
    }

    for (const page of this._bufferPagesByKey.values()) {
      const indexBytes = getIndexElementByteLength(page.indexFormat);
      const vertexBytes = page.vertexCapacity * 8;
      const colorBytes = page.colorBuffer ? page.vertexCapacity * 4 : 0;
      const uvBytes = page.uvBuffer ? page.vertexCapacity * 8 : 0;
      const normalBytes = page.normalBuffer ? page.vertexCapacity * 16 : 0;
      const vertexMetadataBytes = page.vertexCapacity * 16;
      const pageIndexBytes = page.indexCapacity * indexBytes;
      const edgeIndexBytes = page.edgeIndexCapacity * indexBytes;
      const positionDecodeBytes = page.positionDecodeCapacity * TRIANGLE_POSITION_DECODE_UNIFORM_BYTES;
      const usedVertexBytes = page.usedVertices * 8;
      const usedColorBytes = page.colorBuffer ? page.usedVertices * 4 : 0;
      const usedUVBytes = page.uvBuffer ? page.usedVertices * 8 : 0;
      const usedNormalBytes = page.normalBuffer ? page.usedVertices * 16 : 0;
      const usedVertexMetadataBytes = page.usedVertices * 16;
      const usedIndexBytes = page.usedIndices * indexBytes;
      const usedEdgeIndexBytes = page.usedEdgeIndices * indexBytes;
      const usedPositionDecodeBytes = page.usedPositionDecodes * TRIANGLE_POSITION_DECODE_UNIFORM_BYTES;
      const bytes = vertexBytes + colorBytes + uvBytes + normalBytes + vertexMetadataBytes + pageIndexBytes + edgeIndexBytes + positionDecodeBytes;
      const usedBytes = usedVertexBytes + usedColorBytes + usedUVBytes + usedNormalBytes + usedVertexMetadataBytes + usedIndexBytes + usedEdgeIndexBytes + usedPositionDecodeBytes;
      stats.vertexBytes += vertexBytes;
      stats.uvBytes += uvBytes;
      stats.normalBytes += normalBytes;
      stats.vertexMetadataBytes += vertexMetadataBytes;
      stats.indexBytes += pageIndexBytes;
      stats.edgeIndexBytes += edgeIndexBytes;
      stats.positionDecodeBytes += positionDecodeBytes;
      stats.usedVertexBytes += usedVertexBytes;
      stats.usedUVBytes += usedUVBytes;
      stats.usedNormalBytes += usedNormalBytes;
      stats.usedVertexMetadataBytes += usedVertexMetadataBytes;
      stats.usedIndexBytes += usedIndexBytes;
      stats.usedEdgeIndexBytes += usedEdgeIndexBytes;
      stats.usedPositionDecodeBytes += usedPositionDecodeBytes;
      stats.pageDetails.push({
        key: page.key,
        indexFormat: page.indexFormat,
        segmentCount: segmentCountsByPageKey.get(page.key) ?? 0,
        vertexCapacity: page.vertexCapacity,
        usedVertices: page.usedVertices,
        indexCapacity: page.indexCapacity,
        usedIndices: page.usedIndices,
        edgeIndexCapacity: page.edgeIndexCapacity,
        usedEdgeIndices: page.usedEdgeIndices,
        positionDecodeCapacity: page.positionDecodeCapacity,
        usedPositionDecodes: page.usedPositionDecodes,
        bytes,
        usedBytes,
        vertexBytes,
        uvBytes,
        normalBytes,
        vertexMetadataBytes,
        indexBytes: pageIndexBytes,
        edgeIndexBytes,
        positionDecodeBytes,
        usedVertexBytes,
        usedUVBytes,
        usedNormalBytes,
        usedVertexMetadataBytes,
        usedIndexBytes,
        usedEdgeIndexBytes,
        usedPositionDecodeBytes
      });
    }

    stats.totalBytes =
      stats.vertexBytes +
      stats.uvBytes +
      stats.normalBytes +
      stats.vertexMetadataBytes +
      stats.indexBytes +
      stats.edgeIndexBytes +
      stats.positionDecodeBytes;

    for (const segment of this._segmentsByKey.values()) {
      const {loadingMode, memoryPolicy} = parseSegmentBaseKey(segment.baseKey);
      stats.segmentsByLoadingMode[loadingMode] = (stats.segmentsByLoadingMode[loadingMode] ?? 0) + 1;
      stats.segmentsByMemoryPolicy[memoryPolicy] = (stats.segmentsByMemoryPolicy[memoryPolicy] ?? 0) + 1;
    }

    return stats;
  }

  public createDrawBatch(params: {
    segment: TriangleBatchSegment;
    drawItems: DrawItem[];
    label: string;
    topology?: "triangles" | "edges";
    renderStateKey?: string;
    cacheKey?: string;
    reuseFullSegmentIndex?: boolean;
  }): SDKResult<InstancedDrawBatch | null> {
    const {segment, drawItems} = params;
    const topology = params.topology ?? "triangles";
    const renderStateKey = topology === "triangles"
      ? `${params.renderStateKey ?? "default"}|texture:${segment.textureKey}`
      : params.renderStateKey;
    if (drawItems.length === 0) {
      return {
        ok: true,
        value: null
      };
    }

    if (topology === "edges" && (!segment.edgeIndexBuffer || segment.edgeIndices.length === 0)) {
      return {
        ok: true,
        value: null
      };
    }

    if (params.reuseFullSegmentIndex && this._containsAllSegmentSlots(segment, drawItems, topology)) {
      return {
        ok: true,
        value: {
          packedBatch: {
            primitive: segment.primitive,
            hasNormals: segment.hasNormals,
            triangleRenderClass: segment.triangleRenderClass,
            label: params.label,
            segmentKey: segment.key,
            bufferPageKey: segment.bufferPageKey,
            renderStateKey,
            topology,
            vertexBuffer: segment.vertexBuffer,
            vertexBufferOffset: segment.vertexBufferOffset,
            colorBuffer: segment.colorBuffer,
            colorBufferOffset: segment.colorBufferOffset,
            uvBuffer: segment.uvBuffer,
            uvBufferOffset: segment.uvBufferOffset,
            normalBuffer: segment.normalBuffer,
            normalBufferOffset: segment.normalBufferOffset,
            materialBuffer: segment.materialBuffer,
            materialBufferOffset: segment.materialBufferOffset,
            lineOtherVertexBuffer: segment.lineOtherVertexBuffer,
            lineOtherVertexBufferOffset: segment.lineOtherVertexBufferOffset,
            positionDecodeBindGroup: segment.positionDecodeBindGroup,
            colorBindGroup: segment.colorBindGroup,
            maskedShadowColorBindGroup: segment.maskedShadowColorBindGroup,
            vertexMetadataBuffer: segment.vertexMetadataBuffer,
            vertexMetadataBufferOffset: segment.vertexMetadataBufferOffset,
            indexBuffer: topology === "edges" ? segment.edgeIndexBuffer! : segment.indexBuffer,
            indexBufferOffset: topology === "edges" ? segment.edgeIndexBufferOffset : segment.indexBufferOffset,
            indexFormat: segment.indexFormat,
            indexCount: topology === "edges" ? segment.edgeIndices.length : segment.indices.length,
            firstIndex: 0,
            indicesPageLocal: segment.indicesPageLocal,
            temporaryIndexBuffer: false,
            temporaryIndexBufferCreated: false,
            textureKey: segment.textureKey,
            skipDepthPrepass: segment.skipDepthPrepass,
            destroy: () => {
              // Borrowed from the persistent segment; destroyed with the segment.
            }
          }
        }
      };
    }

    let totalIndices = 0;
    for (let i = 0, len = drawItems.length; i < len; i++) {
      const slot = segment.slotByMeshId[drawItems[i].meshState.mesh.uniqueId];
      if (!slot) {
        return {
          ok: false,
          type: SDKErrorType.InvalidInput,
        error: `[TriangleBatchManager.createDrawBatch] Mesh '${drawItems[i].meshState.mesh.uniqueId}' is not in prepared triangle segment '${segment.key}'.`
      };
      }
      totalIndices += topology === "edges" ? slot.edgeIndexCount : slot.indexCount;
    }
    if (totalIndices === 0) {
      return {
        ok: true,
        value: null
      };
    }

    const cachedBatch = null;
    if (cachedBatch) {
      return {
        ok: true,
        value: cloneCachedDrawBatch(cachedBatch, false)
      };
    }

    let indexBuffer: WebGPUBufferLike | null = null;
    try {
      const indices = segment.indexFormat === "uint32"
        ? new Uint32Array(totalIndices)
        : new Uint16Array(totalIndices);
      let indexOffset = 0;
      for (let i = 0, len = drawItems.length; i < len; i++) {
        const slot = segment.slotByMeshId[drawItems[i].meshState.mesh.uniqueId];
        if (topology === "edges") {
          indices.set(segment.edgeIndices.subarray(slot.edgeIndexStart, slot.edgeIndexStart + slot.edgeIndexCount), indexOffset);
          indexOffset += slot.edgeIndexCount;
        } else {
          indices.set(segment.indices.subarray(slot.indexStart, slot.indexStart + slot.indexCount), indexOffset);
          indexOffset += slot.indexCount;
        }
      }

      indexBuffer = this._renderContext.createGPUBuffer(
        `xeokit-webgpu-packed-${topology === "edges" ? "edge-" : ""}indices:${params.label}`,
        indices,
        GPU_BUFFER_USAGE.INDEX
      );

      const newBatch: InstancedDrawBatch = {
        packedBatch: {
          label: params.label,
          primitive: segment.primitive,
          hasNormals: segment.hasNormals,
          triangleRenderClass: segment.triangleRenderClass,
          segmentKey: segment.key,
          bufferPageKey: segment.bufferPageKey,
          renderStateKey,
          topology,
          vertexBuffer: segment.vertexBuffer,
          vertexBufferOffset: segment.vertexBufferOffset,
          colorBuffer: segment.colorBuffer,
          colorBufferOffset: segment.colorBufferOffset,
          uvBuffer: segment.uvBuffer,
          uvBufferOffset: segment.uvBufferOffset,
          normalBuffer: segment.normalBuffer,
          normalBufferOffset: segment.normalBufferOffset,
          materialBuffer: segment.materialBuffer,
          materialBufferOffset: segment.materialBufferOffset,
          lineOtherVertexBuffer: segment.lineOtherVertexBuffer,
          lineOtherVertexBufferOffset: segment.lineOtherVertexBufferOffset,
          positionDecodeBindGroup: segment.positionDecodeBindGroup,
          colorBindGroup: segment.colorBindGroup,
          maskedShadowColorBindGroup: segment.maskedShadowColorBindGroup,
          vertexMetadataBuffer: segment.vertexMetadataBuffer,
          vertexMetadataBufferOffset: segment.vertexMetadataBufferOffset,
          indexBuffer,
          indexBufferOffset: 0,
          indexFormat: segment.indexFormat,
          indexCount: indices.length,
          firstIndex: 0,
          indicesPageLocal: segment.indicesPageLocal,
          temporaryIndexBuffer: true,
          temporaryIndexBufferCreated: true,
          textureKey: segment.textureKey,
          skipDepthPrepass: segment.skipDepthPrepass,
          destroy: () => {
            this._renderContext.destroyGPUBuffer(indexBuffer);
          }
        }
      };

      return {
        ok: true,
        value: newBatch
      };
    } catch (e) {
      this._renderContext.destroyGPUBuffer(indexBuffer);
      return {
        ok: false,
        type: SDKErrorType.InitializationFailed,
        error: `[TriangleBatchManager.createDrawBatch] Failed to create triangle draw batch '${params.label}': ${e instanceof Error ? e.message : String(e)}`
      };
    }
  }

  public destroy(): void {
    for (const segment of this._segmentsByKey.values()) {
      this._destroySegment(segment);
    }
    this._segmentsByKey.clear();
    this._segmentByMeshId.clear();
    this._pageCountersByBaseKey.clear();
    this._freeSlotRanges.length = 0;
    this._pendingSegmentJobs.length = 0;
    this._recentBuildSamples.length = 0;
    this._slowestBuildSamples.length = 0;
    this._lastSegmentBuildSample = null;
    this._totalSegmentsBuilt = 0;
    this._totalBuildMs = 0;
    this._totalPackMs = 0;
    this._totalUploadMs = 0;
    this._totalMeshCount = 0;
    this._totalVertexCount = 0;
    this._totalIndexCount = 0;
    this._totalEdgeIndexCount = 0;
    this._lastBuildSegments = 0;
    this._lastBuildMs = 0;
    this._lastBuildPackMs = 0;
    this._lastBuildUploadMs = 0;
    this._lastBuildPendingBefore = 0;
    this._lastBuildPendingAfter = 0;
    for (const batch of this._partialDrawBatchCache.values()) {
      batch.packedBatch.destroy();
    }
    this._partialDrawBatchCache.clear();
    for (const page of this._bufferPagesByKey.values()) {
      try {
        page.destroy();
      } catch {
        // Ignore buffer destruction failures during teardown.
      }
    }
    this._bufferPagesByKey.clear();
    this._currentBufferPageByKey.clear();
    this._textureBindGroupManager.destroy();
    this._identityTextureTransformBufferValue?.destroy?.();
    this._identityTextureTransformBufferValue = null;
    this._nextSlot = 0;
    this._batchSet = null;
  }

  private _clearPackedSegmentsForRepack(): void {
    for (const segment of this._segmentsByKey.values()) {
      this._destroySegment(segment);
    }
    this._segmentsByKey.clear();
    this._segmentByMeshId.clear();
    this._pageCountersByBaseKey.clear();
    this._freeSlotRanges.length = 0;
    this._pendingSegmentJobs.length = 0;
    for (const batch of this._partialDrawBatchCache.values()) {
      batch.packedBatch.destroy();
    }
    this._partialDrawBatchCache.clear();
    for (const page of this._bufferPagesByKey.values()) {
      try {
        page.destroy();
      } catch {
        // Ignore buffer destruction failures during repack.
      }
    }
    this._bufferPagesByKey.clear();
    this._currentBufferPageByKey.clear();
    this._nextSlot = 0;
    this._batchSet = null;
  }

  public sceneTextureImageDataChanged(sceneTexture: SceneTexture): void {
    this._textureBindGroupManager.sceneTextureImageDataChanged(sceneTexture);
  }

  public sceneTextureUVTransformChanged(sceneTexture: SceneTexture): void {
    for (const segment of this._segmentsByKey.values()) {
      if (!segment.textureTransformBuffer || !segment.slots.some((slot) => meshUsesTexture(slot.meshState.mesh, sceneTexture))) {
        continue;
      }
      this._renderContext.writeGPUBuffer(
        segment.textureTransformBuffer,
        0,
        createTextureTransformData(segment.slots[0]?.meshState.mesh)
      );
    }
    this._batchSet = null;
  }

  public updateSceneGeometry(meshStates: RendererMesh[], updateFlags: number): boolean {
    if (meshStates.length === 0) {
      return true;
    }
    for (let i = 0, len = meshStates.length; i < len; i++) {
      const meshState = meshStates[i];
      if (!this._segmentByMeshId.has(meshState.mesh.uniqueId) && !this._pendingSegmentJobs.some(job =>
        job.structureVersion === this._batchSet?.structureVersion && job.meshStates.includes(meshState))) {
        return false;
      }
    }
    for (let i = 0, len = meshStates.length; i < len; i++) {
      const meshState = meshStates[i];
      const segment = this._segmentByMeshId.get(meshState.mesh.uniqueId);
      // Queued segments, including an idle repack's replacements, read this
      // live geometry state when built. No GPU allocation exists to patch yet.
      // Treating that as failure rebuilds the live mesh and restarts repacking
      // on every animation tick until camera motion cancels the repack.
      if (!segment) {
        continue;
      }
      const slot = segment.slotByMeshId[meshState.mesh.uniqueId];
      if (!slot) {
        return false;
      }
      const primitive = meshState.geometryState.geometry.primitive;
      const hasTriangleNormals = primitive !== PointsPrimitive && primitive !== LinesPrimitive;
      if (
        hasTriangleNormals &&
        (updateFlags & SCENE_GEOMETRY_UPDATE_NORMALS_COMPRESSED) !== 0 &&
        (!segment.normalBuffer || !meshState.geometryState.normals)
      ) {
        return false;
      }
      this._updatePackedMeshGeometry(segment, slot, updateFlags);
    }
    if ((updateFlags & SCENE_GEOMETRY_UPDATE_INDICES) !== 0) {
      for (const batch of this._partialDrawBatchCache.values()) {
        batch.packedBatch.destroy();
      }
      this._partialDrawBatchCache.clear();
    }
    return true;
  }

  private _updatePackedMeshGeometry(segment: TriangleBatchSegment, slot: WebGPUTriangleMeshSlot, updateFlags: number): void {
    const meshState = slot.meshState;
    const geometryState = meshState.geometryState;
    const primitive = geometryState.geometry.primitive;
    const isPoints = primitive === PointsPrimitive;
    const isLines = primitive === LinesPrimitive;

    if ((updateFlags & (SCENE_GEOMETRY_UPDATE_POSITIONS_COMPRESSED | SCENE_GEOMETRY_UPDATE_INDICES)) !== 0) {
      if (isPoints) {
        const positions = new Uint16Array(slot.vertexCount * 4);
        quantizeCompressedPointQuadsInto(
          geometryState.geometry.positionsCompressed!,
          geometryState.geometry.aabb!,
          positions,
          0,
          segment.positionAABB
        );
        this._renderContext.writeGPUBuffer(segment.vertexBuffer, segment.vertexBufferOffset + slot.vertexStart * 4 * Uint16Array.BYTES_PER_ELEMENT, positions);
      } else if (isLines) {
        const positions = new Uint16Array(slot.vertexCount * 4);
        const otherPositions = new Uint16Array(slot.vertexCount * 4);
        quantizeCompressedLineSegmentQuadsInto(
          geometryState.geometry.positionsCompressed!,
          geometryState.geometry.aabb!,
          geometryState.indices!,
          positions,
          otherPositions,
          0,
          segment.positionAABB
        );
        const vertexByteOffset = segment.vertexBufferOffset + slot.vertexStart * 4 * Uint16Array.BYTES_PER_ELEMENT;
        this._renderContext.writeGPUBuffer(segment.vertexBuffer, vertexByteOffset, positions);
        if (segment.lineOtherVertexBuffer) {
          this._renderContext.writeGPUBuffer(segment.lineOtherVertexBuffer, segment.lineOtherVertexBufferOffset + slot.vertexStart * 4 * Uint16Array.BYTES_PER_ELEMENT, otherPositions);
        }
      } else if ((updateFlags & SCENE_GEOMETRY_UPDATE_POSITIONS_COMPRESSED) !== 0) {
        const positions = new Uint16Array(slot.vertexCount * 4);
        quantizeCompressedPositionsInto(
          geometryState.geometry.positionsCompressed!,
          geometryState.geometry.aabb!,
          positions,
          0,
          segment.positionAABB
        );
        this._renderContext.writeGPUBuffer(segment.vertexBuffer, segment.vertexBufferOffset + slot.vertexStart * 4 * Uint16Array.BYTES_PER_ELEMENT, positions);
      }
    }

    if (!isPoints && !isLines && (updateFlags & SCENE_GEOMETRY_UPDATE_INDICES) !== 0 && geometryState.indices) {
      for (let i = 0; i < slot.indexCount; i++) {
        segment.indices[slot.indexStart + i] = geometryState.indices[i] + slot.vertexStart;
      }
      this._writeIndexSubRange(segment, slot.indexStart, slot.indexCount);
    }

    if (!isPoints && !isLines && (updateFlags & SCENE_GEOMETRY_UPDATE_NORMALS_COMPRESSED) !== 0 && segment.normalBuffer && geometryState.normals) {
      const normals = new Float32Array(slot.vertexCount * 4);
      copyNormalsInto(geometryState.normals, normals, 0, slot.vertexCount);
      this._renderContext.writeGPUBuffer(
        segment.normalBuffer,
        segment.normalBufferOffset + slot.vertexStart * 4 * Float32Array.BYTES_PER_ELEMENT,
        normals
      );
    }
    // Flat/untextured segments have no UV buffer; their CPU state is still kept
    // current for a later material/render-mode change.
    if (!isPoints && !isLines && (updateFlags & SCENE_GEOMETRY_UPDATE_UVS_COMPRESSED) !== 0 && segment.uvBuffer && geometryState.uvs) {
      this._renderContext.writeGPUBuffer(
        segment.uvBuffer,
        segment.uvBufferOffset + slot.vertexStart * 2 * Float32Array.BYTES_PER_ELEMENT,
        geometryState.uvs
      );
    }
  }

  private _writeIndexSubRange(segment: TriangleBatchSegment, indexStart: number, indexCount: number): void {
    let alignedStart = indexStart;
    let alignedCount = indexCount;
    if (segment.indexFormat === "uint16" && (alignedStart & 1) !== 0) {
      alignedStart--;
      alignedCount++;
    }
    alignedCount = alignIndexElementCountForWrite(alignedCount, segment.indexFormat);
    const maxCount = segment.indices.length - alignedStart;
    if (alignedCount > maxCount) {
      alignedCount = maxCount;
    }
    const bytesPerIndex = segment.indexFormat === "uint32" ? Uint32Array.BYTES_PER_ELEMENT : Uint16Array.BYTES_PER_ELEMENT;
    this._renderContext.writeGPUBuffer(
      segment.indexBuffer,
      segment.indexBufferOffset + alignedStart * bytesPerIndex,
      segment.indices.subarray(alignedStart, alignedStart + alignedCount)
    );
  }

  private _groupNewMeshStates(meshStates: RendererMesh[], assignedMeshIds: Set<string>): Map<string, RendererMesh[]> {
    const groups = new Map<string, RendererMesh[]>();
    for (let i = 0, len = meshStates.length; i < len; i++) {
      const meshState = meshStates[i];
      if (assignedMeshIds.has(meshState.mesh.uniqueId)) {
        continue;
      }
      if (meshState.geometryState.geometry.primitive === GaussianSplatsPrimitive) {
        continue;
      }
      const key = this._getSegmentBaseKey(meshState);
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(meshState);
    }
    return groups;
  }

  private _trackSegment(
    segment: TriangleBatchSegment,
    assignedMeshIds: Set<string>,
    segmentByMeshId: {[meshId: string]: TriangleBatchSegment}
  ): void {
    for (let i = 0, len = segment.slots.length; i < len; i++) {
      const meshId = segment.slots[i].meshState.mesh.uniqueId;
      assignedMeshIds.add(meshId);
      this._segmentByMeshId.set(meshId, segment);
      segmentByMeshId[meshId] = segment;
    }
  }

  private _containsAllSegmentSlots(segment: TriangleBatchSegment, drawItems: DrawItem[], topology: "triangles" | "edges"): boolean {
    if (drawItems.length !== segment.slots.length) {
      return false;
    }
    const meshIds = new Set<string>();
    for (let i = 0, len = drawItems.length; i < len; i++) {
      meshIds.add(drawItems[i].meshState.mesh.uniqueId);
    }
    for (let i = 0, len = segment.slots.length; i < len; i++) {
      const slot = segment.slots[i];
      if (!meshIds.has(slot.meshState.mesh.uniqueId)) {
        return false;
      }
      if (topology === "edges" && slot.edgeIndexCount === 0) {
        return false;
      }
    }
    return true;
  }

  private _allocateBufferPageRange(
    baseKey: string,
    segmentLabel: string,
    indexFormat: "uint16" | "uint32",
    vertexCount: number,
    indexCount: number,
    edgeIndexCount: number,
    memoryConfigs: MemoryConfigs,
    frameBinding: TriangleFrameBinding | null
  ): SDKResult<{
    page: TriangleBufferPage;
    vertexBase: number;
    positionDecodeIndex: number;
    vertexByteOffset: number;
    vertexColorByteOffset: number;
    vertexUVByteOffset: number;
    vertexNormalByteOffset: number;
    vertexMaterialByteOffset: number;
    vertexMetadataByteOffset: number;
    positionDecodeByteOffset: number;
    indexByteOffset: number;
    edgeIndexByteOffset: number;
  }> {
    const pageKey = `${baseKey}|${indexFormat}`;
    const pageSegmentMultiplier = this._getBufferPageSegmentMultiplier(baseKey, memoryConfigs);
    let page = this._currentBufferPageByKey.get(pageKey);
    let indexBase = page ? alignIndexElementCountForWrite(page.usedIndices, indexFormat) : 0;
    let edgeIndexBase = page ? alignIndexElementCountForWrite(page.usedEdgeIndices, indexFormat) : 0;
    if (
      !page ||
      page.usedVertices + vertexCount > page.vertexCapacity ||
      indexBase + indexCount > page.indexCapacity ||
      edgeIndexBase + edgeIndexCount > page.edgeIndexCapacity ||
      page.usedPositionDecodes + 1 > page.positionDecodeCapacity
    ) {
      const pageResult = this._createBufferPage(pageKey, segmentLabel, indexFormat, vertexCount, indexCount, edgeIndexCount, pageSegmentMultiplier, frameBinding);
      if (pageResult.ok === false) {
        return pageResult;
      }
      page = pageResult.value;
      this._currentBufferPageByKey.set(pageKey, page);
      indexBase = 0;
      edgeIndexBase = 0;
    }

    const activePage = page;
    const vertexBase = activePage.usedVertices;
    const positionDecodeIndex = activePage.usedPositionDecodes;
    activePage.usedVertices += vertexCount;
    activePage.usedIndices = indexBase + indexCount;
    activePage.usedEdgeIndices = edgeIndexBase + edgeIndexCount;
    activePage.usedPositionDecodes++;
    activePage.refCount++;

    const indexBytes = indexFormat === "uint32" ? 4 : 2;
    return {
      ok: true,
      value: {
        page: activePage,
        vertexBase,
        positionDecodeIndex,
        vertexByteOffset: vertexBase * 8,
        vertexColorByteOffset: vertexBase * 4,
        vertexUVByteOffset: vertexBase * 8,
        vertexNormalByteOffset: vertexBase * 16,
        vertexMaterialByteOffset: vertexBase * TRIANGLE_MATERIAL_VERTEX_STRIDE_BYTES,
        vertexMetadataByteOffset: vertexBase * 16,
        positionDecodeByteOffset: positionDecodeIndex * TRIANGLE_POSITION_DECODE_UNIFORM_BYTES,
        indexByteOffset: indexBase * indexBytes,
        edgeIndexByteOffset: edgeIndexBase * indexBytes
      }
    };
  }

  private _createBufferPage(
    pageKey: string,
    segmentLabel: string,
    indexFormat: "uint16" | "uint32",
    vertexCount: number,
    indexCount: number,
    edgeIndexCount: number,
    pageSegmentMultiplier: number,
    frameBinding: TriangleFrameBinding | null
  ): SDKResult<TriangleBufferPage> {
    const sanitizedPageKey = this._sanitizeLabel(`${pageKey}|bufferPage:${this._bufferPagesByKey.size}`);
    const vertexCapacity = Math.max(1, vertexCount * pageSegmentMultiplier);
    const indexCapacity = Math.max(1, indexCount * pageSegmentMultiplier);
    const edgeIndexCapacity = edgeIndexCount > 0 ? Math.max(1, edgeIndexCount * pageSegmentMultiplier) : 0;
    const positionDecodeCapacity = pageSegmentMultiplier;
    const indexBytes = indexFormat === "uint32" ? 4 : 2;
    const positionDecodeLayoutResult = this._bindGroupLayoutManager.getTrianglePositionDecodeBindGroupLayout();
    if (positionDecodeLayoutResult.ok === false) {
      return positionDecodeLayoutResult;
    }
    try {
      const vertexBuffer = this._renderContext.createEmptyGPUBuffer(
        `xeokit-webgpu-packed-positions:triangles:${segmentLabel}`,
        vertexCapacity * 8,
        GPU_BUFFER_USAGE.VERTEX
      );
      const isPointPage = pageKey.includes(`primitive:${PointsPrimitive}`);
      const isLinePage = pageKey.includes(`primitive:${LinesPrimitive}`);
      const isTrianglePage = !isPointPage && !isLinePage;
      const pbrTrianglePage = isTrianglePage && getTriangleRenderClassFromBaseKey(pageKey) === "pbr";
      const colorBuffer = isPointPage || isLinePage || pbrTrianglePage
        ? this._renderContext.createEmptyGPUBuffer(
            `xeokit-webgpu-packed-colors:${isTrianglePage ? "triangles" : (isLinePage ? "lines" : "points")}:${segmentLabel}`,
            vertexCapacity * 4,
            GPU_BUFFER_USAGE.VERTEX
          )
        : null;
      const hasTextureUVs = pageKey.includes("|texture:");
      const uvBuffer = pbrTrianglePage && hasTextureUVs
        ? this._renderContext.createEmptyGPUBuffer(
            `xeokit-webgpu-packed-uvs:triangles:${segmentLabel}`,
            vertexCapacity * 8,
            GPU_BUFFER_USAGE.VERTEX
          )
        : null;
      const materialBuffer = pbrTrianglePage
        ? this._renderContext.createEmptyGPUBuffer(
            `xeokit-webgpu-packed-materials:triangles:${segmentLabel}`,
            vertexCapacity * TRIANGLE_MATERIAL_VERTEX_STRIDE_BYTES,
            GPU_BUFFER_USAGE.VERTEX
          )
        : null;
      const normalBuffer = pbrTrianglePage
        ? this._renderContext.createEmptyGPUBuffer(
            `xeokit-webgpu-packed-normals:triangles:${segmentLabel}`,
            vertexCapacity * 16,
            GPU_BUFFER_USAGE.VERTEX
          )
        : null;
      const lineOtherVertexBuffer = isLinePage
        ? this._renderContext.createEmptyGPUBuffer(
            `xeokit-webgpu-packed-line-other-positions:lines:${segmentLabel}`,
            vertexCapacity * 8,
            GPU_BUFFER_USAGE.VERTEX
          )
        : null;
      const vertexMetadataBuffer = this._renderContext.createEmptyGPUBuffer(
        `xeokit-webgpu-packed-vertex-metadata:triangles:${segmentLabel}`,
        vertexCapacity * 16,
        GPU_BUFFER_USAGE.VERTEX
      );
      const positionDecodeBuffer = this._renderContext.createEmptyGPUBuffer(
        `xeokit-webgpu-triangle-position-decodes:triangles:${segmentLabel}`,
        positionDecodeCapacity * TRIANGLE_POSITION_DECODE_UNIFORM_BYTES,
        GPU_BUFFER_USAGE.STORAGE
      );
      const pageFrameBinding = frameBinding ?? {
        positionBuffer: positionDecodeBuffer,
        positionDecodeBuffer,
        normalBuffer: positionDecodeBuffer,
        uvBuffer: positionDecodeBuffer
      };
      const positionDecodeBindGroup = this._renderContext.device.createBindGroup({
        label: `xeokit-webgpu-triangle-position-decode-bind-group:triangles:${segmentLabel}`,
        layout: positionDecodeLayoutResult.value,
        entries: [{
          binding: 0,
          resource: {
            buffer: positionDecodeBuffer
          }
        }, {
          binding: 12,
          resource: {
            buffer: pageFrameBinding.positionBuffer
          }
        }, {
          binding: 13,
          resource: {
            buffer: pageFrameBinding.positionDecodeBuffer
          }
        }, {
          binding: 14,
          resource: {
            buffer: pageFrameBinding.normalBuffer
          }
        }, {
          binding: 15,
          resource: {
            buffer: pageFrameBinding.uvBuffer
          }
        }]
      });
      const indexBuffer = this._renderContext.createEmptyGPUBuffer(
        `xeokit-webgpu-packed-indices:triangles:${segmentLabel}`,
        indexCapacity * indexBytes,
        GPU_BUFFER_USAGE.INDEX
      );
      const edgeIndexBuffer = edgeIndexCapacity > 0
        ? this._renderContext.createEmptyGPUBuffer(
            `xeokit-webgpu-packed-edge-indices:triangles:${segmentLabel}`,
            edgeIndexCapacity * indexBytes,
            GPU_BUFFER_USAGE.INDEX
          )
        : null;
      const page: TriangleBufferPage = {
        key: sanitizedPageKey,
        indexFormat,
        vertexCapacity,
        indexCapacity,
        edgeIndexCapacity,
        positionDecodeCapacity,
        usedVertices: 0,
        usedIndices: 0,
        usedEdgeIndices: 0,
        usedPositionDecodes: 0,
        refCount: 0,
        vertexBuffer,
        colorBuffer,
        uvBuffer,
        normalBuffer,
        materialBuffer,
        lineOtherVertexBuffer,
        vertexMetadataBuffer,
        positionDecodeBuffer,
        positionDecodeBindGroup,
        frameBinding: pageFrameBinding,
        indexBuffer,
        edgeIndexBuffer,
        destroy: () => {
          this._renderContext.destroyGPUBuffer(vertexBuffer);
          this._renderContext.destroyGPUBuffer(colorBuffer);
          this._renderContext.destroyGPUBuffer(uvBuffer);
          this._renderContext.destroyGPUBuffer(normalBuffer);
          this._renderContext.destroyGPUBuffer(materialBuffer);
          this._renderContext.destroyGPUBuffer(lineOtherVertexBuffer);
          this._renderContext.destroyGPUBuffer(vertexMetadataBuffer);
          this._renderContext.destroyGPUBuffer(positionDecodeBuffer);
          this._renderContext.destroyGPUBuffer(indexBuffer);
          this._renderContext.destroyGPUBuffer(edgeIndexBuffer);
        }
      };
      this._bufferPagesByKey.set(page.key, page);
      return {
        ok: true,
        value: page
      };
    } catch (e) {
      return {
        ok: false,
        type: SDKErrorType.InitializationFailed,
        error: `[TriangleBatchManager._createBufferPage] Failed to create triangle buffer page '${segmentLabel}': ${e instanceof Error ? e.message : String(e)}`
      };
    }
  }

  private _getBufferPageSegmentMultiplier(baseKey: string, memoryConfigs: MemoryConfigs): number {
    const {loadingMode, memoryPolicy} = parseSegmentBaseKey(baseKey);
    if (memoryPolicy === "compact") {
      return 1;
    }
    if (memoryPolicy === "stream" && memoryConfigs.compactStreamPages) {
      return 1;
    }
    if (loadingMode !== "sealed") {
      return TRIANGLE_BUFFER_PAGE_SEGMENT_MULTIPLIER;
    }
    if (memoryPolicy === "stream" && memoryConfigs.compactSealedStreamPages) {
      return 1;
    }
    return TRIANGLE_BUFFER_PAGE_SEGMENT_MULTIPLIER;
  }

  private _releaseBufferPage(page: TriangleBufferPage): void {
    page.refCount--;
    if (page.refCount > 0) {
      return;
    }
    page.destroy();
    this._bufferPagesByKey.delete(page.key);
    for (const [key, currentPage] of Array.from(this._currentBufferPageByKey)) {
      if (currentPage === page) {
        this._currentBufferPageByKey.delete(key);
      }
    }
  }

  private _getSegmentBaseKey(meshState: RendererMesh): string {
    const model = meshState.sceneModel ?? meshState.mesh.model;
    const memoryConfigs = this._getModelMemoryConfigs(meshState);
    const memoryPolicy = this._renderContext.getMemoryPolicyForModel(model);
    const loadingMode = this._getSegmentBaseLoadingMode(model?.sealed ? "sealed" : (model?.loadingMode ?? "open"), memoryPolicy, memoryConfigs);
    const lodVariantMembershipKey = meshState.lodVariantMembershipKey ? `|lodVariant:${meshState.lodVariantMembershipKey}` : "";
    const baseKey = `${model?.id ?? "unowned"}|${loadingMode}|${memoryPolicy}${lodVariantMembershipKey}`;
    const primitive = meshState.geometryState.geometry.primitive;
    const frameKey = meshState.geometryState.frameStorage
      ? `|frames:${meshState.geometryState.geometry.uniqueId}`
      : "";
    if (primitive === PointsPrimitive || primitive === LinesPrimitive) {
      return `${baseKey}${frameKey}|primitive:${primitive}`;
    }
    const hasNormals = !!meshState.geometryState.normals;
    const textureKey = getPBRTextureTupleKey(this._textureBindGroupManager, meshState.mesh);
    const triangleRenderClass = getTriangleRenderClass(this._renderContext.renderConfigs.triangleColorMode, meshState);
    if (triangleRenderClass === "flat") {
      return `${baseKey}${frameKey}|color:flat|hasNormals:${hasNormals ? 1 : 0}`;
    }
    const triangleBaseKey = `${baseKey}${frameKey}|hasNormals:${hasNormals ? 1 : 0}`;
    return textureKey === DEFAULT_TEXTURE_KEY ? triangleBaseKey : `${triangleBaseKey}|texture:${textureKey}`;
  }

  private _getSegmentBaseLoadingMode(loadingMode: string, memoryPolicy: string, memoryConfigs: MemoryConfigs): string {
    if (
      memoryPolicy === "stream" &&
      !memoryConfigs.compactSealedStreamPages &&
      (loadingMode === "open" || loadingMode === "streaming" || loadingMode === "sealed")
    ) {
      return "streaming";
    }
    return loadingMode;
  }

  private _getModelMemoryConfigs(meshState?: RendererMesh): MemoryConfigs {
    const model = meshState?.sceneModel ?? meshState?.mesh.model ?? null;
    return this._renderContext.getMemoryConfigsForModel(model);
  }

  private _nextSegmentKey(baseKey: string): string {
    const pageIndex = this._pageCountersByBaseKey.get(baseKey) ?? 0;
    this._pageCountersByBaseKey.set(baseKey, pageIndex + 1);
    return `${baseKey}|page:${pageIndex}`;
  }

  private _getSegmentSignature(meshStates: RendererMesh[]): string {
    const parts: string[] = [];
    for (let i = 0, len = meshStates.length; i < len; i++) {
      parts.push(this._getMeshSignature(meshStates[i]));
    }
    return parts.join("|");
  }

  private _getMeshSignature(meshState: RendererMesh): string {
    const emissiveColor = getEffectiveEmissiveColor(meshState.mesh);
    return `${meshState.mesh.uniqueId}:${meshState.geometryState.geometry.uniqueId}:${meshState.geometryState.geometry.primitive}:${meshState.geometryState.positions.length}:${meshState.geometryState.indices?.length ?? 0}:${meshState.geometryState.uvs?.length ?? 0}:${getEffectiveRoughness(meshState.mesh)}:${getEffectiveMetallic(meshState.mesh)}:${emissiveColor[0]},${emissiveColor[1]},${emissiveColor[2]}:${getEffectiveAlphaMode(meshState.mesh)}:${getEffectiveAlphaCutoff(meshState.mesh)}:${getPBRTextureTupleKey(this._textureBindGroupManager, meshState.mesh)}`;
  }

  private _getBoundsVersion(slots: WebGPUTriangleMeshSlot[]): string {
    const parts: string[] = [];
    for (let i = 0, len = slots.length; i < len; i++) {
      const meshState = slots[i].meshState;
      parts.push(`${meshState.mesh.uniqueId}:${meshState.instanceDataVersion}`);
    }
    return parts.join("|");
  }

  private _destroySegment(segment: TriangleBatchSegment): void {
    try {
      segment.destroy();
    } catch {
      // Ignore buffer destruction failures during teardown.
    }
    for (let i = 0, len = segment.slots.length; i < len; i++) {
      this._segmentByMeshId.delete(segment.slots[i].meshState.mesh.uniqueId);
    }
    for (const [key, batch] of Array.from(this._partialDrawBatchCache)) {
      if (batch.packedBatch.segmentKey === segment.key) {
        batch.packedBatch.destroy();
        this._partialDrawBatchCache.delete(key);
      }
    }
    this._freeSlots(segment.baseSlot, segment.slotCount);
    this._batchSet = null;
  }

  private _getFrameBinding(geometryState: RendererGeometry | undefined): TriangleFrameBinding | null {
    const frameStorage = geometryState?.frameStorage;
    if (!frameStorage) {
      return null;
    }
    return {
      positionBuffer: frameStorage.positionBuffer,
      positionDecodeBuffer: frameStorage.positionDecodeBuffer,
      normalBuffer: frameStorage.normalBuffer ?? frameStorage.positionBuffer,
      uvBuffer: frameStorage.uvBuffer ?? frameStorage.positionBuffer
    };
  }

  private _identityTextureTransformBuffer(): WebGPUBufferLike {
    if (!this._identityTextureTransformBufferValue) {
      this._identityTextureTransformBufferValue = this._renderContext.createGPUBuffer(
        "xeokit-webgpu-texture-transforms:identity",
        createTextureTransformData(undefined),
        GPU_BUFFER_USAGE.UNIFORM
      );
    }
    return this._identityTextureTransformBufferValue;
  }

  private _allocateSlots(count: number): number {
    for (let i = 0, len = this._freeSlotRanges.length; i < len; i++) {
      const range = this._freeSlotRanges[i];
      if (range.count < count) {
        continue;
      }
      const base = range.base;
      range.base += count;
      range.count -= count;
      if (range.count === 0) {
        this._freeSlotRanges.splice(i, 1);
      }
      return base;
    }

    const base = this._nextSlot;
    this._nextSlot += count;
    return base;
  }

  private _freeSlots(base: number, count: number): void {
    if (count === 0) {
      return;
    }
    this._freeSlotRanges.push({base, count});
    this._freeSlotRanges.sort((a, b) => a.base - b.base);

    for (let i = 0; i < this._freeSlotRanges.length - 1;) {
      const current = this._freeSlotRanges[i];
      const next = this._freeSlotRanges[i + 1];
      if (current.base + current.count === next.base) {
        current.count += next.count;
        this._freeSlotRanges.splice(i + 1, 1);
        continue;
      }
      i++;
    }

    const last = this._freeSlotRanges[this._freeSlotRanges.length - 1];
    if (last && last.base + last.count === this._nextSlot) {
      this._nextSlot = last.base;
      this._freeSlotRanges.pop();
    }
  }

  private _getInstanceCapacity(segments: TriangleBatchSegment[]): number {
    let instanceCapacity = 0;
    for (let i = 0, len = segments.length; i < len; i++) {
      instanceCapacity = Math.max(instanceCapacity, segments[i].slotEnd);
    }
    return instanceCapacity;
  }

  private _recordBuildSample(sample: TriangleSegmentBuildSample): void {
    this._totalSegmentsBuilt++;
    this._totalBuildMs += sample.totalMs;
    this._totalPackMs += sample.packMs;
    this._totalUploadMs += sample.uploadMs;
    this._totalMeshCount += sample.meshCount;
    this._totalVertexCount += sample.vertexCount;
    this._totalIndexCount += sample.indexCount;
    this._totalEdgeIndexCount += sample.edgeIndexCount;

    this._recentBuildSamples.push({...sample});
    while (this._recentBuildSamples.length > MAX_SEGMENT_BUILD_SAMPLES) {
      this._recentBuildSamples.shift();
    }

    this._slowestBuildSamples.push({...sample});
    this._slowestBuildSamples.sort((a, b) => b.totalMs - a.totalMs);
    if (this._slowestBuildSamples.length > MAX_SEGMENT_BUILD_SAMPLES) {
      this._slowestBuildSamples.length = MAX_SEGMENT_BUILD_SAMPLES;
    }
  }

  private _createBuildTelemetrySnapshot(): TriangleSegmentBuildTelemetry {
    return {
      totalSegmentsBuilt: this._totalSegmentsBuilt,
      totalBuildMs: this._totalBuildMs,
      totalPackMs: this._totalPackMs,
      totalUploadMs: this._totalUploadMs,
      totalMeshCount: this._totalMeshCount,
      totalVertexCount: this._totalVertexCount,
      totalIndexCount: this._totalIndexCount,
      totalEdgeIndexCount: this._totalEdgeIndexCount,
      lastBuildSegments: this._lastBuildSegments,
      lastBuildMs: this._lastBuildMs,
      lastBuildPackMs: this._lastBuildPackMs,
      lastBuildUploadMs: this._lastBuildUploadMs,
      lastBuildPendingBefore: this._lastBuildPendingBefore,
      lastBuildPendingAfter: this._lastBuildPendingAfter,
      recentSamples: this._recentBuildSamples.map((sample) => ({...sample})),
      slowestSamples: this._slowestBuildSamples.map((sample) => ({...sample}))
    };
  }

  private _sanitizeLabel(value: string): string {
    return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
  }

  private _sanitizeSegmentLabel(value: string): string {
    return this._sanitizeLabel(value.replace(/\|hasNormals:[01]/g, ""));
  }
}

function createEmptyAABB(): Float64Array {
  return new Float64Array([
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ]);
}

function resetAABB(aabb: Float64Array): void {
  aabb[0] = Number.POSITIVE_INFINITY;
  aabb[1] = Number.POSITIVE_INFINITY;
  aabb[2] = Number.POSITIVE_INFINITY;
  aabb[3] = Number.NEGATIVE_INFINITY;
  aabb[4] = Number.NEGATIVE_INFINITY;
  aabb[5] = Number.NEGATIVE_INFINITY;
}

function expandWorldAABB(worldAABB: Float64Array, localAABB: ArrayLike<number> | undefined, worldMatrix: ArrayLike<number>): void {
  if (!localAABB) {
    return;
  }
  for (let xIndex = 0; xIndex < 2; xIndex++) {
    const x = localAABB[xIndex === 0 ? 0 : 3];
    for (let yIndex = 0; yIndex < 2; yIndex++) {
      const y = localAABB[yIndex === 0 ? 1 : 4];
      for (let zIndex = 0; zIndex < 2; zIndex++) {
        const z = localAABB[zIndex === 0 ? 2 : 5];
        const worldX = worldMatrix[0] * x + worldMatrix[4] * y + worldMatrix[8] * z + worldMatrix[12];
        const worldY = worldMatrix[1] * x + worldMatrix[5] * y + worldMatrix[9] * z + worldMatrix[13];
        const worldZ = worldMatrix[2] * x + worldMatrix[6] * y + worldMatrix[10] * z + worldMatrix[14];
        worldAABB[0] = Math.min(worldAABB[0], worldX);
        worldAABB[1] = Math.min(worldAABB[1], worldY);
        worldAABB[2] = Math.min(worldAABB[2], worldZ);
        worldAABB[3] = Math.max(worldAABB[3], worldX);
        worldAABB[4] = Math.max(worldAABB[4], worldY);
        worldAABB[5] = Math.max(worldAABB[5], worldZ);
      }
    }
  }
}

function getMeshWorldMatrix(meshState: RendererMesh): ArrayLike<number> {
  return meshState.mesh.worldMatrix ?? meshState.mesh.matrix ?? IDENTITY_MATRIX;
}

function getTriangleRenderClass(mode: "auto" | "pbr" | "flat", meshState: RendererMesh): TriangleRenderClass {
  if (mode === "flat" || mode === "pbr") {
    return mode;
  }
  return meshNeedsPBRTriangleColor(meshState) ? "pbr" : "flat";
}

function getTriangleRenderClassFromBaseKey(baseKey: string): TriangleRenderClass {
  return baseKey.includes("|color:flat") ? "flat" : "pbr";
}

function meshNeedsPBRTriangleColor(meshState: RendererMesh): boolean {
  const mesh = meshState.mesh;
  const geometry = meshState.geometryState.geometry;
  const emissive = getEffectiveEmissiveColor(mesh);
  return (
    meshHasAnyPBRTexture(mesh) ||
    !!geometry.colorsCompressed ||
    getEffectiveRoughness(mesh) !== 1.0 ||
    getEffectiveMetallic(mesh) !== 0.0 ||
    emissive[0] !== 0 ||
    emissive[1] !== 0 ||
    emissive[2] !== 0 ||
    getEffectiveClearcoat(mesh) !== 0.0 ||
    getEffectiveClearcoatRoughness(mesh) !== 0.0 ||
    getEffectiveSheen(mesh) !== 0.0 ||
    getEffectiveSheenRoughness(mesh) !== 0.5 ||
    getEffectiveTransmission(mesh) > 0.0 ||
    getEffectiveAlphaMode(mesh) !== 0
  );
}

function cloneCachedDrawBatch(batch: InstancedDrawBatch, createdThisFrame: boolean): InstancedDrawBatch {
  const packedBatch = batch.packedBatch;
  return {
    packedBatch: {
      primitive: packedBatch.primitive,
      hasNormals: packedBatch.hasNormals,
      triangleRenderClass: packedBatch.triangleRenderClass,
      label: packedBatch.label,
      segmentKey: packedBatch.segmentKey,
      bufferPageKey: packedBatch.bufferPageKey,
      renderStateKey: packedBatch.renderStateKey,
      topology: packedBatch.topology,
      vertexBuffer: packedBatch.vertexBuffer,
      vertexBufferOffset: packedBatch.vertexBufferOffset,
      colorBuffer: packedBatch.colorBuffer,
      colorBufferOffset: packedBatch.colorBufferOffset,
      uvBuffer: packedBatch.uvBuffer,
      uvBufferOffset: packedBatch.uvBufferOffset,
      normalBuffer: packedBatch.normalBuffer,
      normalBufferOffset: packedBatch.normalBufferOffset,
      materialBuffer: packedBatch.materialBuffer,
      materialBufferOffset: packedBatch.materialBufferOffset,
      lineOtherVertexBuffer: packedBatch.lineOtherVertexBuffer,
      lineOtherVertexBufferOffset: packedBatch.lineOtherVertexBufferOffset,
      positionDecodeBindGroup: packedBatch.positionDecodeBindGroup,
      colorBindGroup: packedBatch.colorBindGroup,
      maskedShadowColorBindGroup: packedBatch.maskedShadowColorBindGroup,
      vertexMetadataBuffer: packedBatch.vertexMetadataBuffer,
      vertexMetadataBufferOffset: packedBatch.vertexMetadataBufferOffset,
      indexBuffer: packedBatch.indexBuffer,
      indexBufferOffset: packedBatch.indexBufferOffset,
      indexFormat: packedBatch.indexFormat,
      indexCount: packedBatch.indexCount,
      firstIndex: packedBatch.firstIndex,
      indicesPageLocal: packedBatch.indicesPageLocal,
      temporaryIndexBuffer: true,
      temporaryIndexBufferCreated: createdThisFrame,
      textureKey: packedBatch.textureKey,
      skipDepthPrepass: packedBatch.skipDepthPrepass,
      destroy: () => {
        // Cached partial batches are owned and destroyed by TriangleBatchManager.
      }
    }
  };
}

function getIndexElementByteLength(indexFormat: "uint16" | "uint32"): number {
  return indexFormat === "uint32" ? Uint32Array.BYTES_PER_ELEMENT : Uint16Array.BYTES_PER_ELEMENT;
}

function parseSegmentBaseKey(baseKey: string): {loadingMode: string; memoryPolicy: string} {
  const parts = baseKey.split("|");
  return {
    loadingMode: parts[1] || "open",
    memoryPolicy: parts[2] || "stream"
  };
}

function createPackedPositionAABB(meshStates: RendererMesh[]): Float32Array {
  const aabb = new Float32Array([
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ]);
  for (let meshIndex = 0, meshLen = meshStates.length; meshIndex < meshLen; meshIndex++) {
    const geometryState = meshStates[meshIndex].geometryState;
    const geometry = geometryState.geometry;
    const sourceAABB = geometryState.renderAABB;
    if (geometry.model?.updateMode === "dynamic") {
      expandAABB(aabb, sourceAABB);
      continue;
    }
    const positions = geometry.positionsCompressed!;
    const minX = sourceAABB[0];
    const minY = sourceAABB[1];
    const minZ = sourceAABB[2];
    const scaleX = (sourceAABB[3] - minX) / 65535;
    const scaleY = (sourceAABB[4] - minY) / 65535;
    const scaleZ = (sourceAABB[5] - minZ) / 65535;
    for (let i = 0, len = positions.length; i < len; i += 3) {
      const x = minX + positions[i] * scaleX;
      const y = minY + positions[i + 1] * scaleY;
      const z = minZ + positions[i + 2] * scaleZ;
      if (x < aabb[0]) {
        aabb[0] = x;
      }
      if (y < aabb[1]) {
        aabb[1] = y;
      }
      if (z < aabb[2]) {
        aabb[2] = z;
      }
      if (x > aabb[3]) {
        aabb[3] = x;
      }
      if (y > aabb[4]) {
        aabb[4] = y;
      }
      if (z > aabb[5]) {
        aabb[5] = z;
      }
    }
  }
  if (aabb[0] === Number.POSITIVE_INFINITY) {
    aabb.set([0, 0, 0, 0, 0, 0]);
  }
  return aabb;
}

function wouldExceedPackedPositionDecodeExtent(
  currentAABB: ArrayLike<number>,
  meshState: RendererMesh,
  maxExtent: number
): boolean {
  const meshAABB = meshState.geometryState.renderAABB;
  if (!meshAABB) {
    return false;
  }
  const minX = Math.min(currentAABB[0], meshAABB[0]);
  const minY = Math.min(currentAABB[1], meshAABB[1]);
  const minZ = Math.min(currentAABB[2], meshAABB[2]);
  const maxX = Math.max(currentAABB[3], meshAABB[3]);
  const maxY = Math.max(currentAABB[4], meshAABB[4]);
  const maxZ = Math.max(currentAABB[5], meshAABB[5]);
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ) > maxExtent;
}

function expandAABB(target: Float32Array | Float64Array, source: ArrayLike<number> | null | undefined): void {
  if (!source) {
    return;
  }
  if (source[0] < target[0]) {
    target[0] = source[0];
  }
  if (source[1] < target[1]) {
    target[1] = source[1];
  }
  if (source[2] < target[2]) {
    target[2] = source[2];
  }
  if (source[3] > target[3]) {
    target[3] = source[3];
  }
  if (source[4] > target[4]) {
    target[4] = source[4];
  }
  if (source[5] > target[5]) {
    target[5] = source[5];
  }
}

function createPositionDecodeUniform(aabb: Float32Array): Float32Array {
  const uniform = new Float32Array(TRIANGLE_POSITION_DECODE_UNIFORM_FLOATS);
  uniform[0] = aabb[0];
  uniform[1] = aabb[1];
  uniform[2] = aabb[2];
  uniform[4] = aabb[3] - aabb[0];
  uniform[5] = aabb[4] - aabb[1];
  uniform[6] = aabb[5] - aabb[2];
  return uniform;
}

function quantizeCompressedPositionsInto(
  source: ArrayLike<number>,
  sourceAABB: ArrayLike<number>,
  target: Uint16Array,
  vertexOffset: number,
  targetAABB: Float32Array
): void {
  const targetMinX = targetAABB[0];
  const targetMinY = targetAABB[1];
  const targetMinZ = targetAABB[2];
  const targetExtentX = targetAABB[3] - targetMinX;
  const targetExtentY = targetAABB[4] - targetMinY;
  const targetExtentZ = targetAABB[5] - targetMinZ;
  const targetScaleX = targetExtentX > 0 ? 65535 / targetExtentX : 0;
  const targetScaleY = targetExtentY > 0 ? 65535 / targetExtentY : 0;
  const targetScaleZ = targetExtentZ > 0 ? 65535 / targetExtentZ : 0;
  const sourceMinX = sourceAABB[0];
  const sourceMinY = sourceAABB[1];
  const sourceMinZ = sourceAABB[2];
  const sourceScaleX = (sourceAABB[3] - sourceMinX) / 65535;
  const sourceScaleY = (sourceAABB[4] - sourceMinY) / 65535;
  const sourceScaleZ = (sourceAABB[5] - sourceMinZ) / 65535;
  let dst = vertexOffset * 4;
  for (let src = 0, len = source.length; src < len; src += 3) {
    target[dst++] = quantizeUnorm16(((sourceMinX + source[src] * sourceScaleX) - targetMinX) * targetScaleX);
    target[dst++] = quantizeUnorm16(((sourceMinY + source[src + 1] * sourceScaleY) - targetMinY) * targetScaleY);
    target[dst++] = quantizeUnorm16(((sourceMinZ + source[src + 2] * sourceScaleZ) - targetMinZ) * targetScaleZ);
    target[dst++] = 0;
  }
}

function copyUVsInto(
  source: ArrayLike<number> | null,
  target: Float32Array | null,
  vertexOffset: number,
  vertexCount: number
): void {
  if (!target) {
    return;
  }
  const targetOffset = vertexOffset * 2;
  if (!source) {
    target.fill(0, targetOffset, targetOffset + vertexCount * 2);
    return;
  }
  for (let i = 0, len = vertexCount * 2; i < len; i++) {
    target[targetOffset + i] = source[i] ?? 0;
  }
}

function copyNormalsInto(
  source: Float32Array | null,
  target: Float32Array,
  vertexOffset: number,
  vertexCount: number
): void {
  const targetOffset = vertexOffset * 4;
  if (!source) {
    target.fill(0, targetOffset, targetOffset + vertexCount * 4);
    return;
  }
  for (let i = 0; i < vertexCount; i++) {
    const sourceOffset = i * 3;
    const targetIndex = targetOffset + i * 4;
    target[targetIndex] = source[sourceOffset] ?? 0;
    target[targetIndex + 1] = source[sourceOffset + 1] ?? 0;
    target[targetIndex + 2] = source[sourceOffset + 2] ?? 1;
    target[targetIndex + 3] = 1;
  }
}

function copyCompressedTriangleColorsInto(
  source: ArrayLike<number> | undefined,
  target: Uint8Array,
  vertexOffset: number,
  vertexCount: number
): void {
  const targetOffset = vertexOffset * 4;
  if (!source) {
    target.fill(255, targetOffset, targetOffset + vertexCount * 4);
    return;
  }
  for (let i = 0; i < vertexCount; i++) {
    const sourceOffset = i * 4;
    const targetIndex = targetOffset + sourceOffset;
    target[targetIndex] = source[sourceOffset] ?? 255;
    target[targetIndex + 1] = source[sourceOffset + 1] ?? 255;
    target[targetIndex + 2] = source[sourceOffset + 2] ?? 255;
    target[targetIndex + 3] = source[sourceOffset + 3] ?? 255;
  }
}

function copyMaterialInto(
  sceneMesh: SceneMesh,
  target: Float32Array,
  vertexOffset: number,
  vertexCount: number,
  hasUVs: boolean
): void {
  const emissive = getEffectiveEmissiveColor(sceneMesh);
  const alphaMode = getEffectiveAlphaMode(sceneMesh);
  const textureMode = hasUVs && meshHasAnyPBRTexture(sceneMesh)
    ? -1
    : (!hasUVs && meshHasAnyPBRTexture(sceneMesh) ? getEffectiveTriplanarScale(sceneMesh) : 0);
  for (let i = 0; i < vertexCount; i++) {
    const offset = (vertexOffset + i) * TRIANGLE_MATERIAL_FLOATS_PER_VERTEX;
    target[offset] = getEffectiveRoughness(sceneMesh);
    target[offset + 1] = getEffectiveMetallic(sceneMesh);
    target[offset + 2] = emissive[0];
    target[offset + 3] = emissive[1];
    target[offset + 4] = emissive[2];
    target[offset + 5] = alphaMode;
    target[offset + 6] = getEffectiveAlphaCutoff(sceneMesh);
    target[offset + 7] = textureMode;
    target[offset + 8] = getEffectiveClearcoat(sceneMesh);
    target[offset + 9] = getEffectiveClearcoatRoughness(sceneMesh);
    target[offset + 10] = getEffectiveSheen(sceneMesh);
    target[offset + 11] = getEffectiveSheenRoughness(sceneMesh);
    target[offset + 12] = getEffectiveTransmission(sceneMesh);
    target[offset + 13] = getEffectiveThickness(sceneMesh);
    target[offset + 14] = getEffectiveAttenuationDistance(sceneMesh);
    target[offset + 15] = getEffectiveIor(sceneMesh);
    const attenuationColor = getEffectiveAttenuationColor(sceneMesh);
    target[offset + 16] = attenuationColor[0];
    target[offset + 17] = attenuationColor[1];
    target[offset + 18] = attenuationColor[2];
    target[offset + 19] = 0;
  }
}

function getEffectiveRoughness(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveRoughness) ? sceneMesh.effectiveRoughness : 1.0;
}

function getEffectiveMetallic(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveMetallic) ? sceneMesh.effectiveMetallic : 0.0;
}

function getEffectiveIor(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveIor) ? Math.max(1.0, sceneMesh.effectiveIor) : 1.5;
}

function getEffectiveClearcoat(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveClearcoat) ? sceneMesh.effectiveClearcoat : 0.0;
}

function getEffectiveClearcoatRoughness(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveClearcoatRoughness) ? sceneMesh.effectiveClearcoatRoughness : 0.0;
}

function getEffectiveSheen(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveSheen) ? sceneMesh.effectiveSheen : 0.0;
}

function getEffectiveSheenRoughness(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveSheenRoughness) ? sceneMesh.effectiveSheenRoughness : 0.5;
}

function getEffectiveTransmission(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveTransmission) ? Math.max(0, Math.min(1, sceneMesh.effectiveTransmission)) : 0.0;
}

function getEffectiveThickness(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveThickness) ? Math.max(0, sceneMesh.effectiveThickness) : 0.0;
}

function getEffectiveAttenuationDistance(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveAttenuationDistance) && sceneMesh.effectiveAttenuationDistance > 0
    ? sceneMesh.effectiveAttenuationDistance
    : 0.0;
}

function getEffectiveAttenuationColor(sceneMesh: SceneMesh): ArrayLike<number> {
  const attenuationColor = sceneMesh.effectiveAttenuationColor;
  return attenuationColor && attenuationColor.length >= 3 ? attenuationColor : [1, 1, 1];
}

function getEffectiveEmissiveColor(sceneMesh: SceneMesh): ArrayLike<number> {
  const emissiveColor = sceneMesh.effectiveEmissiveColor;
  return emissiveColor && emissiveColor.length >= 3 ? emissiveColor : [0, 0, 0];
}

function getEffectiveAlphaMode(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveAlphaMode) ? sceneMesh.effectiveAlphaMode : 0;
}

function getEffectiveAlphaCutoff(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveAlphaCutoff) ? sceneMesh.effectiveAlphaCutoff : 0.5;
}

function materialNeedsColorPassDepth(sceneMesh: SceneMesh): boolean {
  return getEffectiveTransmission(sceneMesh) > 0.0 || sceneMesh.opacity < 1.0;
}

function getEffectiveTriplanarScale(sceneMesh: SceneMesh): number {
  return Number.isFinite(sceneMesh.effectiveTriplanarScale) && sceneMesh.effectiveTriplanarScale > 1e-4
    ? sceneMesh.effectiveTriplanarScale
    : 1.0;
}

function meshHasAnyPBRTexture(sceneMesh: SceneMesh): boolean {
  return !!(
    sceneMesh.effectiveColorTexture ||
    sceneMesh.effectiveMetallicRoughnessTexture ||
    sceneMesh.effectiveNormalsTexture ||
    sceneMesh.effectiveEmissiveTexture ||
    sceneMesh.effectiveOcclusionTexture
  );
}

function createTextureTransformData(sceneMesh: SceneMesh | undefined): Float32Array {
  const data = new Float32Array(TEXTURE_TRANSFORM_FLOATS);
  const material = sceneMesh?.material;
  writeTextureTransform(data, 0, material?.colorTextureUVTransform, material?.colorTextureTexCoord);
  writeTextureTransform(data, 8, material?.metallicRoughnessTextureUVTransform, material?.metallicRoughnessTextureTexCoord);
  writeTextureTransform(data, 16, material?.normalsTextureUVTransform, material?.normalsTextureTexCoord);
  writeTextureTransform(data, 24, material?.emissiveTextureUVTransform, material?.emissiveTextureTexCoord);
  writeTextureTransform(data, 32, material?.occlusionTextureUVTransform, material?.occlusionTextureTexCoord);
  return data;
}

function writeTextureTransform(target: Float32Array, offset: number, transform: SceneTextureUVTransform | undefined, texCoord: number | undefined): void {
  const uvTransform = transform ?? IDENTITY_UV_TRANSFORM;
  target[offset] = uvTransform[0];
  target[offset + 1] = uvTransform[2];
  target[offset + 2] = uvTransform[4];
  target[offset + 3] = texCoord ?? 0;
  target[offset + 4] = uvTransform[1];
  target[offset + 5] = uvTransform[3];
  target[offset + 6] = uvTransform[5];
  target[offset + 7] = 0;
}

function meshUsesTexture(sceneMesh: SceneMesh, sceneTexture: SceneTexture): boolean {
  return sceneMesh.effectiveColorTexture === sceneTexture
    || sceneMesh.effectiveMetallicRoughnessTexture === sceneTexture
    || sceneMesh.effectiveNormalsTexture === sceneTexture
    || sceneMesh.effectiveEmissiveTexture === sceneTexture
    || sceneMesh.effectiveOcclusionTexture === sceneTexture;
}

function getPBRTextureTupleKey(textureManager: TextureBindGroupManager, sceneMesh: SceneMesh | undefined): string {
  if (!sceneMesh) {
    return DEFAULT_TEXTURE_KEY;
  }
  const albedo = textureManager.getTextureKey(sceneMesh.effectiveColorTexture, "color");
  const metallicRoughness = textureManager.getTextureKey(sceneMesh.effectiveMetallicRoughnessTexture, "metallicRoughness");
  const normal = sceneMesh.effectiveNormalsTexture
    ? textureManager.getTextureKey(sceneMesh.effectiveNormalsTexture, "normal")
    : textureManager.getDefaultTextureKey("normal");
  const emissive = textureManager.getTextureKey(sceneMesh.effectiveEmissiveTexture, "emissive");
  const occlusion = textureManager.getTextureKey(sceneMesh.effectiveOcclusionTexture, "occlusion");
  if (
    albedo === DEFAULT_TEXTURE_KEY &&
    metallicRoughness === DEFAULT_TEXTURE_KEY &&
    normal === textureManager.getDefaultTextureKey("normal") &&
    emissive === DEFAULT_TEXTURE_KEY &&
    occlusion === DEFAULT_TEXTURE_KEY
  ) {
    return DEFAULT_TEXTURE_KEY;
  }
  return `${albedo}|${metallicRoughness}|${normal}|${emissive}|${occlusion}|${getTextureBindingStateKey(sceneMesh)}`;
}

function getTextureBindingStateKey(sceneMesh: SceneMesh): string {
  const material = sceneMesh.material;
  if (!material) {
    return "bindings:none";
  }
  return [
    bindingStateKey(material.colorTextureTexCoord, material.colorTextureUVTransform),
    bindingStateKey(material.metallicRoughnessTextureTexCoord, material.metallicRoughnessTextureUVTransform),
    bindingStateKey(material.normalsTextureTexCoord, material.normalsTextureUVTransform),
    bindingStateKey(material.emissiveTextureTexCoord, material.emissiveTextureUVTransform),
    bindingStateKey(material.occlusionTextureTexCoord, material.occlusionTextureUVTransform)
  ].join("|");
}

function bindingStateKey(texCoord: number, transform: ArrayLike<number>): string {
  return `${texCoord}:${transform[0]},${transform[1]},${transform[2]},${transform[3]},${transform[4]},${transform[5]}`;
}

function quantizeCompressedPointQuadsInto(
  source: ArrayLike<number>,
  sourceAABB: ArrayLike<number>,
  target: Uint16Array,
  vertexOffset: number,
  targetAABB: Float32Array
): void {
  const targetMinX = targetAABB[0];
  const targetMinY = targetAABB[1];
  const targetMinZ = targetAABB[2];
  const targetExtentX = targetAABB[3] - targetMinX;
  const targetExtentY = targetAABB[4] - targetMinY;
  const targetExtentZ = targetAABB[5] - targetMinZ;
  const targetScaleX = targetExtentX > 0 ? 65535 / targetExtentX : 0;
  const targetScaleY = targetExtentY > 0 ? 65535 / targetExtentY : 0;
  const targetScaleZ = targetExtentZ > 0 ? 65535 / targetExtentZ : 0;
  const sourceMinX = sourceAABB[0];
  const sourceMinY = sourceAABB[1];
  const sourceMinZ = sourceAABB[2];
  const sourceScaleX = (sourceAABB[3] - sourceMinX) / 65535;
  const sourceScaleY = (sourceAABB[4] - sourceMinY) / 65535;
  const sourceScaleZ = (sourceAABB[5] - sourceMinZ) / 65535;
  let dst = vertexOffset * 4;
  for (let src = 0, len = source.length; src < len; src += 3) {
    const x = quantizeUnorm16(((sourceMinX + source[src] * sourceScaleX) - targetMinX) * targetScaleX);
    const y = quantizeUnorm16(((sourceMinY + source[src + 1] * sourceScaleY) - targetMinY) * targetScaleY);
    const z = quantizeUnorm16(((sourceMinZ + source[src + 2] * sourceScaleZ) - targetMinZ) * targetScaleZ);
    for (let corner = 0; corner < 6; corner++) {
      target[dst++] = x;
      target[dst++] = y;
      target[dst++] = z;
      target[dst++] = 0;
    }
  }
}

function quantizeCompressedLineSegmentQuadsInto(
  source: ArrayLike<number>,
  sourceAABB: ArrayLike<number>,
  sourceIndices: ArrayLike<number>,
  targetPositions: Uint16Array,
  targetOtherPositions: Uint16Array,
  vertexOffset: number,
  targetAABB: Float32Array
): void {
  const targetMinX = targetAABB[0];
  const targetMinY = targetAABB[1];
  const targetMinZ = targetAABB[2];
  const targetExtentX = targetAABB[3] - targetMinX;
  const targetExtentY = targetAABB[4] - targetMinY;
  const targetExtentZ = targetAABB[5] - targetMinZ;
  const targetScaleX = targetExtentX > 0 ? 65535 / targetExtentX : 0;
  const targetScaleY = targetExtentY > 0 ? 65535 / targetExtentY : 0;
  const targetScaleZ = targetExtentZ > 0 ? 65535 / targetExtentZ : 0;
  const sourceMinX = sourceAABB[0];
  const sourceMinY = sourceAABB[1];
  const sourceMinZ = sourceAABB[2];
  const sourceScaleX = (sourceAABB[3] - sourceMinX) / 65535;
  const sourceScaleY = (sourceAABB[4] - sourceMinY) / 65535;
  const sourceScaleZ = (sourceAABB[5] - sourceMinZ) / 65535;
  let dst = vertexOffset * 4;
  for (let segmentIndex = 0, len = sourceIndices.length; segmentIndex + 1 < len; segmentIndex += 2) {
    const indexA = sourceIndices[segmentIndex] * 3;
    const indexB = sourceIndices[segmentIndex + 1] * 3;
    const ax = quantizeUnorm16(((sourceMinX + source[indexA] * sourceScaleX) - targetMinX) * targetScaleX);
    const ay = quantizeUnorm16(((sourceMinY + source[indexA + 1] * sourceScaleY) - targetMinY) * targetScaleY);
    const az = quantizeUnorm16(((sourceMinZ + source[indexA + 2] * sourceScaleZ) - targetMinZ) * targetScaleZ);
    const bx = quantizeUnorm16(((sourceMinX + source[indexB] * sourceScaleX) - targetMinX) * targetScaleX);
    const by = quantizeUnorm16(((sourceMinY + source[indexB + 1] * sourceScaleY) - targetMinY) * targetScaleY);
    const bz = quantizeUnorm16(((sourceMinZ + source[indexB + 2] * sourceScaleZ) - targetMinZ) * targetScaleZ);
    for (let corner = 0; corner < 6; corner++) {
      const currentIsA = corner === 0 || corner === 3 || corner === 5;
      targetPositions[dst] = currentIsA ? ax : bx;
      targetPositions[dst + 1] = currentIsA ? ay : by;
      targetPositions[dst + 2] = currentIsA ? az : bz;
      targetPositions[dst + 3] = 0;
      targetOtherPositions[dst] = currentIsA ? bx : ax;
      targetOtherPositions[dst + 1] = currentIsA ? by : ay;
      targetOtherPositions[dst + 2] = currentIsA ? bz : az;
      targetOtherPositions[dst + 3] = 0;
      dst += 4;
    }
  }
}

function copyCompressedPointQuadColorsInto(
  source: ArrayLike<number> | undefined,
  target: Uint8Array,
  vertexOffset: number,
  pointCount: number
): void {
  let dst = vertexOffset * 4;
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
    const src = pointIndex * 4;
    const r = source ? source[src] : 255;
    const g = source ? source[src + 1] : 255;
    const b = source ? source[src + 2] : 255;
    const a = source ? source[src + 3] : 255;
    for (let corner = 0; corner < 6; corner++) {
      target[dst++] = r;
      target[dst++] = g;
      target[dst++] = b;
      target[dst++] = a;
    }
  }
}

function copyCompressedLineSegmentQuadColorsInto(
  source: ArrayLike<number> | undefined,
  sourceIndices: ArrayLike<number>,
  target: Uint8Array,
  vertexOffset: number,
  lineSegmentCount: number
): void {
  let dst = vertexOffset * 4;
  for (let segmentIndex = 0; segmentIndex < lineSegmentCount; segmentIndex++) {
    const indexA = sourceIndices[segmentIndex * 2];
    const indexB = sourceIndices[segmentIndex * 2 + 1];
    for (let corner = 0; corner < 6; corner++) {
      const sourceIndex = corner === 0 || corner === 3 || corner === 5 ? indexA : indexB;
      const src = sourceIndex * 4;
      target[dst++] = source ? source[src] : 255;
      target[dst++] = source ? source[src + 1] : 255;
      target[dst++] = source ? source[src + 2] : 255;
      target[dst++] = source ? source[src + 3] : 255;
    }
  }
}

function alignIndexElementCountForWrite(indexCount: number, indexFormat: "uint16" | "uint32"): number {
  return indexFormat === "uint16" ? ((indexCount + 1) & ~1) : indexCount;
}

function quantizeUnorm16(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 65535) {
    return 65535;
  }
  return Math.round(value);
}
