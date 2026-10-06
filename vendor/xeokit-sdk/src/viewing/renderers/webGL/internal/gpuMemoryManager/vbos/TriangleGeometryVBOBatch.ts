import {PointsPrimitive, TrianglesPrimitive} from "../../../../../../base/constants";
import {SDKErrorType, type SDKResult} from "../../../../../../base/core";
import type {Mat4} from "../../../../../../base/math/matrix";
import type {Vec3} from "../../../../../../base/math/vector";
import type {SceneMesh} from "../../../../../../model/scene";
import {RENDER_PASSES, type RenderPassValue} from "../../RENDER_PASSES";
import type {PrimRange} from "../geometry/PrimRange";
import {TriangleGeometryVBOBuffers} from "./triangleGeometry/TriangleGeometryVBOBuffers";
import {TriangleGeometryVBODrawList} from "./triangleGeometry/TriangleGeometryVBODrawList";
import {buildTriangleGeometryVBOShadowRanges} from "./triangleGeometry/TriangleGeometryVBOShadowRanges";
import {
  clampTriangleGeometryVBOByte,
  copyTriangleGeometryVBOMatrix,
  createTriangleGeometryVBOViewState,
  getTriangleGeometryEdgeIndexCount,
  getTriangleGeometryEdgeSlotCapacity,
  getTriangleGeometryPrimitiveCount,
  TRIANGLE_GEOMETRY_VBO_PICK_REGION_INDEX,
  TRIANGLE_GEOMETRY_VBO_PASS_ORDER,
  type TriangleGeometryVBOMeshRecord,
  type TriangleGeometryVBOViewState
} from "./triangleGeometry/TriangleGeometryVBOState";
import {TriangleGeometryVBOSpanAllocator} from "./triangleGeometry/TriangleGeometryVBOSpanAllocator";
import {
  deleteTriangleGeometryVBOVAOs,
  getTriangleGeometryVBOVAO,
  type TriangleGeometryVBOTopology,
  type TriangleGeometryVBOVAOLayout
} from "./triangleGeometry/TriangleGeometryVBOVAOCache";
import type {MeshManagerStepStats} from "../../meshManager/MeshManagerStepStats";
import {
  MESH_VIEW_FLAG_CASTS_SHADOW,
  MESH_VIEW_FLAG_STYLE_BIN_CLEAR_DEPTH_BEFORE
} from "../dataTextures/MeshViewAttributeTexture";

/**
 * Public handle returned to the VBO geometry storage for one mesh in a VBO batch.
 *
 * @internal
 */
export type TriangleGeometryVBOMeshHandle = {
  meshIndex: number;
};

/**
 * Everything a draw technique needs to issue one VBO-backed draw call.
 *
 * @internal
 */
export type TriangleGeometryVBODrawState = {
  vao: WebGLVertexArrayObject;
  firstIndex: number;
  indexCount: number;
  primRange: PrimRange;
};

/**
 * VBO draw state for one RTC tile. Each span addresses packed active indices
 * inside the element buffer. Picking reuses the spans from the color passes.
 *
 * @internal
 */
export type TriangleGeometryVBOTileDrawState = {
  tileIndex: number;
  spans: Array<{
    firstIndex: number;
    indexCount: number;
    primCount: number;
  }>;
};

/**
 * Batch-owned VBO sibling for triangle geometry.
 *
 * This facade remains the renderer-facing VBO resource. Internally it delegates
 * indexed vertex storage, compact pass/pick draw lists, and VAO setup to
 * smaller helpers so mesh lifecycle logic stays readable.
 *
 * @internal
 */
export class TriangleGeometryVBOBatch {
  private gl: WebGL2RenderingContext;
  private readonly _batchIndex: number;
  private readonly _maxPrims: number;
  private readonly _primitive: number;
  private readonly _maxViews: number;
  private readonly _hasNormals: boolean;
  private readonly _vertexCapacity: number;
  private readonly _indexCapacity: number;
  private readonly _edgeIndexCapacity: number;
  private readonly _views: TriangleGeometryVBOViewState[] = [];
  private readonly _meshRecords = new Map<number, TriangleGeometryVBOMeshRecord>();
  private _numPrims = 0;
  private readonly _buffers = new TriangleGeometryVBOBuffers();
  private readonly _vertexSpans: TriangleGeometryVBOSpanAllocator;
  private readonly _drawList: TriangleGeometryVBODrawList;
  private _bulkMeshAddDepth = 0;
  private _bulkMeshAddRangesDirty = false;
  private _geometryVertexToVBO = new Uint32Array(0);
  private _geometryVertexLookupStamps = new Uint32Array(0);
  private _geometryVertexLookupStamp = 1;

