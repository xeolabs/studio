import {WebGPUPluginManager} from "./plugins/WebGPUPluginManager";
import type {RendererPluginRegistry} from "../../../rendering/plugins";
import {SDKErrorType, type SDKResult} from "../../../../base/core";
import type {
  SceneGeometry,
  SceneMaterial,
  SceneMesh,
  SceneModel,
  SceneObject,
  SceneVariantSet,
  SceneTexture,
  SceneTransform
} from "../../../../model/scene";
import {
  SCENE_GEOMETRY_UPDATE_INDICES,
  SCENE_GEOMETRY_UPDATE_NORMALS_COMPRESSED,
  SCENE_GEOMETRY_UPDATE_UVS_COMPRESSED,
  SCENE_GEOMETRY_UPDATE_POSITIONS_COMPRESSED
} from "../../../../model/scene";
import type {Camera, Effect, PickParams, PickResult, View, Viewer, ViewObject} from "../../../viewer";
import type {WebGPUCanvasAlphaMode, WebGPUDeviceLike} from "../core";
import type {MemoryConfigs} from "../MemoryConfigs";
import type {WebGPUUpdateModePolicies} from "../WebGPUUpdateModePolicies";
import type {WebGPURenderConfigs} from "../WebGPURenderConfigs";
import {PickManager} from "./pickManager";
import {SnapManager} from "./snapManager";
import {BindGroupLayoutManager, GeometryBufferManager, InstanceBufferManager} from "./gpuMemoryManager";
import {RenderInspector} from "./inspectors";
import type {WebGPUMemoryStats} from "../WebGPUMemoryStats";
import {MeshManager} from "./meshManager";
import {RenderContext} from "./RenderContext";
import {FrameUniformManager, LightingManager, RenderManager, RTCTileManager} from "./renderManager";
import {ViewRenderState} from "./ViewRenderState";
import {createWebGPUInitializationStats, type WebGPUInitializationStats} from "../WebGPUInitializationStats";

const nowMs = (): number => {
  const performanceLike = (globalThis as {performance?: {now?: () => number}}).performance;
  return performanceLike?.now ? performanceLike.now() : Date.now();
};

/**
 * Top-level internal rendering coordinator owned by {@link WebGPURenderer}.
 *
 * The public renderer handles attachment, events, and device lifecycle. This
 * manager mirrors the WebGL renderer composition: it owns lifecycle routing and
 * delegates concrete GPU responsibilities to view, geometry, mesh, pipeline,
 * and render managers.
 *
 * @internal
 */
export class ViewManager {

  private _viewer: Viewer | null = null;
  private _alphaMode?: WebGPUCanvasAlphaMode;
  private _views: {[viewId: string]: ViewRenderState} = {};
  private _renderContext: RenderContext | null = null;
  private _geometryManager: GeometryBufferManager | null = null;
  private _lightingManager: LightingManager | null = null;
  private _bindGroupLayoutManager: BindGroupLayoutManager | null = null;
  private _rtcTileManager: RTCTileManager | null = null;
  private _frameUniformManager: FrameUniformManager | null = null;
  private _instanceBufferManager: InstanceBufferManager | null = null;
  private _meshManager: MeshManager | null = null;
  private _renderManager: RenderManager | null = null;
  private _plugins: WebGPUPluginManager | null = null;
  private _pickManager: PickManager | null = null;
  private _snapManager: SnapManager | null = null;
  private readonly _renderInspector = new RenderInspector();
  private _initializationStats: WebGPUInitializationStats = createWebGPUInitializationStats();
  private _existingSceneMeshesRegistrationPending = false;

