import type {VariantLODMode} from "./VariantLODMode";
import {CustomProjectionType, OrthoProjectionType, PerspectiveProjectionType} from "../../base/constants";
import {
  AABB3ToOBB3,
  collapseAABB3,
  createAABB3Float64,
  expandAABB3,
  getAABB3Center,
  getAABB3Diag,
  OBB3ToAABB3,
  type AABB3
} from "../../base/math/boundaries";
import {transformVec4} from "../../base/math/matrix";
import {createVec4Float64} from "../../base/math/vector";
import type {SceneModel, SceneObject, SceneVariant, SceneVariantSet} from "../../model/scene";
import type {View, Viewer} from "../viewer";
import type {LODVariantSelection} from "./LODVariantSelection";
import type {VariantLODSelectorParams} from "./VariantLODSelectorParams";

interface VariantSetState {
  variantSet: SceneVariantSet;
  selectionId: string;
  variants: LODVariantSelection[];
  center: [number, number, number];
  radius: number;
  activeByViewId: Map<string, string>;
}

const tempOBBPoint = createVec4Float64();

/**
 * Selects SceneModel variants as LODs.
 *
 * The selector consumes variant sets authored in SceneModels. It does
 * not generate shells, create meshes or mutate SceneModel content. For each
 * view, it selects one variant from each eligible variant set
 * and updates {@link LODVisibility} so renderers draw only that variant.
 * This provides a fast path for switching visibility of large object groups:
 * selection changes record the active variant per View, while renderers
 * suppress non-selected variant memberships without rewriting ordinary
 * object visibility for every object.
 *
 * A variant set is eligible when it declares:
 *
 * ```ts
 * selection: {
 *   strategy: "projectedSize"
 * }
 * ```
 *
 * Selection uses the variant `range.minPixels` and `range.maxPixels`
 * metadata. If no range matches, the set's default variant is used.
 */
export class VariantLODSelector {
  /**
   * Whether this selector is actively applying variant suppression.
   */
  public enabled: boolean;

  private readonly _viewer: Viewer;
  private readonly _subs: (() => void)[] = [];
  private readonly _sceneSubs: (() => void)[] = [];
  private readonly _states = new Map<SceneVariantSet, VariantSetState>();

  /**
   * Creates a variant LOD selector.
   *
   * @param params Selector parameters.
   */
  constructor(params: VariantLODSelectorParams) {
    this._viewer = params.viewer;
    this.enabled = params.enabled !== false;
    const events = this._viewer.events;
    this._subs.push(
      events.onCameraViewMatrixUpdated.subscribe((view) => this.updateView(view)),
      events.onCameraProjMatrixUpdated.subscribe((view) => this.updateView(view)),
      events.onCameraProjectionTypeChanged.subscribe((view) => this.updateView(view)),
      events.onViewCanvasBoundaryChanged.subscribe((view) => this.updateView(view)),
      events.onViewCreated.subscribe((_viewer, view) => this.updateView(view)),
      events.onViewDestroyed.subscribe((_viewer, view) => this.clearView(view.id)),
      events.onSceneAttached.subscribe(() => this._installScene()),
      events.onSceneDetached.subscribe(() => this._clearScene())
    );
    this._installScene();
    this.updateAllViews();
  }

