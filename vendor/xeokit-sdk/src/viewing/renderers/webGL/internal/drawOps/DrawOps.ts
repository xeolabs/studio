import type {GPUMemoryReader} from "../gpuMemoryManager/GPUMemoryReader";
import type {SDKResult} from "../../../../../base/core";
import {RenderContext} from "../RenderContext";
import {LinesPrimitive, PointsPrimitive, TrianglesPrimitive} from "../../../../../base/constants";
import {TrianglesDrawColorTechnique} from "./techniques/triangles/TrianglesDrawColorTechnique";
import {TrianglesDrawColorFlatTechnique} from "./techniques/triangles/TrianglesDrawColorFlatTechnique";
import {TrianglesDrawColorSAOTechnique} from "./techniques/triangles/TrianglesDrawColorSAOTechnique";
import {TrianglesDrawColorShadowTechnique} from "./techniques/triangles/TrianglesDrawColorShadowTechnique";
import {TrianglesDrawColorSAOShadowTechnique} from "./techniques/triangles/TrianglesDrawColorSAOShadowTechnique";
import {TrianglesShadowDepthTechnique} from "./techniques/triangles/TrianglesShadowDepthTechnique";
import {GenericDrawSilhouetteTechnique} from "./techniques/generic/GenericDrawSilhouetteTechnique";
import {PointsDrawColorTechnique} from "./techniques/points/PointsDrawColorTechnique";
import {PointsPickMeshTechnique} from "./techniques/points";
import {ThickLinesDrawColorTechnique} from "./techniques/lines/ThickLinesDrawColorTechnique";
import {ThickLinesPickMeshTechnique} from "./techniques/lines/ThickLinesPickMeshTechnique";
import {LinesSnapTechnique} from "./techniques/lines/LinesSnapTechnique";
import {type RenderPassDrawOps} from "./RenderPassDrawOps";
import {DrawOp} from "./DrawOp";
import {RENDER_PASSES, type RenderPassValue} from "../RENDER_PASSES";
import {TrianglesDrawEdgeSilhouetteTechnique} from "./techniques/triangles/TrianglesDrawEdgeSilhouetteTechnique";
import {DrawTechnique} from "./DrawTechnique";
import {TrianglesDrawEdgeColorTechnique} from "./techniques/triangles/TrianglesDrawEdgeColorTechnique";
import {TrianglesDrawEdgeColorThickTechnique} from "./techniques/triangles/TrianglesDrawEdgeColorThickTechnique";
import {SDKInternalException} from "../../../../../base/core";
import {TrianglesDrawSilhouetteTechnique} from "./techniques/triangles/TrianglesDrawSilhouetteTechnique";
import {GenericPickMeshTechnique} from "./techniques/generic";
import {TrianglesSnapInitTechnique} from "./techniques/triangles/TrianglesSnapInitTechnique";
import {TrianglesSnapTechnique} from "./techniques/triangles/TrianglesSnapTechnique";
import {TrianglesStencilMaskTechnique} from "./techniques/triangles/TrianglesStencilMaskTechnique";
import {TriangleSurfaceDrawOp} from "./TriangleSurfaceDrawOp";
import {TriangleGeometryStorageDrawOp} from "./TriangleGeometryStorageDrawOp";

/**
 * Owns and manages all {@link DrawTechnique} instances
 * required to render every supported primitive type across all render passes.
 *
 * ## Structure
 *
 * - One {@link DrawOps} exists per {@link WebGLRenderer} / viewer.
 * - Draw operations are organized:
 *   1. by **primitive type** (triangles, lines, points)
 *   2. then by **render pass** (opaque, transparent, style-bin, pick, etc.)
 *
 * Each leaf entry is a {@link DrawOp}, which binds a {@link DrawTechnique} to a
 * specific render pass.
 *
 * ## Usage
 *
 * To render a batch of geometry, callers retrieve the appropriate {@link DrawOp}
 * and invoke it:
 *
 * ```ts
 * drawOps.prims[primitiveType][renderPass].draw(meshBatch);
 * ```
 *
 * or, to draw a single mesh:
 *
 * ```ts
 * drawOps.prims[primitiveType][renderPass].drawMesh(meshBatch, meshIndex);
 * ```
 *
 * ## Lifecycle
 *
 * - {@link DrawTechnique} instances are created once and may be shared by multiple {@link DrawOp}s.
 * - Initialization is fail-fast: if any technique fails to initialize, all previously
 *   initialized techniques are destroyed.
 * - Techniques are reference-counted via {@link getDrawOps} / {@link putDrawOps}.
 *
 * @internal
 */

