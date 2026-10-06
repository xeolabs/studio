import type {PickParams} from "../../../../viewer/PickParams";
import {PickResult} from "../../../../viewer/PickResult";
import {SDKInternalException, type SDKResult} from "../../../../../base/core";
import {
  createMat4Float64, lookAtMat4v, type Mat4
} from "../../../../../base/math/matrix";
import {
  addVec3, createVec2Float64, createVec3Float64,
  cross3Vec3, normalizeVec3, type Vec2, type Vec3
} from "../../../../../base/math/vector";
import {ViewRenderState} from "../ViewRenderState";
import {RenderContext} from "../RenderContext";
import {WebGLPickBuffer} from "../webGL/WebGLPickBuffer";
import {type GPUMemoryReader} from "../gpuMemoryManager/GPUMemoryReader";
import {MeshManager} from "../meshManager/MeshManager";
import {ViewManager} from "../ViewManager";
import {GPUMemoryManager} from "../gpuMemoryManager/GPUMemoryManager";
import {getDrawOps, DrawOps, putDrawOps} from "../drawOps/DrawOps";
import {SceneMesh} from "../../../../../model/scene";
import {RENDER_PASSES} from "../RENDER_PASSES";
import {GaussianSplatPickTechnique, SPLAT_PICK_SENTINEL} from "../drawOps/techniques/splats/GaussianSplatPickTechnique";
import {getEffectiveResolutionScale} from "../resolutionScale";
import {getElementCssSize} from "../../../../viewer/getElementCssSize";
import {PickFrustum} from "./PickBounds";
import {PickPosition} from "./PickPosition";

const tempVec3a = createVec3Float64();
const tempVec3b = createVec3Float64();
const tempVec3c = createVec3Float64();

const tempMat4b = createMat4Float64();

const pickTemps = {
  pickCanvasPos: createVec2Float64() as Vec2,
  pickWorldRayDir: createVec3Float64() as Vec3,
  pickWorldRayOrigin: createVec3Float64() as Vec3,
  pickViewMatrix: createMat4Float64() as Mat4,
  pickProjMatrix: createMat4Float64() as Mat4
};

/**
 *  Manages picking of objects within a {@link WebGLRenderer}.
 *
 *  Owned by a {@link ViewManager}.
 *
 *  @internal
 */
export class PickManager {

  private _pickBuffer: WebGLPickBuffer;
  private _pickResult: PickResult;
  private _renderContext: RenderContext;
  private _gpuMemoryManager: GPUMemoryManager;
  private _meshBatchManager: MeshManager;
  private _drawOps: DrawOps = null;
  private _splatPick: GaussianSplatPickTechnique | null = null;
  private readonly _pickFrustum = new PickFrustum();
  private readonly _pickPosition = new PickPosition();

  constructor(cfg: {
    renderContext: RenderContext;
    gpuMemoryManager: GPUMemoryManager;
    meshManager: MeshManager
  }) {
    this._gpuMemoryManager = cfg.gpuMemoryManager;
    this._meshBatchManager = cfg.meshManager;
    this._renderContext = cfg.renderContext;
    this._pickResult = new PickResult();
  }

  /**
   * Initializes this PickManager, allocating necessary resources. If initialization fails, an error result is returned.
   */
  init(): SDKResult<void> {
    const drawOpsResult = getDrawOps(this._renderContext, this._gpuMemoryManager as GPUMemoryReader);
    if (drawOpsResult.ok === false) {
      return drawOpsResult;
    }
    this._drawOps = drawOpsResult.value;
    this._pickBuffer = new WebGLPickBuffer(this._renderContext.gl);
    const pickBufferResult = this._pickBuffer.init();
    if (pickBufferResult.ok === false) {
      putDrawOps(this._drawOps);
      this._drawOps = null;
      this._pickBuffer = null;
      return pickBufferResult;
    }
    this._splatPick = new GaussianSplatPickTechnique(this._renderContext.gl);
    const splatPickResult = this._splatPick.init();
    if (splatPickResult.ok === false) {
      this._splatPick = null;
      return splatPickResult;
    }
    return {ok: true, value: undefined};
  }