  /**
   * Initializes manager state and uploads existing supported scene meshes.
   */
  public init(params: {
    viewer: Viewer;
    plugins?: RendererPluginRegistry;
    device: WebGPUDeviceLike;
    contextFormat: string;
    alphaMode?: WebGPUCanvasAlphaMode;
    memoryConfigs: MemoryConfigs;
    memoryConfigOverrides?: Partial<MemoryConfigs>;
    updateModePolicies?: WebGPUUpdateModePolicies;
    renderConfigs: WebGPURenderConfigs;
  }): SDKResult<void> {
    const initStart = nowMs();
    this._initializationStats = createWebGPUInitializationStats();
    this._viewer = params.viewer;
    this._alphaMode = params.alphaMode;
    this._renderContext = new RenderContext({
      device: params.device,
      contextFormat: params.contextFormat,
      memoryConfigs: params.memoryConfigs,
      memoryConfigOverrides: params.memoryConfigOverrides,
      updateModePolicies: params.updateModePolicies,
      renderConfigs: params.renderConfigs
    });
    this._geometryManager = new GeometryBufferManager(this._renderContext);
    this._lightingManager = new LightingManager();
    this._bindGroupLayoutManager = new BindGroupLayoutManager(this._renderContext);
    this._rtcTileManager = new RTCTileManager(this._renderContext);
    this._frameUniformManager = new FrameUniformManager({
      renderContext: this._renderContext,
      bindGroupLayoutManager: this._bindGroupLayoutManager,
      lightingManager: this._lightingManager,
      rtcTileManager: this._rtcTileManager
    });
    this._instanceBufferManager = new InstanceBufferManager(this._renderContext);
    this._meshManager = new MeshManager({
      geometryManager: this._geometryManager
    });
    if (params.plugins) this._plugins = new WebGPUPluginManager(params.viewer, params.device, this._meshManager, params.plugins, !params.renderConfigs.logDepth);
    this._snapManager = new SnapManager({
      renderContext: this._renderContext,
      meshManager: this._meshManager
    });
    this._pickManager = new PickManager({
      renderContext: this._renderContext,
      meshManager: this._meshManager,
      snapManager: this._snapManager
    });
    this._renderManager = new RenderManager({
      plugins: this._plugins,
      renderContext: this._renderContext,
      bindGroupLayoutManager: this._bindGroupLayoutManager,
      meshManager: this._meshManager,
      rtcTileManager: this._rtcTileManager,
      frameUniformManager: this._frameUniformManager,
      instanceBufferManager: this._instanceBufferManager,
      renderInspector: this._renderInspector
    });
    const renderManagerResult = this._renderManager.init();
    this._initializationStats.renderManagerInitMs = this._renderManager.getInitializationStats().renderManagerInitMs;
    if (renderManagerResult.ok === false) {
      return this._failInit(renderManagerResult);
    }

    const viewCreationStart = nowMs();
    const views = this._viewer.viewList;
    for (let i = 0, len = views.length; i < len; i++) {
      const view = views[i];
      if (!view) {
        continue;
      }
      const result = this._createView(view);
      if (result.ok === false) {
        return this._failInit(result);
      }
    }
    this._initializationStats.viewCreationMs = nowMs() - viewCreationStart;

    this._existingSceneMeshesRegistrationPending = !!this._viewer.scene?.models;

    const requestInitialRenderStart = nowMs();
    for (const viewId in this._views) {
      this._views[viewId].view.needsRender();
    }
    this._initializationStats.requestInitialRenderMs = nowMs() - requestInitialRenderStart;
    this._initializationStats.viewManagerInitMs = nowMs() - initStart;

    return {
      ok: true,
      value: undefined
    };
  }

  /**
   * Releases all WebGPU resources owned by this manager.
   */
  public destroy(): void {
    this._plugins?.destroy();
    this._plugins = null;
    this._pickManager?.destroy();
    this._snapManager?.destroy();
    this._renderManager?.destroy();
    this._meshManager?.destroyAll();
    this._geometryManager?.destroyAll();
    this._bindGroupLayoutManager?.destroy();

    for (const viewId of Object.keys(this._views)) {
      this._views[viewId].destroy();
    }

    this._views = {};
    this._renderManager = null;
    this._meshManager = null;
    this._instanceBufferManager = null;
    this._frameUniformManager = null;
    this._rtcTileManager = null;
    this._pickManager = null;
    this._snapManager = null;
    this._bindGroupLayoutManager = null;
    this._lightingManager = null;
    this._geometryManager = null;
    this._renderContext = null;
    this._viewer = null;
    this._existingSceneMeshesRegistrationPending = false;
  }

  /**
   * Registers and immediately renders a newly created View.
   */
  public viewCreated(view: View): SDKResult<void> {
    return this._createView(view);
  }

  /**
   * Renders a View that the Viewer marked dirty.
   */
  public viewUpdated(view: View): SDKResult<void> {
    if (!this._views[view.id]) {
      return this._ok();
    }
    return this._renderView(view);
  }

  /**
   * Requests a redraw after the browser resumes painting this page.
   *
   * Background tabs can delay the initial frame or canvas presentation work.
   * When the tab becomes visible, mark every managed view dirty so the normal
   * render path refreshes the canvas with current layout and scene state.
   *
   * @internal
   */
  public pageBecameVisible(): void {
    this._requestRenderAllViews();
  }