  constructor(params: {
    gl: WebGL2RenderingContext;
    batchIndex: number;
    maxPrims: number;
    maxViews: number;
    primitive: number;
    hasNormals?: boolean;
  }) {
    this.gl = params.gl;
    this._batchIndex = params.batchIndex;
    this._maxPrims = Math.max(1, params.maxPrims | 0);
    this._maxViews = Math.max(1, params.maxViews | 0);
    this._primitive = params.primitive;
    this._hasNormals = params.hasNormals === true;
    const verticesPerPrim = this._primitive === PointsPrimitive ? 1 : 3;
    this._vertexCapacity = this._maxPrims * verticesPerPrim;
    this._indexCapacity = this._maxPrims * verticesPerPrim;
    this._edgeIndexCapacity = this._primitive === TrianglesPrimitive ? this._maxPrims * 6 : 0;
    this._vertexSpans = new TriangleGeometryVBOSpanAllocator(this._vertexCapacity);
    this._drawList = new TriangleGeometryVBODrawList(this._buffers, verticesPerPrim);
    for (let i = 0; i < this._maxViews; i++) {
      this._views.push(createTriangleGeometryVBOViewState());
    }
  }

  allocate(): SDKResult<void> {
    const cpuResult = this._buffers.allocateCPU({
      vertexCapacity: this._vertexCapacity,
      indexCapacity: this._indexCapacity,
      edgeIndexCapacity: this._edgeIndexCapacity,
      views: this._views,
      hasNormals: this._hasNormals
    });
    if (cpuResult.ok === false) {
      return cpuResult;
    }
    return this._allocateGPUResources();
  }

  setWebGLContext(gl: WebGL2RenderingContext): void {
    this.gl = gl;
  }

  webglContextRestored(): SDKResult<void> {
    // Handles from the lost context are already invalid. Deleting them through
    // the restored context produces INVALID_OPERATION in desktop WebGL.
    this._deleteGPUResources(false);
    const result = this._allocateGPUResources();
    if (result.ok === false) {
      return result;
    }
    this._buffers.markAllDirty(this._vertexSpans.nextVertex, this._views);
    this.uploadChanges();
    return {ok: true, value: undefined};
  }

  canAddMesh(sceneMesh: SceneMesh): boolean {
    if (sceneMesh.geometry.primitive !== this._primitive) {
      return false;
    }
    const primitiveCount = getTriangleGeometryPrimitiveCount(sceneMesh);
    const vertexCount = this._getVertexCount(sceneMesh);
    return primitiveCount > 0
      && this._numPrims + primitiveCount <= this._maxPrims
      && this._vertexSpans.hasAvailable(vertexCount)
      && getTriangleGeometryEdgeIndexCount(sceneMesh) <= getTriangleGeometryEdgeSlotCapacity(sceneMesh);
  }

  beginBulkMeshAdd(stats?: MeshManagerStepStats | null): void {
    this._bulkMeshAddDepth++;
    if (stats) {
      stats.vboBulkScopes++;
    }
  }

  endBulkMeshAdd(stats?: MeshManagerStepStats | null): void {
    if (this._bulkMeshAddDepth <= 0) {
      return;
    }
    this._bulkMeshAddDepth--;
    const indexStart = stats ? performance.now() : 0;
    if (stats) {
      stats.vboWriteIndexSlotsMs += performance.now() - indexStart;
    }
    if (this._bulkMeshAddDepth === 0 && this._bulkMeshAddRangesDirty) {
      this._refreshAllViewRanges(stats);
      this._bulkMeshAddRangesDirty = false;
    }
  }