  /**
   * Releases the splat pick technique while the context is lost, so its
   * `gl.delete*` calls are no-ops rather than errors against the restored
   * context. {@link webglContextRestored} rebuilds it.
   */
  webglContextLost(): void {
    this._splatPick?.destroy();
    this._splatPick = null;
  }

  webglContextRestored(): SDKResult<void> {
    if (!this._drawOps) {
      return {ok: true, value: undefined};
    }
    const result1 = this._drawOps.webglContextRestored();
    if (result1.ok === false) {
      return result1;
    }
    const result2 = this._pickBuffer.webglContextRestored(this._renderContext.gl);
    if (result2.ok === false) {
      return result2;
    }
    this._splatPick = new GaussianSplatPickTechnique(this._renderContext.gl);
    const result3 = this._splatPick.init();
    if (result3.ok === false) {
      this._splatPick = null;
      return result3;
    }
    return {ok: true, value: undefined};
  }

  /**
   * Picks a {@link viewing!viewer.ViewObject | ViewObject} and/or a 3D position on its surface,
   * given either canvas coordinates or a World-space ray.
   */
  pick(rendererView: ViewRenderState, pickParams: PickParams): SDKResult<PickResult> {

    if (!this._drawOps) {
      throw new SDKInternalException("[PickManager.pick] PickManager not initialized");
    }


    const view = rendererView.view;
    const camera = view.camera;

    const pickResult = this._pickResult;
    pickResult.reset();
    pickResult.view = view;

    const {
      pickCanvasPos,
      pickViewMatrix,
      pickProjMatrix,
      pickWorldRayOrigin,
      pickWorldRayDir
    } = pickTemps;

    let rayPick = false;

    if (pickParams.canvasPos) {

      // Picking at canvas coordinates

      // @ts-ignore
      pickCanvasPos.set(pickParams.canvasPos);
      // @ts-ignore
      pickViewMatrix.set(camera.viewMatrix);
      // @ts-ignore
      pickProjMatrix.set(camera.projMatrix);

      pickResult.canvasPos = pickParams.canvasPos;

    } else {

      // Picking with arbitrary World-space ray
      // Align camera along ray and fire ray through center of canvas

      rayPick = true;

      const cssSize = getElementCssSize(view.htmlElement);
      pickCanvasPos[0] = cssSize.width * 0.5;
      pickCanvasPos[1] = cssSize.height * 0.5;

      if (pickParams.rayMatrix) {

        // Ray defined as matrix

        this._gpuMemoryManager.setViewPickMatrix(view, pickParams.rayMatrix);

        // @ts-ignore
        pickViewMatrix.set(pickParams.rayMatrix);
        // @ts-ignore
        pickProjMatrix.set(camera.orthoProjection.projMatrix);

      } else {

        // Ray defined as origin and direction

        // @ts-ignore
        pickWorldRayOrigin.set(pickParams.rayOrigin || [0, 0, 0]);
        // @ts-ignore
        pickWorldRayDir.set(pickParams.rayDirection || [0, 1, 0]);

        const look = addVec3(pickWorldRayOrigin, pickWorldRayDir, tempVec3a);

        tempVec3b[0] = Math.random();
        tempVec3b[1] = Math.random();
        tempVec3b[2] = Math.random();
        normalizeVec3(tempVec3b);
        cross3Vec3(pickWorldRayDir, tempVec3b, tempVec3c);
        const rayMatrix = lookAtMat4v(pickWorldRayOrigin, look, tempVec3c, tempMat4b);

        this._gpuMemoryManager.setViewPickMatrix(view, rayMatrix);

        // @ts-ignore
        pickViewMatrix.set(rayMatrix);
        // @ts-ignore
        pickProjMatrix.set(camera.orthoProjection.projMatrix);

        pickResult.origin = pickWorldRayOrigin;
        pickResult.direction = pickWorldRayDir;
      }
    }

    const pickMeshResult = this._pickMesh({
      rendererView,
      rayPick,
      pickCanvasPos,
      pickViewMatrix,
      pickProjMatrix,
      pickInvisible: !!pickParams.pickInvisible
    });

    if (!pickMeshResult) {
      return {ok: true, value: null};
    }

    const sceneObject = pickMeshResult.sceneMesh.object;

    if (!sceneObject) {
      return {ok: true, value: null};
    }

    pickResult.sceneMesh = pickMeshResult.sceneMesh;
    pickResult.worldPos = pickMeshResult.worldPos;
    pickResult.sceneObject = sceneObject;
    pickResult.viewObject = view.objects[sceneObject.id];

    return {ok: true, value: pickResult};
  };