  /**
   * Releases state for a removed View.
   */
  public viewDestroyed(view: View): void {
    const viewRenderState = this._views[view.id];
    if (!viewRenderState) {
      return;
    }
    this._renderManager?.viewDestroyed(view.id);
    this._meshManager?.viewDestroyed(view);
    viewRenderState.destroy();
    delete this._views[view.id];
  }

  /**
   * Registers a newly created SceneMesh if it is supported by the current path.
   */
  public sceneMeshCreated(sceneMesh: SceneMesh): SDKResult<void> {
    if (sceneMesh.model.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneMeshCreated");
    }
    const result = meshManager.sceneMeshCreated(sceneMesh);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  /**
   * Registers meshes from a newly created SceneModel.
   */
  public sceneModelCreated(sceneModel: SceneModel): SDKResult<void> {
    if (sceneModel.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneModelCreated");
    }
    const result = meshManager.sceneModelCreated(sceneModel);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  public sceneModelSealed(sceneModel: SceneModel): SDKResult<void> {
    if (sceneModel.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneModelSealed");
    }
    const result = meshManager.sceneModelSealed(sceneModel);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  /**
   * Releases state for meshes from a destroyed SceneModel.
   */
  public sceneModelDestroyed(sceneModel: SceneModel): SDKResult<void> {
    if (sceneModel.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneModelDestroyed");
    }
    const meshes = sceneModel.meshes;
    for (const meshId in meshes) {
      this._rtcTileManager?.releaseMesh(meshes[meshId].uniqueId);
    }
    const result = meshManager.sceneModelDestroyed(sceneModel);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  /**
   * A newly created SceneGeometry is uploaded when its first renderable mesh is
   * registered.
   */
  public sceneGeometryCreated(sceneGeometry: SceneGeometry): SDKResult<void> {
    if (sceneGeometry.model.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneGeometryCreated");
    }
    return meshManager.sceneGeometryCreated(sceneGeometry);
  }

  /**
   * Releases state for a removed SceneMesh and requests a redraw.
   */
  public sceneMeshDestroyed(sceneMesh: SceneMesh): SDKResult<void> {
    if (sceneMesh.model.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneMeshDestroyed");
    }
    this._rtcTileManager?.releaseMesh(sceneMesh.uniqueId);
    const result = meshManager.sceneMeshDestroyed(sceneMesh);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  /**
   * Releases state for a removed SceneGeometry and requests a redraw.
   */
  public sceneGeometryDestroyed(sceneGeometry: SceneGeometry): SDKResult<void> {
    if (sceneGeometry.model.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneGeometryDestroyed");
    }
    const result = meshManager.sceneGeometryDestroyed(sceneGeometry);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  /**
   * Updates WebGPU buffers for meshes that reference an updated geometry.
   * Fixed-count position/index updates patch existing packed buffers when
   * possible; incompatible changes fall back to rebuilding renderer state.
   */
  public sceneGeometryUpdated(sceneGeometry: SceneGeometry): SDKResult<void> {
    if (sceneGeometry.model.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    const renderManager = this._renderManager;
    if (!meshManager) {
      return this._notInitialized("sceneGeometryUpdated");
    }
    const updateFlags = sceneGeometry.lastUpdateFlags
      & (SCENE_GEOMETRY_UPDATE_POSITIONS_COMPRESSED | SCENE_GEOMETRY_UPDATE_INDICES | SCENE_GEOMETRY_UPDATE_NORMALS_COMPRESSED | SCENE_GEOMETRY_UPDATE_UVS_COMPRESSED);
    if (updateFlags !== 0 && renderManager) {
      const fastResult = meshManager.tryFastSceneGeometryUpdated(sceneGeometry);
      if (fastResult.ok === false) {
        return fastResult;
      }
      if (fastResult.value && renderManager.updateSceneGeometry(fastResult.value, updateFlags)) {
        this._requestRenderAllViews();
        return {
          ok: true,
          value: undefined
        };
      }
    }
    const result = meshManager.sceneGeometryUpdated(sceneGeometry);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  /**
   * Registers meshes from a newly created SceneObject.
   */
  public sceneObjectCreated(sceneObject: SceneObject): SDKResult<void> {
    if (sceneObject.model.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneObjectCreated");
    }
    const result = meshManager.sceneObjectCreated(sceneObject);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  /**
   * Requests redraws after a SceneObject is destroyed.
   */
  public sceneObjectDestroyed(sceneObject: SceneObject): SDKResult<void> {
    if (sceneObject.model.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneObjectDestroyed");
    }
    const result = meshManager.sceneObjectDestroyed(sceneObject);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  /**
   * Registers a mesh newly attached to an object and requests a redraw.
   */
  public sceneObjectMeshAdded(sceneObject: SceneObject, sceneMesh: SceneMesh): SDKResult<void> {
    if (sceneObject.model.headless || sceneMesh.model.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneObjectMeshAdded");
    }
    const result = meshManager.sceneObjectMeshAdded(sceneObject, sceneMesh);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  /**
   * Requests redraws after a mesh is removed from an object.
   */
  public sceneObjectMeshRemoved(sceneObject: SceneObject, sceneMesh: SceneMesh): SDKResult<void> {
    if (sceneObject.model.headless || sceneMesh.model.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneObjectMeshRemoved");
    }
    const result = meshManager.sceneObjectMeshRemoved(sceneObject, sceneMesh);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  public sceneVariantSetCreated(variantSet: SceneVariantSet): SDKResult<void> {
    if (variantSet.model.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneVariantSetCreated");
    }
    const result = meshManager.sceneVariantSetCreated(variantSet);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  public sceneVariantSetDestroyed(variantSet: SceneVariantSet): SDKResult<void> {
    if (variantSet.model.headless) {
      return this._ok();
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("sceneVariantSetDestroyed");
    }
    const result = meshManager.sceneVariantSetDestroyed(variantSet);
    if (result.ok) {
      this._requestRenderAllViews();
    }
    return result;
  }

  /**
   * Requests redraws after scene mesh state changes.
   */
  public sceneMeshChanged(): void {
    this._requestRenderAllViews();
  }

  public sceneMeshMatrixChanged(sceneMesh: SceneMesh): void {
    if (sceneMesh.model.headless) {
      return;
    }
    this._meshManager?.sceneMeshMatrixChanged(sceneMesh);
    this._requestRenderAllViews();
  }

  public sceneMeshMoved(sceneMesh: SceneMesh): void {
    if (sceneMesh.model.headless) {
      return;
    }
    this._meshManager?.sceneMeshMoved(sceneMesh);
    this._requestRenderAllViews();
  }

  public sceneMeshColorChanged(sceneMesh: SceneMesh): void {
    if (sceneMesh.model.headless) {
      return;
    }
    this._meshManager?.sceneMeshColorChanged(sceneMesh);
    this._requestRenderAllViews();
  }

  public sceneMeshOpacityChanged(sceneMesh: SceneMesh): void {
    if (sceneMesh.model.headless) {
      return;
    }
    this._meshManager?.sceneMeshOpacityChanged(sceneMesh);
    this._requestRenderAllViews();
  }

  public sceneMeshFrameTimeChanged(sceneMesh: SceneMesh): void {
    if (sceneMesh.model.headless) {
      return;
    }
    this._meshManager?.sceneMeshFrameTimeChanged(sceneMesh);
    this._requestRenderAllViews();
  }

  public sceneMaterialPatternChanged(sceneMaterial: SceneMaterial): void {
    if (sceneMaterial.model.headless) {
      return;
    }
    this._meshManager?.sceneMaterialPatternChanged(sceneMaterial);
    this._requestRenderAllViews();
  }

  public sceneMaterialColorChanged(sceneMaterial: SceneMaterial): void {
    if (sceneMaterial.model.headless) {
      return;
    }
    this._meshManager?.sceneMaterialColorChanged(sceneMaterial);
    this._requestRenderAllViews();
  }

  public sceneMaterialEmissiveColorChanged(sceneMaterial: SceneMaterial): void {
    if (sceneMaterial.model.headless) {
      return;
    }
    this._meshManager?.sceneMaterialEmissiveColorChanged(sceneMaterial);
    this._requestRenderAllViews();
  }

  public sceneMaterialOpacityChanged(sceneMaterial: SceneMaterial): void {
    if (sceneMaterial.model.headless) {
      return;
    }
    this._meshManager?.sceneMaterialOpacityChanged(sceneMaterial);
    this._requestRenderAllViews();
  }

  public sceneTextureImageDataChanged(sceneTexture: SceneTexture): void {
    if (sceneTexture.model.headless) {
      return;
    }
    this._renderManager?.sceneTextureImageDataChanged(sceneTexture);
    this._requestRenderAllViews();
  }

  public sceneTextureUVTransformChanged(sceneTexture: SceneTexture): void {
    if (sceneTexture.model.headless) {
      return;
    }
    this._renderManager?.sceneTextureUVTransformChanged(sceneTexture);
    this._requestRenderAllViews();
  }

  public sceneTransformMatrixChanged(sceneTransform: SceneTransform): void {
    if (sceneTransform.model.headless) {
      return;
    }
    this._meshManager?.sceneTransformMatrixChanged(sceneTransform);
    this._requestRenderAllViews();
  }

  public effectCreated(effect: Effect): SDKResult<void> {
    void effect;
    return this._ok();
  }

  public effectDestroyed(effect: Effect): SDKResult<void> {
    void effect;
    return this._ok();
  }

  /**
   * Requests a redraw after a ViewObject state change affects rendering.
   */
  public viewObjectChanged(viewObject: ViewObject): void {
    if (viewObject.view.viewer !== this._viewer) {
      return;
    }
    if (!this._views[viewObject.view.id]) {
      return;
    }
    this._meshManager?.viewObjectChanged(viewObject);
    viewObject.view.needsRender();
  }

  public viewObjectVisibilityChanged(viewObject: ViewObject): void {
    this.viewObjectChanged(viewObject);
  }

  public viewObjectClippableChanged(viewObject: ViewObject): void {
    this.viewObjectChanged(viewObject);
  }

  public viewObjectCulledChanged(viewObject: ViewObject): void {
    this.viewObjectChanged(viewObject);
  }

  public viewObjectStyleBinChanged(viewObject: ViewObject, _styleBinId: string, _membership: boolean): void {
    this.viewObjectChanged(viewObject);
  }

  public sectionPlanesChanged(view: View): void {
    if (view.viewer !== this._viewer) {
      return;
    }
    if (!this._views[view.id]) {
      return;
    }
    view.needsRender();
  }

  public viewObjectColorizeChanged(viewObject: ViewObject): void {
    if (viewObject.view.viewer !== this._viewer) {
      return;
    }
    if (!this._views[viewObject.view.id]) {
      return;
    }
    this._meshManager?.viewObjectColorizeChanged(viewObject);
    viewObject.view.needsRender();
  }

  public viewObjectOpacityChanged(viewObject: ViewObject): void {
    this.viewObjectChanged(viewObject);
  }

  public viewObjectPickableChanged(viewObject: ViewObject): void {
    this.viewObjectChanged(viewObject);
  }

  public cameraViewMatrixUpdated(camera: Camera): void {
    this._meshManager?.cameraViewMatrixUpdated(camera);
  }

  public cameraProjMatrixUpdated(camera: Camera): void {
    this._meshManager?.cameraProjMatrixUpdated(camera);
  }

  /**
   * Performs renderer-backed picking for a View.
   */
  public pick(view: View, pickParams: PickParams): SDKResult<PickResult> {
    if (view.viewer !== this._viewer) {
      return {
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[ViewManager.pick] The specified View does not belong to the currently attached Viewer."
      };
    }

    const pickManager = this._pickManager;
    if (!pickManager) {
      return this._notInitialized("pick");
    }

    const sceneResult = this._flushExistingSceneMeshes();
    if (sceneResult.ok === false) {
      return sceneResult;
    }

    this._plugins?.prepareView(view);
    const ordinary = pickManager.pick(view, pickParams);
    const hit = this._plugins?.pick(view, pickParams, ordinary.ok ? ordinary.value : null);
    return hit ? {ok: true, value: hit} : ordinary;
  }

  public async pickGPUAsync(view: View, pickParams: PickParams): Promise<SDKResult<PickResult>> {
    if (view.viewer !== this._viewer) {
      return {
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[ViewManager.pickGPUAsync] The specified View does not belong to the currently attached Viewer."
      };
    }

    const pickManager = this._pickManager;
    if (!pickManager) {
      return this._notInitialized("pickGPUAsync");
    }

    const renderManager = this._renderManager;
    if (!renderManager) {
      return this._notInitialized("pickGPUAsync");
    }

    const viewRenderState = this._views[view.id];
    if (!viewRenderState) {
      return {
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[ViewManager.pickGPUAsync] View '${view.id}' is not registered with the renderer.`
      };
    }

    const sceneResult = this._flushExistingSceneMeshes();
    if (sceneResult.ok === false) {
      return sceneResult;
    }

    this._plugins?.prepareView(view);
    const ordinary = await pickManager.pickGPUAsync(
      view,
      pickParams,
      (pickBuffer, canvasPos) =>
        renderManager.pickMeshGPUAsync({
          viewRenderState,
          pickBuffer,
          canvasPos
        }),
      (snapBuffer, canvasPos) =>
        renderManager.snapVertexGPUAsync({
          viewRenderState,
          snapBuffer,
          canvasPos
        }),
      (snapBuffer, canvasPos) =>
        renderManager.snapEdgeGPUAsync({
          viewRenderState,
          snapBuffer,
          canvasPos
        })
    );
    const hit = this._plugins?.pick(view, pickParams, ordinary.ok ? ordinary.value : null);
    return hit ? {ok: true, value: hit} : ordinary;
  }

  public getRenderInspector(): RenderInspector {
    return this._renderInspector;
  }

  public getInitializationStats(): WebGPUInitializationStats {
    const renderStats = this._renderManager?.getInitializationStats();
    return {
      ...this._initializationStats,
      renderManagerInitMs: renderStats?.renderManagerInitMs ?? this._initializationStats.renderManagerInitMs,
      firstRenderViewMs: renderStats?.firstRenderViewMs ?? this._initializationStats.firstRenderViewMs
    };
  }

  public setInfiniteGridEnabled(enabled: boolean): void {
    if (!this._renderManager) {
      return;
    }
    this._renderManager.infiniteGrid.enabled = enabled;
    this._requestRenderAllViews();
  }

  public getMemoryStats(): WebGPUMemoryStats | null {
    return this._renderManager?.getMemoryStats() ?? null;
  }

  private _failInit<T>(result: SDKResult<T>): SDKResult<T> {
    this.destroy();
    return result;
  }

  private _createView(view: View): SDKResult<void> {
    if (this._views[view.id]) {
      return {
        ok: true,
        value: undefined
      };
    }

    const result = ViewRenderState.create(view, this._alphaMode);
    if (result.ok === false) {
      return result;
    }
    this._views[view.id] = result.value;

    return {
      ok: true,
      value: undefined
    };
  }

  private _registerExistingSceneMeshes(): SDKResult<void> {
    const scene = this._viewer?.scene;
    const models = scene?.models;
    if (!models) {
      return {
        ok: true,
        value: undefined
      };
    }
    const meshManager = this._meshManager;
    if (!meshManager) {
      return this._notInitialized("_registerExistingSceneMeshes");
    }
    for (const modelId in models) {
      const meshes = models[modelId]?.meshes;
      if (!meshes) {
        continue;
      }
      for (const meshId in meshes) {
        const result = meshManager.registerSceneMesh(meshes[meshId]);
        if (result.ok === false) {
          return result;
        }
      }
    }
    return {
      ok: true,
      value: undefined
    };
  }

  private _renderView(view: View): SDKResult<void> {
    if (!this._viewer?.scene) {
      return {
        ok: true,
        value: undefined
      };
    }

    if (view.viewer !== this._viewer) {
      return {
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: "[ViewManager._renderView] The specified View does not belong to the currently attached Viewer."
      };
    }

    const viewRenderState = this._views[view.id];
    if (!viewRenderState) {
      return {
        ok: false,
        type: SDKErrorType.InvalidOperation,
        error: `[ViewManager._renderView] View '${view.id}' is not registered with the renderer.`
      };
    }

    const renderManager = this._renderManager;
    if (!renderManager) {
      return this._notInitialized("_renderView");
    }

    const sceneResult = this._flushExistingSceneMeshes();
    if (sceneResult.ok === false) {
      return sceneResult;
    }

    return renderManager.renderView(viewRenderState);
  }

  private _flushExistingSceneMeshes(): SDKResult<void> {
    if (!this._existingSceneMeshesRegistrationPending) {
      return this._ok();
    }
    const sceneRegistrationStart = nowMs();
    const sceneResult = this._registerExistingSceneMeshes();
    this._initializationStats.sceneRegistrationMs += nowMs() - sceneRegistrationStart;
    if (sceneResult.ok === false) {
      return sceneResult;
    }
    this._existingSceneMeshesRegistrationPending = false;
    return this._ok();
  }

  private _requestRenderAllViews(): void {
    if (!this._viewer) {
      return;
    }
    const views = this._viewer.viewList;
    for (let i = 0, len = views.length; i < len; i++) {
      views[i]?.needsRender?.();
    }
  }

  private _ok(): SDKResult<void> {
    return {
      ok: true,
      value: undefined
    };
  }

  private _notInitialized<T>(method: string): SDKResult<T> {
    return {
      ok: false,
      type: SDKErrorType.InvalidOperation,
      error: `[ViewManager.${method}] WebGPU view manager is not initialized.`
    };
  }
}