  addMesh(params: {
    meshIndex: number;
    sceneMesh: SceneMesh;
    tileIndex: number;
    matrix: Mat4;
    color: Vec3;
    opacity: number;
    stats?: MeshManagerStepStats | null;
  }): SDKResult<TriangleGeometryVBOMeshHandle> {
    const stats = params.stats;
    const addStart = stats ? performance.now() : 0;
    if (stats) {
      stats.vboAddMeshCalls++;
      if (this._bulkMeshAddDepth > 0) {
        stats.vboBulkAddMeshCalls++;
      }
    }
    const primitiveCount = getTriangleGeometryPrimitiveCount(params.sceneMesh);
    if (primitiveCount <= 0) {
      if (stats) {
        stats.vboAddMeshMs += performance.now() - addStart;
      }
      return {
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: "[TriangleGeometryVBOBatch.addMesh] Expected a triangle or point mesh with geometry"
      };
    }
    const vertexCount = this._getVertexCount(params.sceneMesh);
    if (this._meshRecords.has(params.meshIndex)) {
      if (stats) {
        stats.vboAddMeshMs += performance.now() - addStart;
      }
      return {
        ok: false,
        type: SDKErrorType.InvalidInput,
        error: `[TriangleGeometryVBOBatch.addMesh] Mesh ${params.meshIndex} already exists in batch ${this._batchIndex}`
      };
    }
    if (this._primitive === TrianglesPrimitive && getTriangleGeometryEdgeIndexCount(params.sceneMesh) > getTriangleGeometryEdgeSlotCapacity(params.sceneMesh)) {
      if (stats) {
        stats.vboAddMeshMs += performance.now() - addStart;
      }
      return {
        ok: false,
        type: SDKErrorType.MemoryAllocationFailed,
        error: `[TriangleGeometryVBOBatch.addMesh] Batch ${this._batchIndex} has no VBO edge-index slot space for ${primitiveCount} triangle(s)`
      };
    }
    const vertexBase = this._numPrims + primitiveCount <= this._maxPrims
      ? this._vertexSpans.allocate(vertexCount) : -1;
    if (vertexBase < 0) {
      if (stats) {
        stats.vboAddMeshMs += performance.now() - addStart;
      }
      return {
        ok: false,
        type: SDKErrorType.MemoryAllocationFailed,
        error: `[TriangleGeometryVBOBatch.addMesh] Batch ${this._batchIndex} has no VBO space for ${primitiveCount} triangle(s)`
      };
    }

    try {
      this._buffers.ensureVertexCapacity(this._vertexSpans.nextVertex, this._vertexCapacity, this._views);
    } catch (error) {
      this._vertexSpans.release(vertexBase, vertexCount);
      return {ok: false, type: SDKErrorType.MemoryAllocationFailed,
        error: `[TriangleGeometryVBOBatch.addMesh] Vertex allocation failed: ${error}`};
    }
    const viewAttributes = new Uint8Array(this._maxViews * 8);
    for (let viewIndex = 0; viewIndex < this._maxViews; viewIndex++) {
      const offset = viewIndex * 8;
      viewAttributes[offset] = clampTriangleGeometryVBOByte(params.color[0], 255);
      viewAttributes[offset + 1] = clampTriangleGeometryVBOByte(params.color[1], 255);
      viewAttributes[offset + 2] = clampTriangleGeometryVBOByte(params.color[2], 255);
      viewAttributes[offset + 3] = clampTriangleGeometryVBOByte(params.opacity, 255);
      viewAttributes[offset + 4] = 1;
      viewAttributes[offset + 5] = 1;
      viewAttributes[offset + 6] = 1;
      viewAttributes[offset + 7] = MESH_VIEW_FLAG_CASTS_SHADOW;
    }

    const record: TriangleGeometryVBOMeshRecord = {
      meshIndex: params.meshIndex,
      sceneMesh: params.sceneMesh,
      vertexBase,
      vertexCount,
      primitiveCount,
      edgeVertexIndices: new Uint32Array(0),
      tileIndex: params.tileIndex | 0,
      matrix: copyTriangleGeometryVBOMatrix(params.matrix),
      viewAttributes,
      meshViewStates: this._views.map(() => ({
        renderPass: RENDER_PASSES.OPAQUE,
        visible: true
      }))
    };
    this._meshRecords.set(params.meshIndex, record);
    this._numPrims += primitiveCount;

    this._writeMeshGeometry(record, stats);
    for (let viewIndex = 0; viewIndex < this._maxViews; viewIndex++) {
      const view = this._views[viewIndex];
      const colorStart = stats ? performance.now() : 0;
      this._writeMeshViewAttributes(record, viewIndex);
      if (stats) {
        stats.vboWriteColorsMs += performance.now() - colorStart;
      }
      const indexStart = stats ? performance.now() : 0;
      this._drawList.addRecordViewIndices(view, viewIndex, record, false);
      if (stats) {
        stats.vboWriteIndexSlotsMs += performance.now() - indexStart;
      }
      if (this._bulkMeshAddDepth === 0) {
        this._refreshViewRanges(view, stats);
      }
    }
    if (this._bulkMeshAddDepth > 0) {
      this._bulkMeshAddRangesDirty = true;
    }
    if (stats) {
      stats.vboAddMeshMs += performance.now() - addStart;
    }

    return {ok: true, value: {meshIndex: params.meshIndex}};
  }

  removeMesh(meshIndex: number): void {
    const record = this._meshRecords.get(meshIndex);
    if (!record) {
      return;
    }
    for (let viewIndex = 0; viewIndex < this._views.length; viewIndex++) {
      this._drawList.removeRecordViewIndices(this._views[viewIndex], viewIndex, record);
    }
    this._meshRecords.delete(meshIndex);
    this._numPrims -= record.primitiveCount;
    this._vertexSpans.release(record.vertexBase, record.vertexCount);
    for (let viewIndex = 0; viewIndex < this._views.length; viewIndex++) {
      this._drawList.refreshViewRanges(this._views[viewIndex]);
    }
  }

  updateMeshGeometry(meshIndex: number, stats?: MeshManagerStepStats | null): boolean {
    const record = this._meshRecords.get(meshIndex);
    if (!record) {
      return false;
    }
    if (this._getVertexCount(record.sceneMesh) !== record.vertexCount ||
      getTriangleGeometryPrimitiveCount(record.sceneMesh) !== record.primitiveCount) return false;
    for (let i = 0; i < this._views.length; i++) this._drawList.removeRecordViewIndices(this._views[i], i, record);
    this._writeMeshGeometry(record, stats);
    for (let i = 0; i < this._views.length; i++) this._drawList.addRecordViewIndices(this._views[i], i, record);
    return true;
  }