export class DrawOps {

  /**
   * Reference count used to share a single DrawOps instance across multiple users
   * within the same viewer.
   *
   * @private
   */
  public _useCount: number = 0;

  /**
   * Render context associated with this DrawOps instance.
   *
   * @private
   */
  public _renderContext: RenderContext;

  /**
   * Interface for reading GPU-resident data via data textures.
   */
  public readonly gpuMemoryReader: GPUMemoryReader;

  /**
   * All draw techniques owned by this DrawOps instance.
   *
   * Stored for initialization, context restoration, and cleanup.
   *
   * @private
   */
  private _techniques: DrawTechnique[];

  /**
   * Draw operations indexed first by primitive type, then by render pass.
   *
   * Each entry is a {@link DrawOp}, which applies a {@link DrawTechnique}
   * within a specific render pass.
   */
  prims: {
    [TrianglesPrimitive]?: RenderPassDrawOps;
    [LinesPrimitive]?: RenderPassDrawOps;
    [PointsPrimitive]?: RenderPassDrawOps;
  };

  /**
   * Initializes the draw operationa with the given rendering context and GPU memory reader interface.
   *
   * @param renderContext - The rendering context used for WebGL operations.
   * @param gpuMemoryReader - Reads GPU memory - provides data textures.
   */
  constructor(renderContext: RenderContext, gpuMemoryReader: GPUMemoryReader) {
    this._renderContext = renderContext;
    this.gpuMemoryReader = gpuMemoryReader;
    this._techniques = [];
  }

  /**
   * Initializes all draw techniques and builds the primitive/render-pass map.
   *
   * This method:
   * - Instantiates all required {@link DrawTechnique}s
   * - Initializes them in sequence
   * - Cleans up fully if any initialization step fails
   * - Constructs {@link DrawOp} wrappers for each primitive/pass combination
   *
   * @returns
   * Result indicating success or failure. Errors are emitted via
   * {@link WebGLRendererEvents.onError}.
   */