  /**
   * Enables or disables the selector.
   *
   * Disabling clears only selector-owned LOD suppression. It does not mutate
   * ordinary ViewObject visibility.
   *
   * @param enabled New enabled state.
   */
  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    if (enabled) {
      this.updateAllViews();
    } else {
      this.clear();
    }
  }

  /**
   * Updates variant selection for every current view.
   */
  public updateAllViews(): void {
    const views = this._viewer.viewList;
    for (let i = 0, len = views.length; i < len; i++) {
      const view = views[i];
      if (view && !view.destroyed) {
        this.updateView(view);
      }
    }
  }

  /**
   * Updates variant selection for one view.
   *
   * @param view View to update.
   */
  public updateView(view: View): void {
    if (!this.enabled || view.destroyed) {
      return;
    }
    for (const state of this._states.values()) {
      this._updateVariantSetForView(state, view);
    }
  }

  /**
   * Gets the selected variant ID for one view and variant set.
   *
   * @param view View to inspect.
   * @param variantSet Variant set.
   * @returns Selected variant ID, or the default variant ID when
   * the selector has not selected the set in that view.
   */
  public getActiveVariantId(view: View, variantSet: SceneVariantSet): string {
    return this._states.get(variantSet)?.activeByViewId.get(view.id) ?? variantSet.defaultVariantId;
  }

  /**
   * Gets the selector mode for a variant set in one view.
   *
   * @param view View to inspect.
   * @param variantSet Variant set.
   */
  public getMode(view: View, variantSet: SceneVariantSet): VariantLODMode {
    const state = this._states.get(variantSet);
    if (!state || state.radius <= 0 || variantSet.destroyed) {
      return "invalid";
    }
    return this.getActiveVariantId(view, variantSet) === variantSet.defaultVariantId ? "default" : "selected";
  }

  /**
   * Clears all selector-owned LOD suppression state.
   */
  public clear(): void {
    for (const state of this._states.values()) {
      for (const viewId of Array.from(state.activeByViewId.keys())) {
        this._setAllUnsuppressed(viewId, state);
      }
      state.activeByViewId.clear();
    }
  }

  /**
   * Clears selector state for one view.
   *
   * @param viewId View ID.
   */
  public clearView(viewId: string): void {
    for (const state of this._states.values()) {
      this._setAllUnsuppressed(viewId, state);
      state.activeByViewId.delete(viewId);
    }
  }

  /**
   * Destroys the selector and clears its LOD suppression state.
   */
  public destroy(): void {
    this.clear();
    for (let i = 0, len = this._subs.length; i < len; i++) {
      this._subs[i]();
    }
    this._subs.length = 0;
    this._clearScene();
  }

  private _installScene(): void {
    this._clearScene();
    const scene = this._viewer.scene;
    if (!scene) {
      return;
    }
    for (const modelId in scene.models) {
      this._addModel(scene.models[modelId]);
    }
    const events = scene.events;
    this._sceneSubs.push(
      events.onSceneModelCreated.subscribe((_scene, model) => this._addModel(model)),
      events.onSceneModelDestroyed.subscribe((_scene, model) => this._removeModel(model)),
      events.onSceneVariantSetCreated.subscribe((_model, variantSet) => {
        const state = this._addVariantSet(variantSet);
        if (state) {
          this._updateStateAllViews(state);
        }
      }),
      events.onSceneVariantSetDestroyed.subscribe((_model, variantSet) => this._removeVariantSet(variantSet)),
      events.onSceneObjectDestroyed.subscribe((_scene, object) => this._removeObject(object)),
      events.onSceneObjectMeshAdded.subscribe((object) => this._refreshObject(object)),
      events.onSceneObjectMeshRemoved.subscribe((object) => this._refreshObject(object)),
      events.onSceneMeshMatrixChanged.subscribe((_scene, mesh) => mesh.object && this._refreshObject(mesh.object)),
      events.onSceneMeshMoved.subscribe((_scene, mesh) => mesh.object && this._refreshObject(mesh.object)),
      events.onSceneGeometryUpdated.subscribe((_scene, geometry) => this._refreshGeometry(geometry.id, geometry.model)),
      events.onSceneGeometryDestroyed.subscribe((_scene, geometry) => this._refreshGeometry(geometry.id, geometry.model))
    );
  }

  private _clearScene(): void {
    this.clear();
    for (let i = 0, len = this._sceneSubs.length; i < len; i++) {
      this._sceneSubs[i]();
    }
    this._sceneSubs.length = 0;
    this._states.clear();
  }

  private _addModel(model: SceneModel): void {
    for (const id in model.variantSets) {
      this._addVariantSet(model.variantSets[id]);
    }
  }

  private _removeModel(model: SceneModel): void {
    for (const state of Array.from(this._states.values())) {
      if (state.variantSet.model === model) {
        this._removeVariantSet(state.variantSet);
      }
    }
  }

  private _addVariantSet(variantSet: SceneVariantSet): VariantSetState | null {
    if (variantSet.destroyed || variantSet.selection?.strategy !== "projectedSize" || this._states.has(variantSet)) {
      return null;
    }
    const state = this._createState(variantSet);
    if (state) {
      this._states.set(variantSet, state);
      return state;
    }
    return null;
  }

  private _removeVariantSet(variantSet: SceneVariantSet): void {
    const state = this._states.get(variantSet);
    if (!state) {
      return;
    }
    for (const viewId of Array.from(state.activeByViewId.keys())) {
      this._setAllUnsuppressed(viewId, state);
    }
    this._states.delete(variantSet);
  }

  private _removeObject(object: SceneObject): void {
    const variantSets = object.model.getVariantSetsForObject(object.id);
    for (let i = 0, len = variantSets.length; i < len; i++) {
      this._removeVariantSet(variantSets[i]);
    }
  }

  private _refreshObject(object: SceneObject): void {
    const variantSets = object.model.getVariantSetsForObject(object.id);
    for (let i = 0, len = variantSets.length; i < len; i++) {
      this._refreshVariantSet(variantSets[i]);
    }
  }

  private _refreshGeometry(_geometryId: string, model: SceneModel | null): void {
    if (!model) {
      return;
    }
    for (const variantSet of Object.values(model.variantSets)) {
      this._refreshVariantSet(variantSet);
    }
  }

  private _refreshVariantSet(variantSet: SceneVariantSet): void {
    const previous = this._states.get(variantSet);
    if (!previous) {
      this._addVariantSet(variantSet);
      return;
    }
    const refreshed = this._createState(variantSet);
    if (!refreshed) {
      this._removeVariantSet(variantSet);
      return;
    }
    this._states.set(variantSet, refreshed);
    for (const viewId of Array.from(previous.activeByViewId.keys())) {
      this._viewer.lodVisibility.clearSelectedVariant(viewId, previous.selectionId);
    }
    this._updateStateAllViews(refreshed);
  }

  private _createState(variantSet: SceneVariantSet): VariantSetState | null {
    const aabb = computeVariantSetAABB(variantSet);
    if (!aabb) {
      return null;
    }
    const center = getAABB3Center(aabb, [0, 0, 0] as any) as [number, number, number];
    return {
      variantSet,
      selectionId: `${variantSet.model.id}:${variantSet.id}`,
      variants: Object.values(variantSet.variants).map((variant) => ({
        id: variant.id,
        objectIds: variant.objectIds
      })),
      center,
      radius: getAABB3Diag(aabb) * 0.5,
      activeByViewId: new Map()
    };
  }

  private _updateVariantSetForView(state: VariantSetState, view: View): void {
    if (state.radius <= 0 || state.variantSet.destroyed) {
      return;
    }
    const selectedVariantId = this._selectVariantId(state, view);
    const previousVariantId = state.activeByViewId.get(view.id);
    if (previousVariantId === selectedVariantId) {
      return;
    }
    state.activeByViewId.set(view.id, selectedVariantId);
    const changed = this._viewer.lodVisibility.setSelectedVariant(view.id, state.selectionId, state.variants, selectedVariantId);
    if (changed) {
      view.needsRender();
    }
  }

  private _updateStateAllViews(state: VariantSetState): void {
    const views = this._viewer.viewList;
    for (let i = 0, len = views.length; i < len; i++) {
      const view = views[i];
      if (view && !view.destroyed) {
        this._updateVariantSetForView(state, view);
      }
    }
  }

  private _selectVariantId(state: VariantSetState, view: View): string {
    const projectedPixels = getProjectedDiameterPixels(view, state.center, state.radius);
    if (!Number.isFinite(projectedPixels)) {
      return state.variantSet.defaultVariantId;
    }

    const previousVariantId = state.activeByViewId.get(view.id);
    if (previousVariantId) {
      const previous = state.variantSet.variants[previousVariantId];
      const hysteresisPixels = state.variantSet.selection?.hysteresisPixels ?? 0;
      if (previous && rangeContains(previous, projectedPixels, hysteresisPixels)) {
        return previous.id;
      }
    }

    for (const variant of Object.values(state.variantSet.variants)) {
      if (rangeContains(variant, projectedPixels, 0)) {
        return variant.id;
      }
    }
    return state.variantSet.defaultVariantId;
  }

  private _setAllUnsuppressed(viewId: string, state: VariantSetState): void {
    this._viewer.lodVisibility.clearSelectedVariant(viewId, state.selectionId);
  }
}