  setMeshMatrix(meshIndex: number, matrix: Mat4): void {
    const record = this._meshRecords.get(meshIndex);
    if (!record) {
      return;
    }
    record.matrix.set(matrix as any);
    this._writeMeshGeometry(record);
  }

  setMeshTile(meshIndex: number, tileIndex: number): void {
    const record = this._meshRecords.get(meshIndex);
    if (!record || record.tileIndex === (tileIndex | 0)) {
      return;
    }
    record.tileIndex = tileIndex | 0;
    this._writeMeshGeometry(record);
  }

  setMeshPlacement(meshIndex: number, tileIndex: number, matrix: Mat4): void {
    const record = this._meshRecords.get(meshIndex);
    if (!record) {
      return;
    }
    const nextTileIndex = tileIndex | 0;
    let dirty = record.tileIndex !== nextTileIndex;
    record.tileIndex = nextTileIndex;
    for (let i = 0; i < 16; i++) {
      if (record.matrix[i] !== (matrix as any)[i]) {
        dirty = true;
        break;
      }
    }
    if (!dirty) {
      return;
    }
    record.matrix.set(matrix as any);
    this._writeMeshGeometry(record);
  }

  setMeshViewAttribs(
    meshIndex: number,
    viewIndex: number,
    params: {
      color?: Vec3;
      opacity?: number;
      pickable?: boolean;
      clippable?: boolean;
      styleBinEdges?: boolean;
      styleBinClearDepthBefore?: boolean;
      castsShadow?: boolean;
    }
  ): void {
    const record = this._meshRecords.get(meshIndex);
    const view = this._views[viewIndex];
    if (!record || !view) {
      return;
    }
    const attributes = record.viewAttributes;
    const offset = viewIndex * 8;
    let dirty = false;
    if (params.color) {
      for (let i = 0; i < 3; i++) {
        const value = clampTriangleGeometryVBOByte(params.color[i], attributes[offset + i]);
        if (attributes[offset + i] !== value) {
          attributes[offset + i] = value;
          dirty = true;
        }
      }
    }
    if (params.opacity !== undefined) {
      const opacity = clampTriangleGeometryVBOByte(params.opacity, attributes[offset + 3]);
      dirty = attributes[offset + 3] !== opacity || dirty;
      attributes[offset + 3] = opacity;
    }
    if (params.pickable !== undefined) {
      const value = params.pickable ? 1 : 0;
      dirty = attributes[offset + 4] !== value || dirty;
      attributes[offset + 4] = value;
    }
    if (params.clippable !== undefined) {
      const value = params.clippable ? 1 : 0;
      dirty = attributes[offset + 5] !== value || dirty;
      attributes[offset + 5] = value;
    }
    if (params.styleBinEdges !== undefined) {
      const value = params.styleBinEdges ? 1 : 0;
      dirty = attributes[offset + 6] !== value || dirty;
      attributes[offset + 6] = value;
    }
    let flags = attributes[offset + 7];
    if (params.styleBinClearDepthBefore !== undefined) {
      flags = params.styleBinClearDepthBefore ? flags | MESH_VIEW_FLAG_STYLE_BIN_CLEAR_DEPTH_BEFORE
        : flags & ~MESH_VIEW_FLAG_STYLE_BIN_CLEAR_DEPTH_BEFORE;
    }
    if (params.castsShadow !== undefined) {
      flags = params.castsShadow ? flags | MESH_VIEW_FLAG_CASTS_SHADOW : flags & ~MESH_VIEW_FLAG_CASTS_SHADOW;
    }
    dirty = flags !== attributes[offset + 7] || dirty;
    attributes[offset + 7] = flags;
    if (dirty) {
      this._writeMeshViewAttributes(record, viewIndex);
    }
  }

  setMeshRenderPass(meshIndex: number, viewIndex: number, renderPass: RenderPassValue): void {
    const record = this._meshRecords.get(meshIndex);
    const meshViewState = record?.meshViewStates[viewIndex];
    const view = this._views[viewIndex];
    if (!record || !meshViewState || !view || meshViewState.renderPass === renderPass) {
      return;
    }
    this._drawList.setRecordRenderPass(view, viewIndex, record, renderPass);
  }

  setMeshVisible(meshIndex: number, viewIndex: number, visible: boolean): void {
    const record = this._meshRecords.get(meshIndex);
    const meshViewState = record?.meshViewStates[viewIndex];
    const view = this._views[viewIndex];
    if (!record || !meshViewState || !view || meshViewState.visible === visible) {
      return;
    }
    this._drawList.setRecordVisible(view, viewIndex, record, visible);
  }

