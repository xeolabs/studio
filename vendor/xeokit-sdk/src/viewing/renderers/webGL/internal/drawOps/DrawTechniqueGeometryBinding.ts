import {LinesPrimitive, PointsPrimitive, TrianglesPrimitive} from "../../../../../base/constants";
import {SDKErrorType, type SDKResult} from "../../../../../base/core";
import type {Mat4} from "../../../../../base/math/matrix";
import type {RenderPassValue} from "../RENDER_PASSES";
import type {BatchGPUResources} from "../gpuMemoryManager/BatchGPUResources";
import type {PrimRange} from "../gpuMemoryManager/geometry/PrimRange";
import type {
  TriangleGeometryVBODrawState,
  TriangleGeometryVBOTileDrawState
} from "../gpuMemoryManager/vbos/TriangleGeometryVBOBatch";
import type {MatrixTexture} from "../gpuMemoryManager/dataTextures/MatrixTexture";
import type {PickFrustum} from "../pickManager/PickBounds";

type TextureLike = { texture: WebGLTexture | null } | null | undefined;
const tileMatrixScratch = new Float32Array(16);

export type DrawTechniqueGeometryBindingSamplers = {
  primitiveMeshIndex: WebGLUniformLocation | null;
  meshMatrixTexture: WebGLUniformLocation | null;
  geometryQuantRangeTexture: WebGLUniformLocation | null;
  vertexPositionTexture: WebGLUniformLocation | null;
  framePositionTexture: WebGLUniformLocation | null;
  framePositionDecodeTexture: WebGLUniformLocation | null;
  frameNormalTexture: WebGLUniformLocation | null;
  vertexColorTexture: WebGLUniformLocation | null;
  indexTexture: WebGLUniformLocation | null;
};

export type DrawTechniqueGeometryTextureBinder = (
  sampler: WebGLUniformLocation | null,
  dataTexture: TextureLike
) => void;

type DrawTechniqueGeometryBindingParams = {
  batchResources: BatchGPUResources;
  primitive: number | undefined;
  viewIndex: number;
  renderPass: RenderPassValue;
  edges: boolean;
  picking: boolean;
  snap: 0 | 1 | 2 | 3;
  thickLines: boolean;
  hasNormals: boolean;
  vboGeometry: boolean;
  vboTileUniform: boolean;
  vboViewAttributes: boolean;
  shadowFrustum?: PickFrustum | null;
  tileMatrixTexture?: MatrixTexture | null;
  setTileViewMatrix?: (matrix: Mat4) => void;
};

type DrawTechniqueGeometryBindingInspector = {
  vboGeometryTriangles(stats: {
    handledBatches?: number;
    handledPrims?: number;
  }): void;
};

/**
 * Runtime geometry binding selected for one DrawTechnique draw call.
 *
 * DTX draws bind primitive/index/position textures and use drawArrays. VBO
 * triangle/point draws bind a VAO and use drawElements, while the surrounding
 * DrawTechnique still binds shared mesh/material/view data textures.
 */
export class DrawTechniqueGeometryBinding {
  readonly kind: "dtx" | "vbo" | "vboTileUniform";
  readonly drawRange: PrimRange;
  private readonly _params: DrawTechniqueGeometryBindingParams;
  private readonly _primitiveMeshIndexTexture: TextureLike;
  private readonly _vboDrawState: TriangleGeometryVBODrawState | null;
  private _shadowInspectorRanges: PrimRange[] | null = null;
  private readonly _vboTileDrawState: {
    vao: WebGLVertexArrayObject;
    primRange: PrimRange;
    tileDrawStates: TriangleGeometryVBOTileDrawState[];
  } | null;

  private constructor(params: {
    kind: "dtx" | "vbo" | "vboTileUniform";
    drawRange: PrimRange;
    bindingParams: DrawTechniqueGeometryBindingParams;
    primitiveMeshIndexTexture?: TextureLike;
    vboDrawState?: TriangleGeometryVBODrawState | null;
    vboTileDrawState?: {
      vao: WebGLVertexArrayObject;
      primRange: PrimRange;
      tileDrawStates: TriangleGeometryVBOTileDrawState[];
    } | null;
  }) {
    this.kind = params.kind;
    this.drawRange = params.drawRange;
    this._params = params.bindingParams;
    this._primitiveMeshIndexTexture = params.primitiveMeshIndexTexture;
    this._vboDrawState = params.vboDrawState ?? null;
    this._vboTileDrawState = params.vboTileDrawState ?? null;
  }

  get inspectorRange(): PrimRange {
    return this._vboTileDrawState?.primRange ?? this._vboDrawState?.primRange ?? this.drawRange;
  }