function rangeContains(variant: SceneVariant, projectedPixels: number, hysteresisPixels: number): boolean {
  const range = variant.range;
  const minPixels = range?.minPixels;
  const maxPixels = range?.maxPixels;
  if (minPixels !== undefined && projectedPixels < minPixels - hysteresisPixels) {
    return false;
  }
  if (maxPixels !== undefined && projectedPixels > maxPixels + hysteresisPixels) {
    return false;
  }
  return true;
}

function collectObjectIds(variantSet: SceneVariantSet): string[] {
  const objectIds = new Set<string>();
  for (const variant of Object.values(variantSet.variants)) {
    for (let i = 0, len = variant.objectIds.length; i < len; i++) {
      objectIds.add(variant.objectIds[i]);
    }
  }
  return Array.from(objectIds);
}

function computeVariantSetAABB(variantSet: SceneVariantSet): AABB3 | null {
  const aabb = collapseAABB3(createAABB3Float64());
  let found = false;
  for (const objectId of collectObjectIds(variantSet)) {
    const object = variantSet.model.objects[objectId];
    if (!object || object.destroyed) {
      continue;
    }
    for (let i = 0, len = object.meshes.length; i < len; i++) {
      const mesh = object.meshes[i];
      const meshAABB = mesh.geometry.aabb;
      if (!meshAABB) {
        continue;
      }
      const obb = AABB3ToOBB3(meshAABB);
      for (let j = 0; j < obb.length; j += 4) {
        const p = transformVec4(mesh.worldMatrix, [obb[j], obb[j + 1], obb[j + 2], obb[j + 3]], tempOBBPoint);
        obb[j] = p[0];
        obb[j + 1] = p[1];
        obb[j + 2] = p[2];
        obb[j + 3] = p[3];
      }
      expandAABB3(aabb, OBB3ToAABB3(obb));
      found = true;
    }
  }
  return found ? aabb : null;
}