  getDrawState(viewIndex: number, renderPass: RenderPassValue, layout: TriangleGeometryVBOVAOLayout,
               hasNormals: boolean = this._hasNormals): TriangleGeometryVBODrawState | null {
    const view = this._views[viewIndex];
    if (!view) {
      return null;
    }
    this._prepareDraw(view, "triangles");
    const primRange = view.passRanges.get(renderPass) ?? {firstPrim: 0, numPrims: 0};
    const indexRange = view.indexRanges.get(renderPass) ?? {firstIndex: 0, indexCount: 0};
    if (primRange.numPrims <= 0 || indexRange.indexCount <= 0) {
      return null;
    }
    const vao = this._getVAO(view, layout, "triangles", hasNormals);
    if (!vao) {
      return null;
    }
    return {
      vao,
      firstIndex: indexRange.firstIndex,
      indexCount: indexRange.indexCount,
      primRange
    };
  }

  getTileDrawStates(
    viewIndex: number,
    renderPass: RenderPassValue,
    layout: "hybrid" | "lean-static",
    topology: TriangleGeometryVBOTopology = "triangles",
    hasNormals: boolean = false
  ): {
    vao: WebGLVertexArrayObject;
    primRange: PrimRange;
    tileDrawStates: TriangleGeometryVBOTileDrawState[];
  } | null {
    const view = this._views[viewIndex];
    if (!view) {
      return null;
    }
    this._prepareDraw(view, topology);
    const passRegionIndex = TRIANGLE_GEOMETRY_VBO_PASS_ORDER.indexOf(renderPass);
    const primRange = topology === "edges"
      ? (view.edgePassRanges.get(renderPass) ?? {firstPrim: 0, numPrims: 0})
      : (view.passRanges.get(renderPass) ?? {firstPrim: 0, numPrims: 0});
    if (passRegionIndex < 0 || primRange.numPrims <= 0) {
      return null;
    }
    const vao = this._getVAO(view, layout, topology, hasNormals);
    if (!vao) {
      return null;
    }
    const tileDrawStates = this._getTileDrawStates(viewIndex, topology, passRegionIndex);
    if (tileDrawStates.length === 0) {
      return null;
    }
    return {
      vao,
      primRange,
      tileDrawStates
    };
  }

  /** Lazily cached CPU metadata; ordinary color/pick/edge draws never request it. */
  getShadowRanges(viewIndex: number, renderPass: RenderPassValue): Float64Array | null {
    const view = this._views[viewIndex];
    if (this._primitive !== TrianglesPrimitive || !view || !this._meshIndices) return null;
    this._prepareDraw(view, "triangles");
    const cache = view.shadowRanges ??= new Map();
    if (!cache.has(renderPass)) {
      cache.set(renderPass, buildTriangleGeometryVBOShadowRanges(view, renderPass, this._meshRecords, this._meshIndices));
    }
    return cache.get(renderPass) ?? null;
  }

  getPickTileDrawStates(
    viewIndex: number,
    layout: "hybrid" | "lean-static",
    topology: TriangleGeometryVBOTopology = "triangles",
    hasNormals: boolean = false
  ): {
    vao: WebGLVertexArrayObject;
    primRange: PrimRange;
    tileDrawStates: TriangleGeometryVBOTileDrawState[];
  } | null {
    const view = this._views[viewIndex];
    if (!view) {
      return null;
    }
    this._prepareDraw(view, topology);
    const primRange = topology === "edges" ? view.pickEdgeRange : view.pickRange;
    if (primRange.numPrims <= 0) {
      return null;
    }
    const vao = this._getVAO(view, layout, topology, hasNormals);
    if (!vao) {
      return null;
    }
    const tileDrawStates = this._getTileDrawStates(viewIndex, topology, TRIANGLE_GEOMETRY_VBO_PICK_REGION_INDEX);
    if (tileDrawStates.length === 0) {
      return null;
    }
    return {
      vao,
      primRange,
      tileDrawStates
    };
  }

  getPickDrawState(viewIndex: number, layout: "hybrid" | "lean-static",
                   hasNormals: boolean = this._hasNormals): TriangleGeometryVBODrawState | null {
    const view = this._views[viewIndex];
    if (!view) {
      return null;
    }
    this._prepareDraw(view, "triangles");
    if (view.pickRange.numPrims <= 0 || view.pickIndexRange.indexCount <= 0) {
      return null;
    }
    const vao = this._getVAO(view, layout, "triangles", hasNormals);
    if (!vao) {
      return null;
    }
    return {
      vao,
      firstIndex: view.pickIndexRange.firstIndex,
      indexCount: view.pickIndexRange.indexCount,
      primRange: view.pickRange
    };
  }