  init(): SDKResult<null> {

    const renderContext = this._renderContext;
    const gpuMemoryReader = this.gpuMemoryReader;

    this._techniques = [];

    /**
     * The draw operations grouped by primitive type, and then sub-grouped by render pass.
     */
    this.prims = {};

    const saveForCleanup = (drawTechnique: DrawTechnique): DrawTechnique => {
      this._techniques.push(drawTechnique);
      return drawTechnique;
    }

    // Some draw techniques are shared between multiple draw ops.
    // A draw op applies a draw technique to a specific render pass.

    // Logarithmic depth buffer — opt every camera-visible
    // technique (colour, edges, silhouette, lines, points) into
    // the vertex-side log-depth permutation so depth precision
    // stays usable across scenes with huge near/far ratios
    // (UTM-scale terrain + close-up BIM, archipelagos, infinite
    // landscapes). Picking / snap / shadow-depth techniques
    // deliberately stay linear — their depth read-back math
    // would have to grow a `log2` term to match.
    const LOG_DEPTH = true;

    const linesDrawSilhouette = {
      technique: saveForCleanup(new GenericDrawSilhouetteTechnique(renderContext, gpuMemoryReader, 2, {logDepth: LOG_DEPTH})),
      withFrames: saveForCleanup(new GenericDrawSilhouetteTechnique(renderContext, gpuMemoryReader, 2, {logDepth: LOG_DEPTH, hasFrames: true}))
    };
    const trianglesSilhouetteDTX = {
      technique: saveForCleanup(new TrianglesDrawSilhouetteTechnique(renderContext, gpuMemoryReader, {logDepth: LOG_DEPTH})),
      withFrames: saveForCleanup(new TrianglesDrawSilhouetteTechnique(renderContext, gpuMemoryReader, {logDepth: LOG_DEPTH, hasFrames: true}))
    };
    const trianglesStyleBinOverlayDTX = {
      technique: saveForCleanup(new TrianglesDrawSilhouetteTechnique(renderContext, gpuMemoryReader, {logDepth: LOG_DEPTH, styleBinOverlay: true})),
      withFrames: saveForCleanup(new TrianglesDrawSilhouetteTechnique(renderContext, gpuMemoryReader, {logDepth: LOG_DEPTH, styleBinOverlay: true, hasFrames: true}))
    };
    // Lambert colour techniques exist as 6-way variants on the
    // `(hasNormals, hasUVs, triplanar)` axes (`hasUVs && triplanar`
    // excluded by construction). The DrawOp picks at draw time via
    // `MeshBatch.hasNormals` / `hasUVs` / `triplanar`, so batches
    // that don't carry an attribute don't pay for shaders that
    // sample it. Each helper below returns a `DrawOpVariants`
    // object the DrawOp wires straight into its 6-slot lookup.
    //
    // `logDepth` is folded into every variant — it's a global
    // depth-precision choice, not a per-batch axis.
    const lambertVariants = <T extends new (...args: any[]) => any>(Cls: T, baseCfg: any = {}) => ({
      technique:               saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, logDepth: LOG_DEPTH})),
      withBodyHatch:           saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, bodyHatch: true, logDepth: LOG_DEPTH})),
      withNormalsBodyHatch:    saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, hasNormals: true, bodyHatch: true, logDepth: LOG_DEPTH})),
      withNormals:             saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, hasNormals: true, logDepth: LOG_DEPTH})),
      withUVs:                 saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, hasUVs: true, logDepth: LOG_DEPTH})),
      withNormalsAndUVs:       saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, hasNormals: true, hasUVs: true, logDepth: LOG_DEPTH})),
      withTriplanar:           saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, triplanar: true, logDepth: LOG_DEPTH})),
      withNormalsAndTriplanar: saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, hasNormals: true, triplanar: true, logDepth: LOG_DEPTH})),
      withFrames:              saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, hasFrames: true, logDepth: LOG_DEPTH})),
      withFramesAndNormals:    saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, hasFrames: true, hasNormals: true, logDepth: LOG_DEPTH})),
      withFramesAndUVs:        saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, hasFrames: true, hasUVs: true, logDepth: LOG_DEPTH})),
      withFramesNormalsAndUVs: saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, hasFrames: true, hasNormals: true, hasUVs: true, logDepth: LOG_DEPTH})),
      withFramesAndTriplanar:  saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, hasFrames: true, triplanar: true, logDepth: LOG_DEPTH})),
      withFramesNormalsAndTriplanar: saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...baseCfg, hasFrames: true, hasNormals: true, triplanar: true, logDepth: LOG_DEPTH})),
    });
    const frameVariant = <T extends DrawTechnique>(technique: T, Cls: new (...args: any[]) => any, cfg: any = {}) => ({
      technique,
      withFrames: saveForCleanup(new Cls(renderContext, gpuMemoryReader, {...cfg, hasFrames: true, logDepth: LOG_DEPTH}))
    });
    // Triangle indices are contiguous per batch/pass. Fetching the existing
    // RTC tile matrices in the shader keeps each range in one draw while
    // retaining per-view color/flag attributes and tile-relative precision.
    const triangleVBOCfg = {vboGeometry: true, vboViewAttributes: true};
    const pointVBOTileUniformCfg = {vboGeometry: true, vboTileUniform: true, vboViewAttributes: true};
    const trianglesDrawColorDTX          = lambertVariants(TrianglesDrawColorTechnique);
    const trianglesDrawColorSAODTX       = lambertVariants(TrianglesDrawColorSAOTechnique);
    const trianglesDrawColorShadowDTX    = lambertVariants(TrianglesDrawColorShadowTechnique);
    const trianglesDrawColorSAOShadowDTX = lambertVariants(TrianglesDrawColorSAOShadowTechnique);
    const trianglesDrawColorVBO          = lambertVariants(TrianglesDrawColorTechnique, triangleVBOCfg);
    const trianglesDrawColorSAOVBO       = lambertVariants(TrianglesDrawColorSAOTechnique, triangleVBOCfg);
    const trianglesDrawColorShadowVBO    = lambertVariants(TrianglesDrawColorShadowTechnique, triangleVBOCfg);
    const trianglesDrawColorSAOShadowVBO = lambertVariants(TrianglesDrawColorSAOShadowTechnique, triangleVBOCfg);
    const trianglesSilhouetteVBO = saveForCleanup(new TrianglesDrawSilhouetteTechnique(renderContext, gpuMemoryReader, {...triangleVBOCfg, logDepth: LOG_DEPTH}));
    const trianglesStyleBinOverlayVBO = saveForCleanup(new TrianglesDrawSilhouetteTechnique(renderContext, gpuMemoryReader, {...triangleVBOCfg, logDepth: LOG_DEPTH, styleBinOverlay: true}));
    // Unlit pure-colour technique for the overlay bin (gizmos, HUD chrome).
    // No Lambert / PBR, no SAO, no shadow — fragment colour comes straight
    // from `MeshViewAttributes.color`. Single variant (none of the
    // hasNormals / hasUVs / triplanar axes are sampled).
    const trianglesDrawColorFlatDTXBase = saveForCleanup(new TrianglesDrawColorFlatTechnique(renderContext, gpuMemoryReader, {logDepth: LOG_DEPTH}));
    const trianglesDrawColorFlatDTX = frameVariant(trianglesDrawColorFlatDTXBase, TrianglesDrawColorFlatTechnique);
    const trianglesDrawColorFlatVBO = saveForCleanup(new TrianglesDrawColorFlatTechnique(renderContext, gpuMemoryReader, {...triangleVBOCfg, logDepth: LOG_DEPTH}));
    const shadowDepthVariants = (cfg = {}) => ({
      technique: saveForCleanup(new TrianglesShadowDepthTechnique(renderContext, gpuMemoryReader, cfg)),
      withUVs: saveForCleanup(new TrianglesShadowDepthTechnique(renderContext, gpuMemoryReader, {...cfg, hasUVs: true})),
      withFrames: saveForCleanup(new TrianglesShadowDepthTechnique(renderContext, gpuMemoryReader, {...cfg, hasFrames: true})),
      withFramesAndUVs: saveForCleanup(new TrianglesShadowDepthTechnique(renderContext, gpuMemoryReader, {...cfg, hasFrames: true, hasUVs: true})),
    });
    const trianglesShadowDepthDTX = shadowDepthVariants();
    const trianglesShadowDepthVBO = shadowDepthVariants(triangleVBOCfg);
    const trianglesDrawEdgeSilhouetteDTX = frameVariant(saveForCleanup(new TrianglesDrawEdgeSilhouetteTechnique(renderContext, gpuMemoryReader, {logDepth: LOG_DEPTH})), TrianglesDrawEdgeSilhouetteTechnique);
    const trianglesDrawEdgeSilhouetteVBO = saveForCleanup(new TrianglesDrawEdgeSilhouetteTechnique(renderContext, gpuMemoryReader, {...triangleVBOCfg, logDepth: LOG_DEPTH}));
    const trianglesDrawEdgeStyleBinOverlayDTX = frameVariant(saveForCleanup(new TrianglesDrawEdgeSilhouetteTechnique(renderContext, gpuMemoryReader, {logDepth: LOG_DEPTH, styleBinOverlay: true})), TrianglesDrawEdgeSilhouetteTechnique, {styleBinOverlay: true});
    const trianglesDrawEdgeStyleBinOverlayVBO = saveForCleanup(new TrianglesDrawEdgeSilhouetteTechnique(renderContext, gpuMemoryReader, {...triangleVBOCfg, logDepth: LOG_DEPTH, styleBinOverlay: true}));
    const trianglesDrawEdgeColorDTX = frameVariant(saveForCleanup(new TrianglesDrawEdgeColorTechnique(renderContext, gpuMemoryReader, {logDepth: LOG_DEPTH})), TrianglesDrawEdgeColorTechnique);
    const trianglesDrawEdgeColorVBO = saveForCleanup(new TrianglesDrawEdgeColorTechnique(renderContext, gpuMemoryReader, {...triangleVBOCfg, logDepth: LOG_DEPTH}));
    const trianglesDrawEdgeColorThickDTX = frameVariant(saveForCleanup(new TrianglesDrawEdgeColorThickTechnique(renderContext, gpuMemoryReader, {logDepth: LOG_DEPTH})), TrianglesDrawEdgeColorThickTechnique);
    const trianglesPickMeshDTX = {
      technique: saveForCleanup(new GenericPickMeshTechnique(renderContext, gpuMemoryReader, 3)),
      withFrames: saveForCleanup(new GenericPickMeshTechnique(renderContext, gpuMemoryReader, 3, {hasFrames: true}))
    };
    const trianglesPickMeshVBO = saveForCleanup(new GenericPickMeshTechnique(renderContext, gpuMemoryReader, 3, triangleVBOCfg));
    // Thick-line pick — same quad-expansion as the colour pass,
    // so the pickable region matches what the user sees as the
    // line's body (not the 1-pixel `gl.LINES` core the legacy
    // GenericPickMeshTechnique would write).
    const linesPickMesh = {
      technique: saveForCleanup(new ThickLinesPickMeshTechnique(renderContext, gpuMemoryReader)),
      withFrames: saveForCleanup(new ThickLinesPickMeshTechnique(renderContext, gpuMemoryReader, {hasFrames: true}))
    };
    const pointsPickMeshDTX = {
      technique: saveForCleanup(new PointsPickMeshTechnique(renderContext, gpuMemoryReader)),
      withFrames: saveForCleanup(new PointsPickMeshTechnique(renderContext, gpuMemoryReader, {hasFrames: true}))
    };
    const pointsPickMeshVBO = saveForCleanup(new PointsPickMeshTechnique(renderContext, gpuMemoryReader, pointVBOTileUniformCfg));
    const linesDrawColor = frameVariant(saveForCleanup(new ThickLinesDrawColorTechnique(renderContext, gpuMemoryReader, {logDepth: LOG_DEPTH})), ThickLinesDrawColorTechnique);
    const pointsDrawColorDTX = frameVariant(saveForCleanup(new PointsDrawColorTechnique(renderContext, gpuMemoryReader, {logDepth: LOG_DEPTH})), PointsDrawColorTechnique);
    const pointsDrawColorVBO = saveForCleanup(new PointsDrawColorTechnique(renderContext, gpuMemoryReader, {...pointVBOTileUniformCfg, logDepth: LOG_DEPTH}));
    const trianglesSnapInitDTX   = {
      technique: saveForCleanup(new TrianglesSnapInitTechnique(renderContext, gpuMemoryReader)),
      withFrames: saveForCleanup(new TrianglesSnapInitTechnique(renderContext, gpuMemoryReader, {hasFrames: true}))
    };
    const trianglesSnapVertexDTX = {
      technique: saveForCleanup(new TrianglesSnapTechnique(renderContext, gpuMemoryReader, 1)),
      withFrames: saveForCleanup(new TrianglesSnapTechnique(renderContext, gpuMemoryReader, 1, {hasFrames: true}))
    };
    const trianglesSnapEdgeDTX   = {
      technique: saveForCleanup(new TrianglesSnapTechnique(renderContext, gpuMemoryReader, 2)),
      withFrames: saveForCleanup(new TrianglesSnapTechnique(renderContext, gpuMemoryReader, 2, {hasFrames: true}))
    };
    const trianglesSnapInitVBO   = saveForCleanup(new TrianglesSnapInitTechnique(renderContext, gpuMemoryReader, triangleVBOCfg));
    const trianglesSnapVertexVBO = saveForCleanup(new TrianglesSnapTechnique(renderContext, gpuMemoryReader, 1, triangleVBOCfg));
    const trianglesSnapEdgeVBO   = saveForCleanup(new TrianglesSnapTechnique(renderContext, gpuMemoryReader, 2, triangleVBOCfg));
    // Lines snap to the mathematical centerline of each line —
    // vertex snap is endpoints rasterised as POINTS, edge snap is
    // the lines rasterised as 1-pixel `gl.LINES`. The snap-radius
    // window in SnapManager catches the user's clicks anywhere
    // near the visible (quad-expanded) line body.
    const linesSnapVertex = {
      technique: saveForCleanup(new LinesSnapTechnique(renderContext, gpuMemoryReader, 1)),
      withFrames: saveForCleanup(new LinesSnapTechnique(renderContext, gpuMemoryReader, 1, {hasFrames: true}))
    };
    const linesSnapEdge   = {
      technique: saveForCleanup(new LinesSnapTechnique(renderContext, gpuMemoryReader, 2)),
      withFrames: saveForCleanup(new LinesSnapTechnique(renderContext, gpuMemoryReader, 2, {hasFrames: true}))
    };
    // Single shared stencil-mask technique reused across the
    // section-plane cap pass — RenderManager handles cull-face
    // and stencil-op flips between the two stencil writes per
    // cap plane, and uses `setCapPlaneIndex()` to pick which
    // active plane the FS is computing the mask for.
    const trianglesStencilMask = saveForCleanup(new TrianglesStencilMaskTechnique(renderContext, gpuMemoryReader));

    // Techniques compile on their first nonempty draw. A flat static scene
    // should not build shaders for textures, frames, shadows or other backends.
    renderContext.gl.getExtension("KHR_parallel_shader_compile");

    const {OPAQUE, TRANSPARENT, STYLE_BIN_OPAQUE, STYLE_BIN_TRANSPARENT, PICK, SNAP_INIT, SNAP} = RENDER_PASSES;

    // DrawOp instances are just thin wrappers around DrawTechniques for specific render passes.

    const triangleSurfaceOp = (dtxVariants: any, vboVariants: any, renderPass: RenderPassValue) => new TriangleSurfaceDrawOp({
      renderContext,
      gpuMemoryReader,
      dtxDrawOp: new DrawOp(dtxVariants, renderPass),
      vboGeometryDrawOp: new DrawOp(vboVariants, renderPass),
      renderPass
    });
    const triangleSurfaceSingleOp = (dtxTechnique: any, vboTechnique: DrawTechnique, renderPass: RenderPassValue) => new TriangleSurfaceDrawOp({
      renderContext,
      gpuMemoryReader,
      dtxDrawOp: new DrawOp(dtxTechnique, renderPass),
      vboGeometryDrawOp: new DrawOp(vboTechnique, renderPass),
      renderPass
    });
    const triangleGeometryStorageSingleOp = (dtxTechnique: any, vboTechnique: DrawTechnique, renderPass: RenderPassValue) => new TriangleGeometryStorageDrawOp({
      gpuMemoryReader,
      dtxDrawOp: new DrawOp(dtxTechnique, renderPass),
      vboGeometryDrawOp: new DrawOp(vboTechnique, renderPass),
      renderPass
    });

    const trianglesOpaqueSurface = triangleSurfaceOp(trianglesDrawColorDTX, trianglesDrawColorVBO, OPAQUE);
    const trianglesPickDTX = new DrawOp(trianglesPickMeshDTX, PICK);
    const trianglesPickVBO = new DrawOp(trianglesPickMeshVBO, PICK);

    this.prims = {

      [TrianglesPrimitive]: {
        opaque: trianglesOpaqueSurface,
        opaqueSAO: triangleSurfaceOp(trianglesDrawColorSAODTX, trianglesDrawColorSAOVBO, OPAQUE),
        opaqueShadow: triangleSurfaceOp(trianglesDrawColorShadowDTX, trianglesDrawColorShadowVBO, OPAQUE),
        opaqueSAOShadow: triangleSurfaceOp(trianglesDrawColorSAOShadowDTX, trianglesDrawColorSAOShadowVBO, OPAQUE),
        // Unlit pure-colour ops — used by the overlay-bin pass for gizmos.
        flatColor: triangleSurfaceSingleOp(trianglesDrawColorFlatDTX, trianglesDrawColorFlatVBO, OPAQUE),
        flatColorTransparent: triangleSurfaceSingleOp(trianglesDrawColorFlatDTX, trianglesDrawColorFlatVBO, TRANSPARENT),
        shadowDepth: triangleSurfaceOp(trianglesShadowDepthDTX, trianglesShadowDepthVBO, OPAQUE),
        shadowDepthTransparent: triangleSurfaceOp(trianglesShadowDepthDTX, trianglesShadowDepthVBO, TRANSPARENT),
        opaqueEdges: triangleGeometryStorageSingleOp(trianglesDrawEdgeColorDTX, trianglesDrawEdgeColorVBO, OPAQUE),
        // VBO triangle batches currently render wide edge requests with the
        // thin VBO edge path. DTX batches keep the existing quad-expanded
        // thick-edge shader.
        opaqueEdgesThick: triangleGeometryStorageSingleOp(trianglesDrawEdgeColorThickDTX, trianglesDrawEdgeColorVBO, OPAQUE),
        transparent: triangleSurfaceOp(trianglesDrawColorDTX, trianglesDrawColorVBO, TRANSPARENT),
        transparentEdges: triangleGeometryStorageSingleOp(trianglesDrawEdgeColorDTX, trianglesDrawEdgeColorVBO, TRANSPARENT),
        transparentEdgesThick: triangleGeometryStorageSingleOp(trianglesDrawEdgeColorThickDTX, trianglesDrawEdgeColorVBO, TRANSPARENT),
        styleBin: triangleSurfaceSingleOp(trianglesSilhouetteDTX, trianglesSilhouetteVBO, STYLE_BIN_OPAQUE),
        styleBinOverlay: triangleSurfaceSingleOp(trianglesStyleBinOverlayDTX, trianglesStyleBinOverlayVBO, OPAQUE),
        styleBinEdges: triangleGeometryStorageSingleOp(trianglesDrawEdgeSilhouetteDTX, trianglesDrawEdgeSilhouetteVBO, STYLE_BIN_OPAQUE),
        styleBinOverlayEdges: triangleGeometryStorageSingleOp(trianglesDrawEdgeStyleBinOverlayDTX, trianglesDrawEdgeStyleBinOverlayVBO, OPAQUE),
        styleBinTransparent: triangleSurfaceSingleOp(trianglesSilhouetteDTX, trianglesSilhouetteVBO, STYLE_BIN_TRANSPARENT),
        styleBinOverlayTransparent: triangleSurfaceSingleOp(trianglesStyleBinOverlayDTX, trianglesStyleBinOverlayVBO, TRANSPARENT),
        styleBinEdgesTransparent: triangleGeometryStorageSingleOp(trianglesDrawEdgeSilhouetteDTX, trianglesDrawEdgeSilhouetteVBO, STYLE_BIN_TRANSPARENT),
        pick: new TriangleGeometryStorageDrawOp({
          dtxDrawOp: trianglesPickDTX,
          vboGeometryDrawOp: trianglesPickVBO,
          gpuMemoryReader,
          renderPass: PICK
        }),
        // Stencil-mask uses the OPAQUE render pass to walk every
        // visible triangle batch; FS does no colour / depth
        // writes, so it doesn't matter which pass selects the
        // bin so long as we iterate the same batches the colour
        // pass did.
        stencilMask: new DrawOp(trianglesStencilMask, OPAQUE),
        snapInit: new TriangleGeometryStorageDrawOp({
          gpuMemoryReader,
          dtxDrawOp: new DrawOp(trianglesSnapInitDTX, SNAP_INIT),
          vboGeometryDrawOp: new DrawOp(trianglesSnapInitVBO, SNAP_INIT),
          renderPass: SNAP_INIT
        }),
        snapVertex: new TriangleGeometryStorageDrawOp({
          gpuMemoryReader,
          dtxDrawOp: new DrawOp(trianglesSnapVertexDTX, SNAP),
          vboGeometryDrawOp: new DrawOp(trianglesSnapVertexVBO, SNAP),
          renderPass: SNAP
        }),
        snapEdge: new TriangleGeometryStorageDrawOp({
          gpuMemoryReader,
          dtxDrawOp: new DrawOp(trianglesSnapEdgeDTX, SNAP),
          vboGeometryDrawOp: new DrawOp(trianglesSnapEdgeVBO, SNAP),
          renderPass: SNAP
        }),
      },

      [LinesPrimitive]: {
        opaque: new DrawOp(linesDrawColor, OPAQUE),
        transparent: new DrawOp(linesDrawColor, TRANSPARENT),
        styleBin: new DrawOp(linesDrawSilhouette, STYLE_BIN_OPAQUE),
        styleBinTransparent: new DrawOp(linesDrawSilhouette, STYLE_BIN_TRANSPARENT),
        pick: new DrawOp(linesPickMesh, PICK),
        // Line batches don't carry surface triangles, so they don't
        // contribute a depth baseline themselves — they rely on any
        // co-rendered triangle batches' snapInit pass for occlusion
        // testing, and on the cleared snap-FBO depth otherwise.
        // The lines themselves rasterise into the snap FBO as POINTS
        // (vertex snap) or 1-pixel LINES (edge snap).
        snapVertex: new DrawOp(linesSnapVertex, SNAP),
        snapEdge:   new DrawOp(linesSnapEdge,   SNAP),
      },

      [PointsPrimitive]: {
        opaque: new TriangleGeometryStorageDrawOp({
          gpuMemoryReader,
          dtxDrawOp: new DrawOp(pointsDrawColorDTX, OPAQUE),
          vboGeometryDrawOp: new DrawOp(pointsDrawColorVBO, OPAQUE),
          renderPass: OPAQUE
        }),
        transparent: new TriangleGeometryStorageDrawOp({
          gpuMemoryReader,
          dtxDrawOp: new DrawOp(pointsDrawColorDTX, TRANSPARENT),
          vboGeometryDrawOp: new DrawOp(pointsDrawColorVBO, TRANSPARENT),
          renderPass: TRANSPARENT
        }),
        pick: new TriangleGeometryStorageDrawOp({
          gpuMemoryReader,
          dtxDrawOp: new DrawOp(pointsPickMeshDTX, PICK),
          vboGeometryDrawOp: new DrawOp(pointsPickMeshVBO, PICK),
          renderPass: PICK
        })
      }
    };
    return {
      ok: true,
      value: null
    };
  }

  /**
   * Notifies all draw techniques that the WebGL context has been restored.
   *
   * This allows techniques to recreate GPU resources after context loss.
   *
   * @returns Result indicating success or failure.
   */
  webglContextRestored(): SDKResult<void> {
    for (let i = 0, len = this._techniques.length; i < len; i++) {
      const result = this._techniques[i].webglContextRestored();
      if (result.ok === false) {
        return result;
      }
    }
    return {
      ok: true,
      value: undefined
    };
  }

  /** @private */
  _destroy() {
    // @ts-ignore
    Object.values(this._techniques).forEach(drawTechnique => drawTechnique.destroy());
  }
}