function getProjectedDiameterPixels(view: View, center: [number, number, number], radius: number): number {
  const width = Math.max(1, Number(view.boundary?.[2] || view.htmlElement?.clientWidth || 1));
  const height = Math.max(1, Number(view.boundary?.[3] || view.htmlElement?.clientHeight || 1));
  const camera = view.camera;
  if (camera.projectionType === OrthoProjectionType) {
    const proj = camera.projMatrix as ArrayLike<number>;
    const radiusX = Math.abs(proj[0]) * radius * width * 0.5;
    const radiusY = Math.abs(proj[5]) * radius * height * 0.5;
    return Math.max(radiusX, radiusY) * 2;
  }
  if (camera.projectionType !== PerspectiveProjectionType && camera.projectionType !== CustomProjectionType) {
    return Number.POSITIVE_INFINITY;
  }
  const eye = camera.eye;
  const dx = eye[0] - center[0];
  const dy = eye[1] - center[1];
  const dz = eye[2] - center[2];
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= radius) {
    return Number.POSITIVE_INFINITY;
  }

  const viewMatrix = camera.viewMatrix as ArrayLike<number>;
  const x = center[0], y = center[1], z = center[2];
  const vx = viewMatrix[0] * x + viewMatrix[4] * y + viewMatrix[8] * z + viewMatrix[12];
  const vy = viewMatrix[1] * x + viewMatrix[5] * y + viewMatrix[9] * z + viewMatrix[13];
  const vz = viewMatrix[2] * x + viewMatrix[6] * y + viewMatrix[10] * z + viewMatrix[14];
  const vw = viewMatrix[3] * x + viewMatrix[7] * y + viewMatrix[11] * z + viewMatrix[15];
  const proj = camera.projMatrix as ArrayLike<number>;
  const clipW = proj[3] * vx + proj[7] * vy + proj[11] * vz + proj[15] * vw;
  const near = Math.max(0, Number(camera.perspectiveProjection?.near ?? 0));
  if (!Number.isFinite(clipW) || clipW <= 0 || clipW - radius <= near) {
    return Number.POSITIVE_INFINITY;
  }

  const radiusX = Math.abs(proj[0]) * radius / clipW * width * 0.5;
  const radiusY = Math.abs(proj[5]) * radius / clipW * height * 0.5;
  return Math.max(radiusX, radiusY) * 2;
}