  getPickEdgeDrawState(viewIndex: number, layout: "hybrid" | "lean-static"): TriangleGeometryVBODrawState | null {
    const view = this._views[viewIndex];
    if (!view) {
      return null;
    }
    this._prepareDraw(view, "edges");
    if (view.pickEdgeRange.numPrims <= 0 || view.pickEdgeIndexRange.indexCount <= 0) {
      return null;
    }
    const vao = this._getVAO(view, layout, "edges");
    if (!vao) {
      return null;
    }
    return {
      vao,
      firstIndex: view.pickEdgeIndexRange.firstIndex,
      indexCount: view.pickEdgeIndexRange.indexCount,
      primRange: view.pickEdgeRange
    };
  }

  getEdgeDrawState(viewIndex: number, renderPass: RenderPassValue, layout: "hybrid" | "lean-static"): TriangleGeometryVBODrawState | null {
    const view = this._views[viewIndex];
    if (!view) {
      return null;
    }
    this._prepareDraw(view, "edges");
    const primRange = view.edgePassRanges.get(renderPass) ?? {firstPrim: 0, numPrims: 0};
    const indexRange = view.edgeIndexRanges.get(renderPass) ?? {firstIndex: 0, indexCount: 0};
    if (primRange.numPrims <= 0 || indexRange.indexCount <= 0) {
      return null;
    }
    const vao = this._getVAO(view, layout, "edges");
    if (!vao) {
      return null;
    }
    return {
      vao,
      firstIndex: indexRange.firstIndex,
      indexCount: indexRange.indexCount,
      primRange
    };
  }

  getRenderPassPrimitiveRange(viewIndex: number, renderPass: RenderPassValue): PrimRange | null {
    return this._views[viewIndex]?.passRanges.get(renderPass) ?? null;
  }

  getRenderPassPrimitiveRanges(viewIndex: number): Map<number, PrimRange> | null {
    return this._views[viewIndex]?.passRanges ?? null;
  }

  getRenderPassEdgePrimitiveRanges(viewIndex: number): Map<number, PrimRange> | null {
    return this._views[viewIndex]?.edgePassRanges ?? null;
  }

  getPickPrimitiveRange(viewIndex: number): PrimRange | null {
    return this._views[viewIndex]?.pickRange ?? null;
  }

  getPickEdgePrimitiveRange(viewIndex: number): PrimRange | null {
    return this._views[viewIndex]?.pickEdgeRange ?? null;
  }

  getNumDrawablePrims(viewIndex: number): number {
    return this._views[viewIndex]?.pickRange.numPrims ?? 0;
  }

  uploadChanges(): boolean {
    return this._buffers.uploadChanges({
      gl: this.gl,
      views: this._views,
      rebuildViewIndices: (view, viewIndex) => {
        this._drawList.rebuildViewIndices(view, viewIndex, this._meshRecords);
      }
    });
  }

  getAllocatedBytes(): number {
    return this._buffers.getAllocatedBytes(this._views);
  }

  getUsedBytes(): number {
    return this._buffers.getUsedBytes({
      activeVertices: this._getUsedVertexCapacity(),
      maxViews: this._maxViews,
      views: this._views
    });
  }

  destroy(): void {
    this._deleteGPUResources();
    this._buffers.destroyCPU(this._views);
    this._meshRecords.clear();
    this._numPrims = 0;
    this._vertexSpans.clear();
    this._geometryVertexToVBO = new Uint32Array(0);
    this._geometryVertexLookupStamps = new Uint32Array(0);
    this._geometryVertexLookupStamp = 1;
  }

  private _allocateGPUResources(): SDKResult<void> {
    return this._buffers.allocateGPU({
      gl: this.gl,
      vertexCapacity: this._vertexCapacity,
      indexCapacity: this._indexCapacity,
      edgeIndexCapacity: this._edgeIndexCapacity,
      views: this._views,
      hasNormals: this._hasNormals
    });
  }

  private _deleteGPUResources(deleteObjects = true): void {
    for (const view of this._views) {
      deleteTriangleGeometryVBOVAOs(this.gl, view, deleteObjects);
    }
    this._buffers.deleteGPUResources(this.gl, this._views, deleteObjects);
  }

  private _refreshViewRanges(view: TriangleGeometryVBOViewState, stats?: MeshManagerStepStats | null): void {
    const start = stats ? performance.now() : 0;
    this._drawList.refreshViewRanges(view);
    if (stats) {
      stats.vboRefreshRangesMs += performance.now() - start;
      stats.vboRefreshRangesCalls++;
    }
  }

  private _refreshAllViewRanges(stats?: MeshManagerStepStats | null): void {
    for (const view of this._views) {
      this._refreshViewRanges(view, stats);
    }
  }

