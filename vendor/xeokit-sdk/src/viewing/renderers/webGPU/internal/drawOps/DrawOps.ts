import {GaussianSplatsPrimitive, LinesPrimitive, PointsPrimitive, TrianglesPrimitive} from "../../../../../base/constants";
import type {SDKResult} from "../../../../../base/core";
import {RENDER_PASSES} from "../RENDER_PASSES";
import type {WebGPURenderPassValue} from "../RENDER_PASSES";
import type {BindGroupLayoutManager} from "../gpuMemoryManager";
import type {RenderContext} from "../RenderContext";
import {DrawOp} from "./DrawOp";
import type {RenderPassDrawOps} from "./RenderPassDrawOps";
import {DrawTechnique} from "./DrawTechnique";
import {
  TrianglesDepthPrepassTechnique,
  TrianglesDrawColorFlatTechnique,
  TrianglesDrawColorNoNormalsTechnique,
  TrianglesDrawColorTechnique,
  TrianglesDrawEdgeColorTechnique,
  LinesDrawColorTechnique,
  LinesPickTechnique,
  SplatsDrawColorTechnique,
  SplatsPickTechnique,
  TrianglesPickTechnique,
  PointsDrawColorTechnique,
  PointsPickTechnique,
  TrianglesSectionPlaneCapTechnique,
  TrianglesShadowDepthTechnique,
  TrianglesStencilMaskTechnique,
  TrianglesSnapEdgeTechnique,
  TrianglesSnapVertexTechnique
} from "./techniques";

/**
 * Owns WebGPU draw techniques and exposes primitive/render-pass draw ops.
 *
 * This is the WebGPU counterpart to WebGL DrawOps. It keeps pass routing
 * separate from the concrete triangle, point, line, and splat techniques.
 *
 * @internal
 */
export class DrawOps {

  public prims: {
    [TrianglesPrimitive]?: RenderPassDrawOps;
    [PointsPrimitive]?: RenderPassDrawOps;
    [LinesPrimitive]?: RenderPassDrawOps;
    [GaussianSplatsPrimitive]?: RenderPassDrawOps;
  } = {};

  private readonly _renderContext: RenderContext;
  private readonly _bindGroupLayoutManager: BindGroupLayoutManager;
  private _techniques: DrawTechnique[] = [];

  constructor(params: {
    renderContext: RenderContext;
    bindGroupLayoutManager: BindGroupLayoutManager;
  }) {
    this._renderContext = params.renderContext;
    this._bindGroupLayoutManager = params.bindGroupLayoutManager;
  }

