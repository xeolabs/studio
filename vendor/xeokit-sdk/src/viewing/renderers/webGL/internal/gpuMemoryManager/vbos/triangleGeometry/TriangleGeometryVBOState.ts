import {PointsPrimitive, TrianglesPrimitive} from "../../../../../../../base/constants";
import type {Mat4} from "../../../../../../../base/math/matrix";
import type {SceneMesh} from "../../../../../../../model/scene";
import {RENDER_PASSES, type RenderPassValue} from "../../../RENDER_PASSES";
import type {PrimRange} from "../../geometry/PrimRange";
import type {TriangleGeometryVBOTileDrawState} from "../TriangleGeometryVBOBatch";

/**
 * Per-view draw state for one mesh inside a VBO batch.
 *
 * @internal
 */
export type TriangleGeometryVBOMeshViewState = {
  renderPass: RenderPassValue;
  visible: boolean;
};

/**
 * Contiguous vertex range inside a fixed-size VBO batch.
 *
 * @internal
 */
export type TriangleGeometryVBOVertexSpan = {
  base: number;
  count: number;
};

/**
 * Contiguous element-index range used for one draw call.
 *
 * @internal
 */
export type TriangleGeometryVBOIndexRange = {
  firstIndex: number;
  indexCount: number;
};

/**
 * CPU-side record for one mesh stored inside a triangle VBO batch.
 *
 * @internal
 */
export type TriangleGeometryVBOMeshRecord = {
  meshIndex: number;
  sceneMesh: SceneMesh;
  vertexBase: number;
  vertexCount: number;
  primitiveCount: number;
  edgeVertexIndices: Uint32Array;
  tileIndex: number;
  matrix: Float64Array;
  viewAttributes: Uint8Array; // RGBA followed by four render-flag bytes per view
  meshViewStates: TriangleGeometryVBOMeshViewState[];
};

/**
 * Per-view CPU and GPU state for a triangle VBO batch.
 *
 * @internal
 */
export type TriangleGeometryVBOViewState = {
  indexBuffer: WebGLBuffer | null;
  edgeIndexBuffer: WebGLBuffer | null;
  colorBuffer: WebGLBuffer | null;
  renderFlagBuffer: WebGLBuffer | null;
  indices: Uint32Array | null;
  edgeIndices: Uint32Array | null;
  colors: Uint8Array | null;
  renderFlags: Uint8Array | null;
  passRanges: Map<number, PrimRange>;
  indexRanges: Map<number, TriangleGeometryVBOIndexRange>;
  edgePassRanges: Map<number, PrimRange>;
  edgeIndexRanges: Map<number, TriangleGeometryVBOIndexRange>;
  passPrimCounts: number[];
  edgePassPrimCounts: number[];
  pickPrimCount: number;
  pickEdgePrimCount: number;
  pickRange: PrimRange;
  pickIndexRange: TriangleGeometryVBOIndexRange;
  pickEdgeRange: PrimRange;
  pickEdgeIndexRange: TriangleGeometryVBOIndexRange;
  indexCount: number;
  edgeIndexCount: number;
  indicesDirty: boolean;
  edgesEnabled: boolean;
  indexBufferBytes: number;
  edgeIndexBufferBytes: number;
  tileDrawStates: Map<number, TriangleGeometryVBOTileDrawState[]>;
  /** Lazy CPU bounds/ranges for shadow passes only; invalidated with packed indices. */
  shadowRanges: Map<number, Float64Array | null> | null;
  indexDirtySpans: TriangleGeometryVBOVertexSpan[];
  edgeIndexDirtySpans: TriangleGeometryVBOVertexSpan[];
  colorDirtyMinVertex: number;
  colorDirtyMaxVertex: number;
  renderFlagDirtyMinVertex: number;
  renderFlagDirtyMaxVertex: number;
  bakedVAO: WebGLVertexArrayObject | null;
  bakedNormalsVAO: WebGLVertexArrayObject | null;
  hybridVAO: WebGLVertexArrayObject | null;
  hybridNormalsVAO: WebGLVertexArrayObject | null;
  leanStaticVAO: WebGLVertexArrayObject | null;
  leanStaticNormalsVAO: WebGLVertexArrayObject | null;
  bakedEdgeVAO: WebGLVertexArrayObject | null;
  hybridEdgeVAO: WebGLVertexArrayObject | null;
  leanStaticEdgeVAO: WebGLVertexArrayObject | null;
};

export const TRIANGLE_GEOMETRY_VBO_PASS_ORDER: RenderPassValue[] = [
  RENDER_PASSES.OPAQUE,
  RENDER_PASSES.TRANSPARENT,
  RENDER_PASSES.STYLE_BIN_OPAQUE,
  RENDER_PASSES.STYLE_BIN_TRANSPARENT
];

export const TRIANGLE_GEOMETRY_VBO_PICK_REGION_INDEX = TRIANGLE_GEOMETRY_VBO_PASS_ORDER.length;
export const TRIANGLE_GEOMETRY_VBO_INDEX_REGION_COUNT = TRIANGLE_GEOMETRY_VBO_PASS_ORDER.length + 1;