  /** Actual shadow submissions, populated only while the inspector is enabled. */
  get inspectorRanges(): readonly PrimRange[] | null {
    return this._shadowInspectorRanges;
  }

  static resolve(params: DrawTechniqueGeometryBindingParams): DrawTechniqueGeometryBinding | null {
    const {batchResources, viewIndex, renderPass, edges, picking, snap} = params;
    const batchViewResources = batchResources.views[viewIndex];
    const primitiveMeshIndexTexture = edges
      ? batchViewResources.edgeMeshIndexTexture
      : batchViewResources.primitiveMeshIndexTexture;
    const drawRange = snap
      ? (edges
          ? batchViewResources.pickEdgePrimitiveRange
          : batchViewResources.pickPrimitiveRange)
      : (edges
          ? batchViewResources.renderPassEdgePrimitiveRanges.get(renderPass)
          : (picking
              ? batchViewResources.pickPrimitiveRange
              : batchViewResources.renderPassPrimitiveRanges.get(renderPass)));

    if (!drawRange || drawRange.numPrims === 0) {
      return null;
    }

    const useVBOGeometry = params.vboGeometry
      && (params.primitive === TrianglesPrimitive || params.primitive === PointsPrimitive)
      && !params.thickLines;

    if (useVBOGeometry) {
      if (params.vboTileUniform) {
        const vboTileDrawState = getVBOTileDrawState(params, params.vboViewAttributes ? "lean-static" : "hybrid");
        if (vboTileDrawState) {
          return new DrawTechniqueGeometryBinding({
            kind: "vboTileUniform",
            drawRange,
            bindingParams: params,
            vboTileDrawState
          });
        }
      }
      const vboDrawState = getVBODrawState(params);
      return vboDrawState
        ? new DrawTechniqueGeometryBinding({
          kind: "vbo",
          drawRange,
          bindingParams: params,
          vboDrawState
        })
        : null;
    }

    if (!hasDTXGeometryResources(params, primitiveMeshIndexTexture)) {
      return null;
    }

    return new DrawTechniqueGeometryBinding({
      kind: "dtx",
      drawRange,
      bindingParams: params,
      primitiveMeshIndexTexture
    });
  }

  bindGeometryTextures(
    samplers: DrawTechniqueGeometryBindingSamplers,
    bindTexture: DrawTechniqueGeometryTextureBinder
  ): void {
    if (this.kind !== "dtx") {
      return;
    }
    const batchResources = this._params.batchResources;
    bindTexture(samplers.primitiveMeshIndex, this._primitiveMeshIndexTexture);
    bindTexture(samplers.vertexPositionTexture, batchResources.vertexPositionTexture);
    bindTexture(samplers.framePositionTexture, batchResources.framePositionTexture);
    bindTexture(samplers.framePositionDecodeTexture, batchResources.framePositionDecodeTexture);
    bindTexture(samplers.frameNormalTexture, batchResources.frameNormalTexture);
    bindTexture(samplers.vertexColorTexture, batchResources.vertexColorTexture);
    bindTexture(samplers.meshMatrixTexture, batchResources.meshMatrixTexture);
    bindTexture(samplers.geometryQuantRangeTexture, batchResources.geometryQuantRangeTexture);
    bindTexture(
      samplers.indexTexture,
      this._params.edges
        ? batchResources.edgeIndexTexture
        : batchResources.indexTexture
    );
  }