const drawOpsInstances = {};

/**
 * Gets or creates a set of draw operations for the given RenderContext.
 *
 * @param renderContext The rendering context.
 * @param gpuMemoryReader The GPU memory reader.
 *
 * @internal
 */
export function getDrawOps(renderContext: RenderContext, gpuMemoryReader: GPUMemoryReader): SDKResult<DrawOps> {
  const viewerId = renderContext.viewer.id;
  let drawOps = drawOpsInstances[viewerId];
  if (!drawOps) {
    drawOps = new DrawOps(renderContext, gpuMemoryReader);
    const result = drawOps.init();
    if (!result.ok) {
      // DrawOps init failure cleaned up after itself
      return result;
    }
    drawOpsInstances[viewerId] = drawOps;
  }
  drawOps._useCount++;
  return {
    ok: true,
    value: drawOps
  };
}

/**
 * Releases a DrawOps, destroying it if no longer in use.
 *
 * @param drawOps The DrawOps to release.
 * @internal
 */
export function putDrawOps(drawOps: DrawOps) {
  if (drawOps._useCount === 0) {
    throw new SDKInternalException("DrawOps use count is already zero");
  }
  drawOps._useCount--;
  if (drawOps._useCount === 0) {
    const viewerId = drawOps._renderContext.viewer.id;
    delete drawOpsInstances[viewerId];
    drawOps._destroy();
  }
}