  public init(): SDKResult<void> {
    this.destroy();

    const trianglesDrawColor = this._lazyTechnique(() =>
      new TrianglesDrawColorTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const trianglesDrawColorNoNormals = this._lazyTechnique(() =>
      new TrianglesDrawColorNoNormalsTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const trianglesDrawColorFlatScene = this._lazyTechnique(() =>
      new TrianglesDrawColorFlatTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager,
        depthCompare: "less-equal",
        labelPrefix: "scene"
      })
    );
    const trianglesDrawColorFlatOverlay = this._lazyTechnique(() =>
      new TrianglesDrawColorFlatTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager,
        depthCompare: "always"
      })
    );
    const trianglesDepthPrepass = this._lazyTechnique(() =>
      new TrianglesDepthPrepassTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const trianglesShadowDepth = this._lazyTechnique(() =>
      new TrianglesShadowDepthTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const trianglesPick = this._lazyTechnique(() =>
      new TrianglesPickTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const trianglesSnapVertex = this._lazyTechnique(() =>
      new TrianglesSnapVertexTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const trianglesSnapEdge = this._lazyTechnique(() =>
      new TrianglesSnapEdgeTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const trianglesDrawEdgeColor = this._lazyTechnique(() =>
      new TrianglesDrawEdgeColorTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const trianglesSectionPlaneCap = this._lazyTechnique(() =>
      new TrianglesSectionPlaneCapTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const trianglesStencilMask = this._lazyTechnique(() =>
      new TrianglesStencilMaskTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const pointsDrawColor = this._lazyTechnique(() =>
      new PointsDrawColorTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const pointsPick = this._lazyTechnique(() =>
      new PointsPickTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const linesDrawColor = this._lazyTechnique(() =>
      new LinesDrawColorTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const linesPick = this._lazyTechnique(() =>
      new LinesPickTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const splatsDrawColor = this._lazyTechnique(() =>
      new SplatsDrawColorTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );
    const splatsPick = this._lazyTechnique(() =>
      new SplatsPickTechnique({
        renderContext: this._renderContext,
        bindGroupLayoutManager: this._bindGroupLayoutManager
      })
    );

    const triangleDrawOps: RenderPassDrawOps = {};
    this._defineLazyDrawOp(triangleDrawOps, "depthPrepass", RENDER_PASSES.DEPTH_PREPASS, trianglesDepthPrepass);
    this._defineLazyDrawOp(triangleDrawOps, "shadowDepth", RENDER_PASSES.SHADOW_DEPTH, trianglesShadowDepth);
    this._defineLazyDrawOp(triangleDrawOps, "opaque", RENDER_PASSES.OPAQUE, trianglesDrawColor);
    this._defineLazyDrawOp(triangleDrawOps, "opaqueDepthPrepassColor", RENDER_PASSES.OPAQUE_DEPTH_PREPASS_COLOR, trianglesDrawColor);
    this._defineLazyDrawOp(triangleDrawOps, "transparent", RENDER_PASSES.TRANSPARENT, trianglesDrawColor);
    this._defineLazyDrawOp(triangleDrawOps, "noNormalsOpaque", RENDER_PASSES.OPAQUE, trianglesDrawColorNoNormals);
    this._defineLazyDrawOp(triangleDrawOps, "noNormalsOpaqueDepthPrepassColor", RENDER_PASSES.OPAQUE_DEPTH_PREPASS_COLOR, trianglesDrawColorNoNormals);
    this._defineLazyDrawOp(triangleDrawOps, "noNormalsTransparent", RENDER_PASSES.TRANSPARENT, trianglesDrawColorNoNormals);
    this._defineLazyDrawOp(triangleDrawOps, "flatOpaque", RENDER_PASSES.OPAQUE, trianglesDrawColorFlatScene);
    this._defineLazyDrawOp(triangleDrawOps, "flatOpaqueDepthPrepassColor", RENDER_PASSES.OPAQUE_DEPTH_PREPASS_COLOR, trianglesDrawColorFlatScene);
    this._defineLazyDrawOp(triangleDrawOps, "flatTransparent", RENDER_PASSES.TRANSPARENT, trianglesDrawColorFlatScene);
    this._defineLazyDrawOp(triangleDrawOps, "overlayOpaque", RENDER_PASSES.OPAQUE, trianglesDrawColorFlatOverlay);
    this._defineLazyDrawOp(triangleDrawOps, "overlayTransparent", RENDER_PASSES.TRANSPARENT, trianglesDrawColorFlatOverlay);
    this._defineLazyDrawOp(triangleDrawOps, "edges", RENDER_PASSES.OPAQUE, trianglesDrawEdgeColor);
    this._defineLazyDrawOp(triangleDrawOps, "sectionPlaneCaps", RENDER_PASSES.SECTION_PLANE_CAPS, trianglesSectionPlaneCap);
    this._defineLazyDrawOp(triangleDrawOps, "stencilMaskFront", RENDER_PASSES.STENCIL_MASK_FRONT, trianglesStencilMask);
    this._defineLazyDrawOp(triangleDrawOps, "stencilMaskBack", RENDER_PASSES.STENCIL_MASK_BACK, trianglesStencilMask);
    this._defineLazyDrawOp(triangleDrawOps, "pick", RENDER_PASSES.PICK, trianglesPick);
    this._defineLazyDrawOp(triangleDrawOps, "snapVertex", RENDER_PASSES.PICK, trianglesSnapVertex);
    this._defineLazyDrawOp(triangleDrawOps, "snapEdge", RENDER_PASSES.PICK, trianglesSnapEdge);
    this.prims[TrianglesPrimitive] = triangleDrawOps;

    const pointDrawOps: RenderPassDrawOps = {};
    this._defineLazyDrawOp(pointDrawOps, "opaque", RENDER_PASSES.OPAQUE, pointsDrawColor);
    this._defineLazyDrawOp(pointDrawOps, "transparent", RENDER_PASSES.TRANSPARENT, pointsDrawColor);
    this._defineLazyDrawOp(pointDrawOps, "pick", RENDER_PASSES.PICK, pointsPick);
    this.prims[PointsPrimitive] = pointDrawOps;

    const lineDrawOps: RenderPassDrawOps = {};
    this._defineLazyDrawOp(lineDrawOps, "opaque", RENDER_PASSES.OPAQUE, linesDrawColor);
    this._defineLazyDrawOp(lineDrawOps, "transparent", RENDER_PASSES.TRANSPARENT, linesDrawColor);
    this._defineLazyDrawOp(lineDrawOps, "pick", RENDER_PASSES.PICK, linesPick);
    this.prims[LinesPrimitive] = lineDrawOps;

    const splatDrawOps: RenderPassDrawOps = {};
    this._defineLazyDrawOp(splatDrawOps, "transparent", RENDER_PASSES.TRANSPARENT, splatsDrawColor);
    this._defineLazyDrawOp(splatDrawOps, "pick", RENDER_PASSES.PICK, splatsPick);
    this.prims[GaussianSplatsPrimitive] = splatDrawOps;

    return {
      ok: true,
      value: undefined
    };
  }

  public destroy(): void {
    for (const technique of this._techniques) {
      technique.destroy();
    }
    this._techniques = [];
    this.prims = {};
  }

  private _saveForCleanup<T extends DrawTechnique>(technique: T): T {
    this._techniques.push(technique);
    return technique;
  }

  private _lazyTechnique<T extends DrawTechnique>(createTechnique: () => T): () => T {
    let technique: T | null = null;
    return () => {
      if (!technique) {
        technique = this._saveForCleanup(createTechnique());
      }
      return technique;
    };
  }

  private _defineLazyDrawOp(
    target: RenderPassDrawOps,
    key: keyof RenderPassDrawOps,
    renderPass: WebGPURenderPassValue,
    getTechnique: () => DrawTechnique
  ): void {
    let drawOp: DrawOp | null = null;
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get: () => {
        if (!drawOp) {
          drawOp = new DrawOp(getTechnique(), renderPass);
        }
        return drawOp;
      }
    });
  }
}