export function createTriangleGeometryVBOViewState(): TriangleGeometryVBOViewState {
  const passRanges = new Map<number, PrimRange>();
  const indexRanges = new Map<number, TriangleGeometryVBOIndexRange>();
  const edgePassRanges = new Map<number, PrimRange>();
  const edgeIndexRanges = new Map<number, TriangleGeometryVBOIndexRange>();
  const passPrimCounts = new Array(TRIANGLE_GEOMETRY_VBO_PASS_ORDER.length).fill(0);
  const edgePassPrimCounts = new Array(TRIANGLE_GEOMETRY_VBO_PASS_ORDER.length).fill(0);
  for (const pass of TRIANGLE_GEOMETRY_VBO_PASS_ORDER) {
    passRanges.set(pass, {firstPrim: 0, numPrims: 0});
    indexRanges.set(pass, {firstIndex: 0, indexCount: 0});
    edgePassRanges.set(pass, {firstPrim: 0, numPrims: 0});
    edgeIndexRanges.set(pass, {firstIndex: 0, indexCount: 0});
  }
  return {
    indexBuffer: null,
    edgeIndexBuffer: null,
    colorBuffer: null,
    renderFlagBuffer: null,
    indices: null,
    edgeIndices: null,
    colors: null,
    renderFlags: null,
    passRanges,
    indexRanges,
    edgePassRanges,
    edgeIndexRanges,
    passPrimCounts,
    edgePassPrimCounts,
    pickPrimCount: 0,
    pickEdgePrimCount: 0,
    pickRange: {firstPrim: 0, numPrims: 0},
    pickIndexRange: {firstIndex: 0, indexCount: 0},
    pickEdgeRange: {firstPrim: 0, numPrims: 0},
    pickEdgeIndexRange: {firstIndex: 0, indexCount: 0},
    indexCount: 0,
    edgeIndexCount: 0,
    indicesDirty: false,
    edgesEnabled: false,
    indexBufferBytes: 0,
    edgeIndexBufferBytes: 0,
    tileDrawStates: new Map(),
    shadowRanges: null,
    indexDirtySpans: [],
    edgeIndexDirtySpans: [],
    colorDirtyMinVertex: Number.POSITIVE_INFINITY,
    colorDirtyMaxVertex: -1,
    renderFlagDirtyMinVertex: Number.POSITIVE_INFINITY,
    renderFlagDirtyMaxVertex: -1,
    bakedVAO: null,
    bakedNormalsVAO: null,
    hybridVAO: null,
    hybridNormalsVAO: null,
    leanStaticVAO: null,
    leanStaticNormalsVAO: null,
    bakedEdgeVAO: null,
    hybridEdgeVAO: null,
    leanStaticEdgeVAO: null
  };
}

export function clearTriangleGeometryVBOViewState(view: TriangleGeometryVBOViewState): void {
  view.indices = null;
  view.edgeIndices = null;
  view.colors = null;
  view.renderFlags = null;
  view.passRanges.clear();
  view.indexRanges.clear();
  view.edgePassRanges.clear();
  view.edgeIndexRanges.clear();
  view.passPrimCounts.fill(0);
  view.edgePassPrimCounts.fill(0);
  view.pickPrimCount = 0;
  view.pickEdgePrimCount = 0;
  view.pickRange = {firstPrim: 0, numPrims: 0};
  view.pickIndexRange = {firstIndex: 0, indexCount: 0};
  view.pickEdgeRange = {firstPrim: 0, numPrims: 0};
  view.pickEdgeIndexRange = {firstIndex: 0, indexCount: 0};
  view.indexCount = 0;
  view.edgeIndexCount = 0;
  view.indicesDirty = false;
  view.edgesEnabled = false;
  view.indexBufferBytes = 0;
  view.edgeIndexBufferBytes = 0;
  view.tileDrawStates.clear();
  view.shadowRanges = null;
  view.indexDirtySpans.length = 0;
  view.edgeIndexDirtySpans.length = 0;
  view.colorDirtyMinVertex = Number.POSITIVE_INFINITY;
  view.colorDirtyMaxVertex = -1;
  view.renderFlagDirtyMinVertex = Number.POSITIVE_INFINITY;
  view.renderFlagDirtyMaxVertex = -1;
}

export function copyTriangleGeometryVBOMatrix(matrix: Mat4): Float64Array {
  const copy = new Float64Array(16);
  copy.set(matrix as any);
  return copy;
}

export function clampTriangleGeometryVBOByte(value: number | undefined, fallback: number): number {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(255, value | 0));
}

export function getTriangleGeometryPrimitiveCount(sceneMesh: SceneMesh): number {
  const geometry = sceneMesh.geometry;
  switch (geometry.primitive) {
    case TrianglesPrimitive:
      return geometry.indices ? (geometry.indices.length / 3) | 0 : 0;
    case PointsPrimitive:
      return geometry.positionsCompressed ? (geometry.positionsCompressed.length / 3) | 0 : 0;
    default:
      return 0;
  }
}

export function getTriangleGeometryEdgeIndexCount(sceneMesh: SceneMesh): number {
  const geometry = sceneMesh.geometry;
  if (geometry.primitive !== TrianglesPrimitive || !geometry.edgeIndices) {
    return 0;
  }
  return geometry.edgeIndices.length;
}

export function getTriangleGeometryEdgeSlotCapacity(sceneMesh: SceneMesh): number {
  return sceneMesh.geometry.primitive === TrianglesPrimitive ? getTriangleGeometryPrimitiveCount(sceneMesh) * 6 : 0;
}