  private _writeMeshGeometry(record: TriangleGeometryVBOMeshRecord, stats?: MeshManagerStepStats | null): void {
    const start = stats ? performance.now() : 0;
    const positions = this._buffers.positions;
    const normals = this._buffers.normals;
    const meshIndices = this._buffers.meshIndices;
    const geometryVertexIndices = this._buffers.geometryVertexIndices;
    if (!positions || !meshIndices || !geometryVertexIndices) {
      return;
    }
    const geometry = record.sceneMesh.geometry;
    const compressed = geometry.positionsCompressed;
    const normalsCompressed = geometry.normalsCompressed;
    const indices = geometry.indices;
    const aabb = geometry.aabb;
    if (!compressed || !aabb || (this._primitive === TrianglesPrimitive && !indices)) {
      return;
    }
    const offsetX = aabb[0];
    const offsetY = aabb[1];
    const offsetZ = aabb[2];
    const scaleX = (aabb[3] - aabb[0]) / 65536;
    const scaleY = (aabb[4] - aabb[1]) / 65536;
    const scaleZ = (aabb[5] - aabb[2]) / 65536;
    const matrix = record.matrix;
    const lookupStamp = this._beginGeometryVertexLookup((compressed.length / 3) | 0);
    const geometryVertexToVBO = this._geometryVertexToVBO;
    const geometryVertexLookupStamps = this._geometryVertexLookupStamps;
    let writeVertex = record.vertexBase;
    const vertexStart = stats ? performance.now() : 0;
    if (indices) {
      for (let i = 0; i < indices.length; i++) geometryVertexLookupStamps[indices[i]] = lookupStamp;
    }
    for (let geometryVertexIndex = 0; geometryVertexIndex < record.vertexCount; geometryVertexIndex++) {
      const compressedOffset = geometryVertexIndex * 3;
      const x = offsetX + scaleX * compressed[compressedOffset];
      const y = offsetY + scaleY * compressed[compressedOffset + 1];
      const z = offsetZ + scaleZ * compressed[compressedOffset + 2];
      const positionOffset = writeVertex * 4;
      positions[positionOffset] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
      positions[positionOffset + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
      positions[positionOffset + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
      positions[positionOffset + 3] = record.tileIndex;
      if (normals && normalsCompressed) writeTransformedOctNormal(normalsCompressed, geometryVertexIndex, matrix, normals, writeVertex);
      meshIndices[writeVertex] = record.meshIndex;
      geometryVertexIndices[writeVertex] = geometryVertexIndex;
      geometryVertexToVBO[geometryVertexIndex] = writeVertex;
      writeVertex++;
    }
    if (stats) {
      stats.vboPackVerticesMs += performance.now() - vertexStart;
    }
    const edgeIndices = geometry.edgeIndices;
    const edgeStart = stats ? performance.now() : 0;
    if (this._primitive === TrianglesPrimitive && edgeIndices && edgeIndices.length > 0) {
      const edgeVertexIndices = new Uint32Array(edgeIndices.length);
      let edgeOffset = 0;
      for (let edge = 0; edge + 1 < edgeIndices.length; edge += 2) {
        const aIndex = edgeIndices[edge];
        const bIndex = edgeIndices[edge + 1];
        if (geometryVertexLookupStamps[aIndex] !== lookupStamp || geometryVertexLookupStamps[bIndex] !== lookupStamp) {
          continue;
        }
        edgeVertexIndices[edgeOffset++] = geometryVertexToVBO[aIndex];
        edgeVertexIndices[edgeOffset++] = geometryVertexToVBO[bIndex];
      }
      record.edgeVertexIndices = edgeOffset === edgeVertexIndices.length
        ? edgeVertexIndices
        : edgeVertexIndices.slice(0, edgeOffset);
    } else {
      record.edgeVertexIndices = new Uint32Array(0);
    }
    if (stats) {
      stats.vboPackEdgesMs += performance.now() - edgeStart;
    }
    for (const view of this._views) view.indicesDirty = true;
    this._buffers.markPositionDirty(record.vertexBase, record.vertexCount);
    this._buffers.markNormalDirty(record.vertexBase, record.vertexCount);
    this._buffers.markMeshIndexDirty(record.vertexBase, record.vertexCount);
    this._buffers.markGeometryVertexIndexDirty(record.vertexBase, record.vertexCount);
    if (stats) {
      stats.vboWriteGeometryMs += performance.now() - start;
      stats.vboWriteGeometryCalls++;
    }
  }

  private _beginGeometryVertexLookup(vertexCount: number): number {
    if (vertexCount > this._geometryVertexToVBO.length) {
      const capacity = Math.max(vertexCount, this._geometryVertexToVBO.length * 2, 16);
      this._geometryVertexToVBO = new Uint32Array(capacity);
      this._geometryVertexLookupStamps = new Uint32Array(capacity);
      this._geometryVertexLookupStamp = 1;
    }
    if (this._geometryVertexLookupStamp > 0xffffffff) {
      this._geometryVertexLookupStamps.fill(0);
      this._geometryVertexLookupStamp = 1;
    }
    return this._geometryVertexLookupStamp++;
  }

  private _writeMeshViewAttributes(record: TriangleGeometryVBOMeshRecord, viewIndex: number): void {
    const view = this._views[viewIndex];
    const colors = view?.colors;
    const renderFlags = view?.renderFlags;
    if (!view || !colors || !renderFlags) {
      return;
    }
    const attributes = record.viewAttributes;
    const attributeOffset = viewIndex * 8;
    const start = record.vertexBase * 4;
    const end = start + record.vertexCount * 4;
    for (let offset = start; offset < end; offset += 4) {
      for (let channel = 0; channel < 4; channel++) {
        colors[offset + channel] = attributes[attributeOffset + channel];
        renderFlags[offset + channel] = attributes[attributeOffset + 4 + channel];
      }
    }
    this._buffers.markColorDirty(view, record.vertexBase, record.vertexCount);
    this._buffers.markRenderFlagDirty(view, record.vertexBase, record.vertexCount);
  }

  private _getVAO(
    view: TriangleGeometryVBOViewState,
    layout: TriangleGeometryVBOVAOLayout,
    topology: TriangleGeometryVBOTopology,
    hasNormals: boolean = false
  ): WebGLVertexArrayObject | null {
    return getTriangleGeometryVBOVAO({
      gl: this.gl,
      view,
      layout,
      topology,
      positionBuffer: this._buffers.positionBuffer,
      normalBuffer: this._buffers.normalBuffer,
      meshIndexBuffer: this._buffers.meshIndexBuffer,
      geometryVertexIndexBuffer: this._buffers.geometryVertexIndexBuffer,
      hasNormals
    });
  }

  private _prepareDraw(view: TriangleGeometryVBOViewState, topology: TriangleGeometryVBOTopology): void {
    if (topology === "edges" && !view.edgesEnabled) {
      view.edgesEnabled = true;
      view.indicesDirty = true;
    }
    if (view.indicesDirty) this.uploadChanges();
  }

  private _getTileDrawStates(viewIndex: number, topology: TriangleGeometryVBOTopology,
                            regionIndex: number): TriangleGeometryVBOTileDrawState[] {
    return this._views[viewIndex].tileDrawStates.get(regionIndex * 2 + (topology === "edges" ? 1 : 0)) ?? [];
  }

  private _getUsedVertexCapacity(): number {
    let count = 0;
    for (const record of this._meshRecords.values()) {
      count += record.vertexCount;
    }
    return count;
  }

  private _getVertexCount(sceneMesh: SceneMesh): number {
    return (sceneMesh.geometry.positionsCompressed?.length ?? 0) / 3;
  }

  private get _positions(): Float32Array | null {
    return this._buffers.positions;
  }

  private get _normals(): Uint16Array | null {
    return this._buffers.normals;
  }

  private get _meshIndices(): Uint32Array | null {
    return this._buffers.meshIndices;
  }

  private get _geometryVertexIndices(): Uint32Array | null {
    return this._buffers.geometryVertexIndices;
  }

  private get _freeVertexSpans(): Array<{ base: number; count: number }> {
    return this._vertexSpans.freeVertexSpans;
  }

  private get _nextVertex(): number {
    return this._vertexSpans.nextVertex;
  }
}

function writeTransformedOctNormal(
  normalsCompressed: ArrayLike<number>,
  geometryVertexIndex: number,
  matrix: Float64Array,
  out: Uint16Array,
  outVertexIndex: number
): void {
  const sourceOffset = geometryVertexIndex * 2;
  let x = Number(normalsCompressed[sourceOffset]) / 65535 * 2 - 1;
  let y = Number(normalsCompressed[sourceOffset + 1]) / 65535 * 2 - 1;
  let z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const oldX = x;
    const oldY = y;
    x = (1 - Math.abs(oldY)) * (oldX >= 0 ? 1 : -1);
    y = (1 - Math.abs(oldX)) * (oldY >= 0 ? 1 : -1);
  }
  const nx = matrix[0] * x + matrix[4] * y + matrix[8] * z;
  const ny = matrix[1] * x + matrix[5] * y + matrix[9] * z;
  const nz = matrix[2] * x + matrix[6] * y + matrix[10] * z;
  const len = Math.hypot(nx, ny, nz);
  if (len > 0) {
    x = nx / len;
    y = ny / len;
    z = nz / len;
  }
  const invL1 = 1 / (Math.abs(x) + Math.abs(y) + Math.abs(z) || 1);
  let ox = x * invL1;
  let oy = y * invL1;
  if (z < 0) {
    const oldX = ox;
    const oldY = oy;
    ox = (1 - Math.abs(oldY)) * (oldX >= 0 ? 1 : -1);
    oy = (1 - Math.abs(oldX)) * (oldY >= 0 ? 1 : -1);
  }
  const outOffset = outVertexIndex * 2;
  out[outOffset] = clampNormalU16((ox * 0.5 + 0.5) * 65535);
  out[outOffset + 1] = clampNormalU16((oy * 0.5 + 0.5) * 65535);
}

function clampNormalU16(value: number): number {
  return Math.min(65535, Math.max(0, Math.round(value)));
}