  private _pickMesh(
    params: {
      rendererView: ViewRenderState,
      rayPick: boolean,
      pickCanvasPos?: Vec2,
      pickViewMatrix?: Mat4,
      pickProjMatrix: Mat4,
      pickInvisible: boolean
    }
  ): {
    meshIndex: number;
    batchIndex: number;
    sceneMesh: SceneMesh;
    worldPos: Vec3;
  } | null {

    if (!this._drawOps) {
      throw new SDKInternalException("[PickManager.pick] PickManager not initialized");
    }

    const {
      rendererView,
      rayPick,
      pickCanvasPos,
      pickProjMatrix,
      pickViewMatrix,
      pickInvisible
    } = params;

    // Validate required objects
    if (!rendererView || !pickCanvasPos || !pickViewMatrix || !pickProjMatrix) {
      return null;
    }

    const view = rendererView.view;
    const viewIndex = view.viewIndex;
    const effectiveResolutionScale = getEffectiveResolutionScale(view);
    const renderContext = this._renderContext;
    const gl = renderContext.gl;
    const pickBuffer = this._pickBuffer;

    pickBuffer.bind();
    pickBuffer.clear();

    renderContext.reset();

    renderContext.activeView = view;
    renderContext.rayPicking = rayPick;
    renderContext.backfaces = true;
    renderContext.frontface = true;
    // renderContext.pickViewMatrix = pickViewMatrix;
    renderContext.pickProjMatrix = pickProjMatrix;
    renderContext.pickInvisible = !!pickInvisible;
    renderContext.pickClipPos = [
      this._getClipPosX(pickCanvasPos[0] * effectiveResolutionScale, gl.drawingBufferWidth),
      this._getClipPosY(pickCanvasPos[1] * effectiveResolutionScale, gl.drawingBufferHeight)
    ];

    gl.viewport(0, 0, 1, 1);
    const bg = rendererView.view.transparent ? [0, 0, 0, 0] : [...view.backgroundColor, 1];
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    gl.enable(gl.DEPTH_TEST);
    gl.frontFace(gl.CCW);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.lineWidth(1);
    renderContext.lineWidth = 1;

    // Two-pass pick to honour the SceneMesh.bin contract: default-bin
    // batches first, then `gl.clear(gl.DEPTH_BUFFER_BIT)` and overlay
    // batches over the top, so an overlay handle that's visually in
    // front of host geometry wins the pick even though host geometry
    // sits closer to the camera in world space.
    //
    // Overlay-bin set: `"overlay"` (the visible UI meshes — gizmo
    // handles, HUD chrome) plus `"overlayPicker"` (companion fat-
    // collider meshes that the colour render path skips but the
    // pick path still wants — so users can grab a handle when the
    // pointer lands within an inflated tolerance margin around the
    // visible mesh). Both go into the depth-cleared,
    // depthFunc(ALWAYS) re-pass.
    const isOverlayBin = (b: string | undefined): boolean =>
      b === "overlay" || b === "overlayPicker";
    const meshBatches = this._meshBatchManager.sortedBatches;
    this._pickFrustum.set(pickProjMatrix, pickViewMatrix,
      renderContext.pickClipPos[0], renderContext.pickClipPos[1], gl.drawingBufferWidth, gl.drawingBufferHeight);
    let overlayPending = false;
    // Start of a batch-draw run — clear the per-unit bound-texture tracking.
    renderContext.resetTextureBindings();
    for (let i = 0, len = meshBatches.length; i < len; i++) {
      const meshBatch = meshBatches[i];
      if (view.viewer.lodVisibility.isVariantMembershipSuppressed(view.id, meshBatch.lodVariantMemberships)) continue;
      if (!meshBatch.hasMeshesInRenderPass(viewIndex, RENDER_PASSES.PICK)) continue;
      if (isOverlayBin(meshBatch.bin)) {
        overlayPending = true;
        continue;
      }
      if (!this._pickFrustum.intersects(meshBatch.pickBounds)) continue;
      this._drawOps.prims[meshBatch.primitive]?.pick?.drawBatch(meshBatch);
    }

    // Splats live outside the mesh-batch system; draw them into the same pick
    // buffer so they occlude / are occluded by mesh geometry (shared depth).
    const splatBatch = this._meshBatchManager.getSplatBatch();
    if (splatBatch && this._splatPick && pickViewMatrix && pickProjMatrix) {
      this._splatPick.drawPick({
        view: pickViewMatrix,
        proj: pickProjMatrix,
        viewportWidth: gl.drawingBufferWidth,
        viewportHeight: gl.drawingBufferHeight,
        pickClipPos: renderContext.pickClipPos,
        splatBatch,
        sectionPlanes: view.sectionPlanesList,
      });
    }

    if (overlayPending) {
      // Force-on-top picking: depthFunc(ALWAYS) means overlay pick
      // fragments always pass the depth test, so a handle visually in
      // front of host geometry wins the pick even if the host fragment
      // is closer in world space. depthMask stays on so multiple
      // overlay batches still resolve depth between themselves (the
      // pick result indexes the nearest overlay batch / mesh).
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.depthFunc(gl.ALWAYS);
      // The splat pick above binds textures outside the tracking — clear it
      // before this second batch-draw run.
      renderContext.resetTextureBindings();
      for (let i = 0, len = meshBatches.length; i < len; i++) {
        const meshBatch = meshBatches[i];
        if (view.viewer.lodVisibility.isVariantMembershipSuppressed(view.id, meshBatch.lodVariantMemberships)) continue;
        if (!isOverlayBin(meshBatch.bin)) continue;
        if (!meshBatch.hasMeshesInRenderPass(viewIndex, RENDER_PASSES.PICK)) continue;
        this._drawOps.prims[meshBatch.primitive]?.pick?.drawBatch(meshBatch);
      }
      gl.depthFunc(gl.LEQUAL);
    }

    const {target0, target1, target2} = pickBuffer.read();

    pickBuffer.unbind();

    const batchIndex = unpackRGBA8ToUint(target0);
    const meshIndex = unpackRGBA8ToUint(target1);
    // Splats have world-space positions and do not use RTC tiles.
    if (batchIndex === SPLAT_PICK_SENTINEL) {
      const sceneMesh = this._meshBatchManager.getSplatMeshAtPickIndex(meshIndex);
      if (!sceneMesh) return null;
      const worldPos = this._pickPosition.read(target2, pickProjMatrix, pickViewMatrix, renderContext.pickClipPos);
      return worldPos ? {sceneMesh, batchIndex, meshIndex, worldPos} : null;
    }

    const sceneMesh = this._meshBatchManager.getMeshAtIndex(batchIndex, meshIndex);
    if (!sceneMesh) {
      return null;
    }

    const gpuTile = this._meshBatchManager.getMeshTile(sceneMesh);
    if (!gpuTile) {
      // TODO: Log error
      return null;
    }

    const worldPos = this._pickPosition.read(
      target2, pickProjMatrix, pickViewMatrix, renderContext.pickClipPos, gpuTile.center);
    return worldPos ? {sceneMesh, batchIndex, meshIndex, worldPos} : null;
  }

  private _getClipPosX(pos: number, size: number) {
    return 2 * (pos / size) - 1;
  }

  private _getClipPosY(pos: number, size: number) {
    return 1 - 2 * (pos / size);
  }

  /**
   * Cleans up resources used by this PickManager.
   */
  destroy() {
    if (this._drawOps) {
      putDrawOps(this._drawOps);
      this._gpuMemoryManager = null;
      this._meshBatchManager = null;
      this._renderContext = null;
      this._pickBuffer.destroy();
      this._pickBuffer = null;
      this._drawOps = null;
      this._splatPick?.destroy();
      this._splatPick = null;
    }
  }
}

function unpackRGBA8ToUint(bytes: Uint8Array<any>): number {
  return (
    (bytes[0] >>> 0) |
    ((bytes[1] << 8) >>> 0) |
    ((bytes[2] << 16) >>> 0) |
    ((bytes[3] << 24) >>> 0)
  ) >>> 0;
}