  draw(gl: WebGL2RenderingContext, drawInspector: DrawTechniqueGeometryBindingInspector | null): SDKResult<void> {
    const {primitive, snap, edges, thickLines} = this._params;
    const drawRange = this.drawRange;

    switch (primitive) {
      case TrianglesPrimitive:
        if (this.kind === "vbo") {
          const vboDrawState = this._vboDrawState!;
          const drawMode = snap === 1
            ? gl.POINTS
            : (snap === 2 || edges)
              ? gl.LINES
              : gl.TRIANGLES;
          const {shadowFrustum, batchResources, viewIndex, renderPass, picking} = this._params;
          if (shadowFrustum && !edges && !snap && !picking) {
            const ranges = batchResources.triangleGeometryVBO?.getShadowRanges(viewIndex, renderPass);
            if (ranges) {
              this._drawShadowRanges(gl, shadowFrustum, ranges, drawInspector);
              break;
            }
          }
          gl.bindVertexArray(vboDrawState.vao);
          gl.drawElements(drawMode, vboDrawState.indexCount, gl.UNSIGNED_INT, vboDrawState.firstIndex * 4);
          gl.bindVertexArray(null);
          drawInspector?.vboGeometryTriangles({
            handledBatches: 1,
            handledPrims: vboDrawState.primRange.numPrims
          });
        } else if (this.kind === "vboTileUniform") {
          const vboTileDrawState = this._vboTileDrawState!;
          const tileMatrixTexture = this._params.tileMatrixTexture;
          const setTileViewMatrix = this._params.setTileViewMatrix;
          if (!tileMatrixTexture || !setTileViewMatrix) {
            return {
              ok: false,
              type: SDKErrorType.InvalidInput,
              error: "[DrawTechniqueGeometryBinding.draw] Missing tile matrix binding for VBO tile-uniform draw"
            };
          }
          gl.bindVertexArray(vboTileDrawState.vao);
          const drawMode = snap === 1
            ? gl.POINTS
            : (snap === 2 || edges)
              ? gl.LINES
              : gl.TRIANGLES;
          let handledPrims = 0;
          for (const tileDrawState of vboTileDrawState.tileDrawStates) {
            setTileViewMatrix(tileMatrixTexture.readMatrix(tileDrawState.tileIndex, tileMatrixScratch));
            for (const span of tileDrawState.spans) {
              gl.drawElements(drawMode, span.indexCount, gl.UNSIGNED_INT, span.firstIndex * 4);
              handledPrims += span.primCount;
            }
          }
          gl.bindVertexArray(null);
          drawInspector?.vboGeometryTriangles({
            handledBatches: 1,
            handledPrims
          });
        } else if (snap === 1) {
          // Vertex-snap rides the edge index buffer: two endpoint vertices
          // per edge, rendered as POINTS.
          gl.drawArrays(gl.POINTS, drawRange.firstPrim * 2, drawRange.numPrims * 2);
        } else if (edges && thickLines) {
          gl.drawArrays(gl.TRIANGLES, drawRange.firstPrim * 6, drawRange.numPrims * 6);
        } else if (snap === 2 || edges) {
          gl.drawArrays(gl.LINES, drawRange.firstPrim * 2, drawRange.numPrims * 2);
        } else {
          gl.drawArrays(gl.TRIANGLES, drawRange.firstPrim * 3, drawRange.numPrims * 3);
        }
        break;
      case LinesPrimitive:
        if (snap === 1) {
          gl.drawArrays(gl.POINTS, drawRange.firstPrim * 2, drawRange.numPrims * 2);
        } else if (snap === 2) {
          gl.drawArrays(gl.LINES, drawRange.firstPrim * 2, drawRange.numPrims * 2);
        } else if (thickLines) {
          gl.drawArrays(gl.TRIANGLES, drawRange.firstPrim * 6, drawRange.numPrims * 6);
        } else {
          gl.drawArrays(gl.LINES, drawRange.firstPrim * 2, drawRange.numPrims * 2);
        }
        break;
      case PointsPrimitive:
        if (this.kind === "vbo" || this.kind === "vboTileUniform") {
          if (this.kind === "vboTileUniform") {
            const vboTileDrawState = this._vboTileDrawState!;
            const tileMatrixTexture = this._params.tileMatrixTexture;
            const setTileViewMatrix = this._params.setTileViewMatrix;
            if (!tileMatrixTexture || !setTileViewMatrix) {
              return {
                ok: false,
                type: SDKErrorType.InvalidInput,
                error: "[DrawTechniqueGeometryBinding.draw] Missing tile matrix binding for VBO tile-uniform draw"
              };
            }
            gl.bindVertexArray(vboTileDrawState.vao);
            let handledPrims = 0;
            for (const tileDrawState of vboTileDrawState.tileDrawStates) {
              setTileViewMatrix(tileMatrixTexture.readMatrix(tileDrawState.tileIndex, tileMatrixScratch));
              for (const span of tileDrawState.spans) {
                gl.drawElements(gl.POINTS, span.indexCount, gl.UNSIGNED_INT, span.firstIndex * 4);
                handledPrims += span.primCount;
              }
            }
            gl.bindVertexArray(null);
            drawInspector?.vboGeometryTriangles({
              handledBatches: 1,
              handledPrims
            });
          } else {
            const vboDrawState = this._vboDrawState!;
            gl.bindVertexArray(vboDrawState.vao);
            gl.drawElements(gl.POINTS, vboDrawState.indexCount, gl.UNSIGNED_INT, vboDrawState.firstIndex * 4);
            gl.bindVertexArray(null);
            drawInspector?.vboGeometryTriangles({
              handledBatches: 1,
              handledPrims: vboDrawState.primRange.numPrims
            });
          }
        } else {
          gl.drawArrays(gl.POINTS, drawRange.firstPrim, drawRange.numPrims);
        }
        break;
      default:
        return {
          ok: false,
          type: SDKErrorType.InvalidInput,
          error: `[DrawTechniqueGeometryBinding.draw] Unsupported Batch primitive type: ${primitive}`
        };
    }

    return {ok: true, value: undefined};
  }

  private _drawShadowRanges(gl: WebGL2RenderingContext, frustum: PickFrustum, ranges: Float64Array,
                            inspector: DrawTechniqueGeometryBindingInspector | null): void {
    this._shadowInspectorRanges = inspector ? [] : null;
    let firstIndex = -1;
    let indexCount = 0;
    let handledIndices = 0;
    for (let offset = 0; offset < ranges.length; offset += 8) {
      if (!frustum.intersectsAABB(ranges, offset)) continue;
      const first = ranges[offset + 6];
      const count = ranges[offset + 7];
      if (firstIndex < 0) {
        gl.bindVertexArray(this._vboDrawState!.vao);
      } else if (firstIndex + indexCount !== first) {
        this._drawShadowSpan(gl, firstIndex, indexCount);
        indexCount = 0;
      }
      // Keep adjacent surviving groups in one draw, including tile boundaries.
      if (!indexCount) firstIndex = first;
      indexCount += count;
      handledIndices += count;
    }
    if (indexCount) {
      this._drawShadowSpan(gl, firstIndex, indexCount);
      gl.bindVertexArray(null);
    }
    inspector?.vboGeometryTriangles({handledBatches: handledIndices ? 1 : 0, handledPrims: handledIndices / 3});
  }

  private _drawShadowSpan(gl: WebGL2RenderingContext, firstIndex: number, indexCount: number): void {
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, firstIndex * 4);
    this._shadowInspectorRanges?.push({firstPrim: firstIndex / 3, numPrims: indexCount / 3});
  }
}

function getVBOTileDrawState(params: DrawTechniqueGeometryBindingParams, layout: "hybrid" | "lean-static"): {
  vao: WebGLVertexArrayObject;
  primRange: PrimRange;
  tileDrawStates: TriangleGeometryVBOTileDrawState[];
} | null {
  const {batchResources, viewIndex, renderPass, edges, picking, snap} = params;
  if (params.primitive === PointsPrimitive) {
    return (picking
      ? batchResources.triangleGeometryVBO?.getPickTileDrawStates(viewIndex, layout, "triangles", false)
      : batchResources.triangleGeometryVBO?.getTileDrawStates(viewIndex, renderPass, layout, "triangles", false)) ?? null;
  }
  const topology = (edges || snap === 1 || snap === 2) ? "edges" : "triangles";
  return (picking || snap
    ? batchResources.triangleGeometryVBO?.getPickTileDrawStates(viewIndex, layout, topology, params.hasNormals)
    : batchResources.triangleGeometryVBO?.getTileDrawStates(viewIndex, renderPass, layout, topology, params.hasNormals)) ?? null;
}

function getVBODrawState(params: DrawTechniqueGeometryBindingParams): TriangleGeometryVBODrawState | null {
  const {batchResources, viewIndex, renderPass, edges, picking, snap} = params;
  // Matrix delivery and vertex layout are independent. Batch-wide triangle
  // draws still need the same per-view colors and flags as tile-uniform draws.
  const layout = params.vboViewAttributes ? "lean-static" : "hybrid";
  const vbo = batchResources.triangleGeometryVBO;
  if (params.primitive === PointsPrimitive) {
    return (picking
      ? vbo?.getPickDrawState(viewIndex, layout, false)
      : vbo?.getDrawState(viewIndex, renderPass, layout, false)) ?? null;
  }
  const edgeTopology = edges || snap === 1 || snap === 2;
  return (picking || snap
    ? (edgeTopology
        ? vbo?.getPickEdgeDrawState(viewIndex, layout)
        : vbo?.getPickDrawState(viewIndex, layout, params.hasNormals))
    : (edgeTopology
        ? vbo?.getEdgeDrawState(viewIndex, renderPass, layout)
        : vbo?.getDrawState(viewIndex, renderPass, layout, params.hasNormals))) ?? null;
}

function hasDTXGeometryResources(
  params: DrawTechniqueGeometryBindingParams,
  primitiveMeshIndexTexture: TextureLike
): boolean {
  const batchResources = params.batchResources;
  return !!primitiveMeshIndexTexture
    && !!batchResources.vertexPositionTexture
    && !!batchResources.vertexColorTexture
    && !!batchResources.geometryQuantRangeTexture
    && !!(params.edges ? batchResources.edgeIndexTexture : batchResources.indexTexture);
}
