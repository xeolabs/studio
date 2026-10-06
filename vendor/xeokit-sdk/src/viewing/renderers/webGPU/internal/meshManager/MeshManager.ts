import {GaussianSplatsPrimitive, LinesPrimitive, PointsPrimitive, SolidPrimitive, SurfacePrimitive, TrianglesPrimitive} from "../../../../../base/constants";
import {type SDKResult} from "../../../../../base/core";
import {
  createMat4Float64,
  transformPoint3,
  type Mat4
} from "../../../../../base/math/matrix";
import {createVec3Float64, type Vec3} from "../../../../../base/math/vector";
import {
  SCENE_GEOMETRY_UPDATE_INDICES,
  SCENE_GEOMETRY_UPDATE_NORMALS_COMPRESSED,
  SCENE_GEOMETRY_UPDATE_UVS_COMPRESSED,
  SCENE_GEOMETRY_UPDATE_POSITIONS_COMPRESSED,
  type SceneGeometry,
  type SceneMaterial,
  type SceneMesh,
  type SceneModel,
  type SceneObject,
  type SceneVariantSet,
  type SceneTransform
} from "../../../../../model/scene";
import type {LODVariantMembership} from "../../../../lod/LODVariantMembership";
import type {Camera, View, ViewObject} from "../../../../viewer";
import {IDENTITY_MATRIX} from "../constants";
import type {DrawItem} from "../renderState";
import {GeometryBufferManager, resolveFrameTime} from "../gpuMemoryManager";
import type {RendererMesh} from "./RendererMesh";
import {resolveMeshDrawStyle, type MeshDrawStyle} from "./resolveMeshDrawStyle";

const variantIdsByObjectCache: WeakMap<SceneVariantSet, Map<string, string[]>> = new WeakMap();

function getLODVariantMembershipsForObject(sceneObject: SceneObject | null | undefined): readonly LODVariantMembership[] {
  if (!sceneObject || sceneObject.destroyed || !sceneObject.model || sceneObject.model.destroyed || typeof sceneObject.model.getVariantSetsForObject !== "function") {
    return [];
  }
  const variantSets = sceneObject.model.getVariantSetsForObject(sceneObject.id);
  if (variantSets.length === 0) {
    return [];
  }
  const memberships: LODVariantMembership[] = [];
  for (let i = 0, len = variantSets.length; i < len; i++) {
    const variantSet = variantSets[i];
    const variantIds = getVariantIdsForObject(variantSet, sceneObject.id);
    if (variantIds.length > 0) {
      memberships.push({
        selectionId: `${variantSet.model.id}:${variantSet.id}`,
        variantIds
      });
    }
  }
  memberships.sort((a, b) => a.selectionId < b.selectionId ? -1 : a.selectionId > b.selectionId ? 1 : 0);
  return memberships;
}

function getVariantIdsForObject(variantSet: SceneVariantSet, objectId: string): readonly string[] {
  let variantIdsByObject = variantIdsByObjectCache.get(variantSet);
  if (!variantIdsByObject) {
    variantIdsByObject = new Map<string, string[]>();
    for (const variantId in variantSet.variants) {
      const objectIds = variantSet.variants[variantId].objectIds;
      for (let i = 0, len = objectIds.length; i < len; i++) {
        const id = objectIds[i];
        let variantIds = variantIdsByObject.get(id);
        if (!variantIds) {
          variantIds = [];
          variantIdsByObject.set(id, variantIds);
        }
        variantIds.push(variantId);
      }
    }
    for (const variantIds of variantIdsByObject.values()) {
      variantIds.sort();
    }
    variantIdsByObjectCache.set(variantSet, variantIdsByObject);
  }
  return variantIdsByObject.get(objectId) ?? [];
}

function createLODVariantMembershipKey(memberships: readonly LODVariantMembership[]): string {
  if (memberships.length === 0) {
    return "";
  }
  return memberships
    .map((membership) => `${membership.selectionId}:${membership.variantIds.join(",")}`)
    .join(";");
}

export interface MeshStructureChanges {
  fromVersion: number;
  toVersion: number;
  appendOnly: boolean;
  createdMeshStates: RendererMesh[];
}

export interface MeshRTCTilePlacement {
  tileIndex: number;
  center: ArrayLike<number>;
}

export interface MeshRTCTileResolver {
  assignMesh(meshId: string, worldCenter: Vec3): MeshRTCTilePlacement;
}

/**
 * Owns renderer mesh records, mesh visibility/material resolution, and
 * mesh-to-geometry links.
 *
 * @internal
 */
export class MeshManager {

  private readonly _geometryManager: GeometryBufferManager;
  private _meshStates: {[meshUniqueId: string]: RendererMesh} = {};
  private _meshStateIndices: {[meshUniqueId: string]: number} = {};
  private readonly _meshStateList: RendererMesh[] = [];
  private readonly _meshCenter: Vec3 = createVec3Float64();
  private readonly _worldMeshCenter: Vec3 = createVec3Float64();
  private readonly _viewMeshCenter: Vec3 = createVec3Float64();
  private _structureVersion = 0;
  private _instanceDataVersion = 0;
  private _lastNonAppendStructureVersion = 0;
  private readonly _createdMeshStateEvents: Array<{structureVersion: number; meshState: RendererMesh}> = [];
  private _allViewStateVersion = 0;
  private readonly _viewStateVersions: {[viewId: string]: number} = {};
  private readonly _cameraViewVersions: {[viewId: string]: number} = {};

  constructor(params: {
    geometryManager: GeometryBufferManager;
  }) {
    this._geometryManager = params.geometryManager;
  }

  public get meshStates(): RendererMesh[] {
    return this._meshStateList;
  }

  public get structureVersion(): number {
    return this._structureVersion;
  }

  public get instanceDataVersion(): number {
    return this._instanceDataVersion;
  }

  public getStructureChangesSince(structureVersion: number): MeshStructureChanges {
    if (structureVersion === this._structureVersion) {
      return {
        fromVersion: structureVersion,
        toVersion: this._structureVersion,
        appendOnly: true,
        createdMeshStates: []
      };
    }
    if (structureVersion < 0 || this._lastNonAppendStructureVersion > structureVersion) {
      return {
        fromVersion: structureVersion,
        toVersion: this._structureVersion,
        appendOnly: false,
        createdMeshStates: []
      };
    }
    const createdMeshStates: RendererMesh[] = [];
    for (let i = 0, len = this._createdMeshStateEvents.length; i < len; i++) {
      const event = this._createdMeshStateEvents[i];
      if (event.structureVersion > structureVersion) {
        createdMeshStates.push(event.meshState);
      }
    }
    return {
      fromVersion: structureVersion,
      toVersion: this._structureVersion,
      appendOnly: true,
      createdMeshStates
    };
  }

  public getViewStateVersion(view: View): number {
    return this._allViewStateVersion
      + (this._viewStateVersions[view.id] ?? 0);
  }

  public getRenderViewStateVersion(view: View): number {
    return this.getViewStateVersion(view)
      + (view.viewer?.lodVisibility?.getViewVersion(view.id) ?? 0);
  }

  public getCameraViewVersion(view: View): number {
    return this._cameraViewVersions[view.id] ?? 0;
  }

  public sceneModelCreated(sceneModel: SceneModel): SDKResult<void> {
    if (sceneModel.headless) {
      return this._ok();
    }
    const meshes = sceneModel.meshes;
    for (const meshId in meshes) {
      const result = this.registerSceneMesh(meshes[meshId], sceneModel);
      if (result.ok === false) {
        return result;
      }
    }
    return this._ok();
  }

  public sceneModelSealed(sceneModel: SceneModel): SDKResult<void> {
    if (sceneModel.headless) {
      return this._ok();
    }
    void sceneModel;
    this._markStructureDirty("non-append");
    return this._ok();
  }

  public sceneModelDestroyed(sceneModel: SceneModel): SDKResult<void> {
    const meshes = this._meshStateList
      .filter((meshState) => meshState.sceneModel === sceneModel || meshState.mesh.model === sceneModel)
      .map((meshState) => meshState.mesh);
    for (const mesh of meshes) {
      this.destroyMeshState(mesh);
    }
    return this._ok();
  }

  public sceneGeometryCreated(sceneGeometry: SceneGeometry): SDKResult<void> {
    void sceneGeometry;
    return this._ok();
  }

  public sceneGeometryDestroyed(sceneGeometry: SceneGeometry): SDKResult<void> {
    this.destroyGeometryState(sceneGeometry);
    return this._ok();
  }

  public sceneGeometryUpdated(sceneGeometry: SceneGeometry): SDKResult<void> {
    if (sceneGeometry.model.headless) {
      return this._ok();
    }
    const meshes = this._meshStateList
      .filter((meshState) => meshState.geometryState.geometry === sceneGeometry || meshState.mesh.geometry === sceneGeometry)
      .map((meshState) => meshState.mesh);

    this.destroyGeometryState(sceneGeometry);

    for (const mesh of meshes) {
      if (mesh.destroyed) {
        continue;
      }
      const result = this.registerSceneMesh(mesh);
      if (result.ok === false) {
        return result;
      }
    }

    return this._ok();
  }

  public tryFastSceneGeometryUpdated(sceneGeometry: SceneGeometry): SDKResult<RendererMesh[] | null> {
    if (sceneGeometry.model.headless) {
      return this._ok(null);
    }
    const updateFlags = sceneGeometry.lastUpdateFlags
      & (SCENE_GEOMETRY_UPDATE_POSITIONS_COMPRESSED | SCENE_GEOMETRY_UPDATE_INDICES | SCENE_GEOMETRY_UPDATE_NORMALS_COMPRESSED | SCENE_GEOMETRY_UPDATE_UVS_COMPRESSED);
    if (updateFlags === 0 || sceneGeometry.primitive === GaussianSplatsPrimitive) {
      return this._ok(null);
    }
    const meshStates = this._meshStateList
      .filter((meshState) => meshState.geometryState.geometry === sceneGeometry || meshState.mesh.geometry === sceneGeometry);
    if (meshStates.length === 0) {
      return this._ok(null);
    }
    for (let i = 0, len = meshStates.length; i < len; i++) {
      if (meshStates[i].mesh.destroyed) {
        return this._ok(null);
      }
    }
    if (!this._geometryManager.updateGeometryState(sceneGeometry, updateFlags)) {
      return this._ok(null);
    }
    return this._ok(meshStates);
  }

  public sceneMeshCreated(sceneMesh: SceneMesh): SDKResult<void> {
    if (sceneMesh.model.headless) {
      return this._ok();
    }
    return this.registerSceneMesh(sceneMesh);
  }

  public sceneMeshDestroyed(sceneMesh: SceneMesh): SDKResult<void> {
    if (sceneMesh.model.headless) {
      return this._ok();
    }
    this.destroyMeshState(sceneMesh);
    return this._ok();
  }

  public sceneObjectCreated(sceneObject: SceneObject): SDKResult<void> {
    if (sceneObject.model.headless) {
      return this._ok();
    }
    const meshes = sceneObject.meshes;
    for (let i = 0, len = meshes.length; i < len; i++) {
      const result = this.registerSceneMesh(meshes[i]);
      if (result.ok === false) {
        return result;
      }
      const meshState = this._meshStates[meshes[i].uniqueId];
      if (meshState && this._updateMeshLODVariantMembership(meshState)) {
        this._markStructureDirty("non-append");
      }
    }
    this._markAllViewStateDirty();
    return this._ok();
  }

  public sceneObjectDestroyed(sceneObject: SceneObject): SDKResult<void> {
    if (sceneObject.model.headless) {
      return this._ok();
    }
    void sceneObject;
    this._markAllViewStateDirty();
    return this._ok();
  }

  public sceneObjectMeshAdded(sceneObject: SceneObject, sceneMesh: SceneMesh): SDKResult<void> {
    if (sceneObject.model.headless || sceneMesh.model.headless) {
      return this._ok();
    }
    const result = this.registerSceneMesh(sceneMesh);
    if (result.ok) {
      const meshState = this._meshStates[sceneMesh.uniqueId];
      if (meshState && this._updateMeshLODVariantMembership(meshState)) {
        this._markStructureDirty("non-append");
      }
      void sceneObject;
      this._markAllViewStateDirty();
    }
    return result;
  }

  public sceneObjectMeshRemoved(sceneObject: SceneObject, sceneMesh: SceneMesh): SDKResult<void> {
    if (sceneObject.model.headless || sceneMesh.model.headless) {
      return this._ok();
    }
    void sceneObject;
    const meshState = this._meshStates[sceneMesh.uniqueId];
    if (meshState && this._updateMeshLODVariantMembership(meshState)) {
      this._markStructureDirty("non-append");
    }
    this._markAllViewStateDirty();
    return this._ok();
  }

  public sceneVariantSetCreated(variantSet: SceneVariantSet): SDKResult<void> {
    if (variantSet.model.headless) {
      return this._ok();
    }
    this._updateVariantSetMeshMemberships(variantSet);
    return this._ok();
  }

  public sceneVariantSetDestroyed(variantSet: SceneVariantSet): SDKResult<void> {
    if (variantSet.model.headless) {
      return this._ok();
    }
    this._updateVariantSetMeshMemberships(variantSet);
    return this._ok();
  }

  public sceneMeshMatrixChanged(sceneMesh: SceneMesh): void {
    if (sceneMesh.model.headless) {
      return;
    }
    const meshState = this._meshStates[sceneMesh.uniqueId];
    if (!meshState) {
      return;
    }
    meshState.matrixDirty = true;
    this._markMeshInstanceDataDirty(meshState);
  }

  public sceneMeshMoved(sceneMesh: SceneMesh): void {
    this.sceneMeshMatrixChanged(sceneMesh);
  }

  public sceneMeshColorChanged(sceneMesh: SceneMesh): void {
    const meshState = this._meshStates[sceneMesh.uniqueId];
    if (meshState) {
      this._markMeshInstanceDataDirty(meshState);
    }
  }

  public sceneMeshOpacityChanged(sceneMesh: SceneMesh): void {
    const meshState = this._meshStates[sceneMesh.uniqueId];
    if (meshState) {
      this._markMeshInstanceDataDirty(meshState);
    }
  }

  public sceneMeshFrameTimeChanged(sceneMesh: SceneMesh): void {
    const meshState = this._meshStates[sceneMesh.uniqueId];
    if (meshState) {
      this._markMeshInstanceDataDirty(meshState);
    }
  }

  public sceneMaterialPatternChanged(sceneMaterial: SceneMaterial): void {
    this._markMaterialMeshesDirty(sceneMaterial);
  }

  public sceneMaterialColorChanged(sceneMaterial: SceneMaterial): void {
    this._markMaterialMeshesDirty(sceneMaterial);
  }

  public sceneMaterialEmissiveColorChanged(sceneMaterial: SceneMaterial): void {
    this._markMaterialMeshesDirty(sceneMaterial);
  }

  public sceneMaterialOpacityChanged(sceneMaterial: SceneMaterial): void {
    this._markMaterialMeshesDirty(sceneMaterial);
  }

  public sceneTransformMatrixChanged(sceneTransform: SceneTransform): void {
    void sceneTransform;
    for (let i = 0, len = this._meshStateList.length; i < len; i++) {
      const meshState = this._meshStateList[i];
      meshState.matrixDirty = true;
      this._markMeshInstanceDataDirty(meshState, false);
    }
    this._markInstanceDataDirty();
  }

  public viewObjectChanged(viewObject: ViewObject): void {
    const view = this._getViewObjectView(viewObject);
    if (!view) {
      return;
    }
    this._viewStateVersions[view.id] = (this._viewStateVersions[view.id] ?? 0) + 1;
  }

  public viewObjectColorizeChanged(viewObject: ViewObject): void {
    this._markViewObjectMeshesInstanceDataDirty(viewObject);
  }

  public viewStateChanged(view: View): void {
    this._viewStateVersions[view.id] = (this._viewStateVersions[view.id] ?? 0) + 1;
  }

  public cameraViewMatrixUpdated(camera: Camera): void {
    const view = camera.view;
    if (!view) {
      return;
    }
    this._cameraViewVersions[view.id] = (this._cameraViewVersions[view.id] ?? 0) + 1;
  }

  public cameraProjMatrixUpdated(camera: Camera): void {
    this.cameraViewMatrixUpdated(camera);
  }

  public viewDestroyed(view: View): void {
    delete this._viewStateVersions[view.id];
    delete this._cameraViewVersions[view.id];
    for (const mesh of this._meshStateList) {
      if (mesh.representationViews) delete mesh.representationViews[view.id];
    }
  }

  /** Allocate ordinary state lazily, retaining it across representation ownership changes. */
  public routeRepresentation(mesh: SceneMesh, view: View, ordinary: boolean): void {
    if (ordinary) this.registerSceneMesh(mesh, null, true);
    const state = this._meshStates[mesh.uniqueId];
    if (!state) return;
    state.representationViews ??= {};
    if (state.representationViews[view.id] !== ordinary) {
      state.representationViews[view.id] = ordinary;
      this.viewStateChanged(view);
    }
  }

  public restoreOrdinaryMesh(mesh: SceneMesh): void {
    this.registerSceneMesh(mesh, null, true);
    const state = this._meshStates[mesh.uniqueId];
    if (state) state.representationViews = undefined;
    this._markAllViewStateDirty();
  }

  public registerSceneMesh(sceneMesh: SceneMesh, sceneModel: SceneModel | null = null, allowRepresentation = false): SDKResult<void> {
    // Resolve ownership per View before allocating ordinary GPU batches.
    if (sceneMesh.replacesGeometry && !allowRepresentation) return this._ok();
    if (sceneMesh.model.headless || sceneModel?.headless) {
      return this._ok();
    }
    if (this._meshStates[sceneMesh.uniqueId]) {
      return {
        ok: true,
        value: undefined
      };
    }
    if (!this.isRenderableMesh(sceneMesh)) {
      return {
        ok: true,
        value: undefined
      };
    }

    const geometryResult = this._geometryManager.getOrCreateGeometryState(sceneMesh.geometry);
    if (geometryResult.ok === false) {
      return geometryResult;
    }

    geometryResult.value.numMeshes++;
    const lodVariantMemberships = getLODVariantMembershipsForObject(sceneMesh.object);
    const meshState = {
      mesh: sceneMesh,
      sceneModel: sceneModel ?? sceneMesh.model ?? null,
      geometryState: geometryResult.value,
      worldMatrix: createMat4Float64(),
      matrixDirty: true,
      packedVertexStart: 0,
      instanceDataVersion: 0,
      createdStructureVersion: this._structureVersion + 1,
      lodVariantMemberships,
      lodVariantMembershipKey: createLODVariantMembershipKey(lodVariantMemberships)
    };
    this._meshStates[sceneMesh.uniqueId] = meshState;
    this._meshStateIndices[sceneMesh.uniqueId] = this._meshStateList.length;
    this._meshStateList.push(meshState);
    this._markStructureDirty("append", meshState);

    return {
      ok: true,
      value: undefined
    };
  }

  public destroyMeshState(sceneMesh: SceneMesh): void {
    const meshState = this._meshStates[sceneMesh.uniqueId];
    if (!meshState) {
      return;
    }

    const index = this._meshStateIndices[sceneMesh.uniqueId];
    const lastIndex = this._meshStateList.length - 1;
    const last = this._meshStateList[lastIndex];
    if (index !== lastIndex) {
      this._meshStateList[index] = last;
      this._meshStateIndices[last.mesh.uniqueId] = index;
    }
    this._meshStateList.pop();
    delete this._meshStates[sceneMesh.uniqueId];
    delete this._meshStateIndices[sceneMesh.uniqueId];
    this._markStructureDirty("non-append");

    const geometryState = meshState.geometryState;
    geometryState.numMeshes = Math.max(0, geometryState.numMeshes - 1);
    if (geometryState.numMeshes === 0) {
      this._geometryManager.destroyGeometryState(geometryState.geometry);
    }
  }

  public destroyGeometryState(sceneGeometry: SceneGeometry): void {
    const meshes = this._meshStateList
      .filter((meshState) => meshState.geometryState.geometry === sceneGeometry || meshState.mesh.geometry === sceneGeometry)
      .map((meshState) => meshState.mesh);
    for (const mesh of meshes) {
      this.destroyMeshState(mesh);
    }
    this._geometryManager.destroyGeometryState(sceneGeometry);
  }

  public destroyAll(): void {
    for (const meshUniqueId of Object.keys(this._meshStates)) {
      this.destroyMeshState(this._meshStates[meshUniqueId].mesh);
    }
    this._meshStates = {};
    this._meshStateIndices = {};
    this._meshStateList.length = 0;
    this._markStructureDirty("non-append");
  }

  public isRenderableMesh(sceneMesh: SceneMesh): boolean {
    if (!sceneMesh || sceneMesh.destroyed) {
      return false;
    }
    if (sceneMesh.model.headless) {
      return false;
    }
    const geometry = sceneMesh.geometry;
    if (!geometry || geometry.destroyed) {
      return false;
    }
    return (
      geometry.primitive === TrianglesPrimitive ||
      geometry.primitive === SolidPrimitive ||
      geometry.primitive === SurfacePrimitive ||
      geometry.primitive === LinesPrimitive ||
      geometry.primitive === PointsPrimitive ||
      geometry.primitive === GaussianSplatsPrimitive
    );
  }

  public isMeshVisibleInView(meshState: RendererMesh, view: View): boolean {
    if (meshState.mesh.replacesGeometry && !meshState.representationViews?.[view.id]) return false;
    if (!this.isRenderableMesh(meshState.mesh)) {
      return false;
    }

    const viewObject = this._getViewObject(meshState.mesh, view);
    const sceneObject = meshState.mesh.object;
    const lodVisibility = view.viewer?.lodVisibility;
    if (sceneObject && lodVisibility?.isSuppressed(view.id, sceneObject.id)) {
      return false;
    }
    if (lodVisibility?.isVariantMembershipSuppressed(view.id, meshState.lodVariantMemberships)) {
      return false;
    }
    return !viewObject || (viewObject.visible && !viewObject.culled);
  }

  public isMeshPickableInView(meshState: RendererMesh, view: View, pickInvisible: boolean): boolean {
    if (meshState.mesh.replacesGeometry && !meshState.representationViews?.[view.id]) return false;
    if (!this.isRenderableMesh(meshState.mesh)) {
      return false;
    }

    const viewObject = this._getViewObject(meshState.mesh, view);
    const sceneObject = meshState.mesh.object;
    const lodVisibility = view.viewer?.lodVisibility;
    if (sceneObject && lodVisibility?.isSuppressed(view.id, sceneObject.id)) {
      return false;
    }
    if (lodVisibility?.isVariantMembershipSuppressed(view.id, meshState.lodVariantMemberships)) {
      return false;
    }
    if (viewObject?.pickable === false) {
      return false;
    }
    return pickInvisible || !viewObject || (viewObject.visible && !viewObject.culled);
  }

  public isLODVariantMembershipSuppressedInView(memberships: readonly LODVariantMembership[] | null | undefined, view: View): boolean {
    return view.viewer?.lodVisibility?.isVariantMembershipSuppressed(view.id, memberships) === true;
  }

  public getMeshOpacityInView(meshState: RendererMesh, view: View): number {
    return this.getMeshDrawStyleInView(meshState, view).opacity;
  }

  public getMeshDrawStyleInView(meshState: RendererMesh, view: View): MeshDrawStyle {
    return resolveMeshDrawStyle(meshState.mesh, view, this._getViewObject(meshState.mesh, view));
  }

  public isMeshClippableInView(meshState: RendererMesh, view: View): boolean {
    return this._getViewObject(meshState.mesh, view)?.clippable !== false;
  }

  public getMeshViewDepth(meshState: RendererMesh, view: View): number {
    const aabb = meshState.geometryState.renderAABB;
    if (!aabb) {
      return 0;
    }

    this._meshCenter[0] = (aabb[0] + aabb[3]) * 0.5;
    this._meshCenter[1] = (aabb[1] + aabb[4]) * 0.5;
    this._meshCenter[2] = (aabb[2] + aabb[5]) * 0.5;

    this._ensureMeshMatrices(meshState);
    const worldMatrix = meshState.worldMatrix;
    const viewMatrix = (view.camera?.viewMatrix ?? IDENTITY_MATRIX) as Mat4;
    transformPoint3(worldMatrix, this._meshCenter, this._worldMeshCenter);
    transformPoint3(viewMatrix, this._worldMeshCenter, this._viewMeshCenter);
    return this._viewMeshCenter[2];
  }

  public getMeshWorldMatrix(meshState: RendererMesh): Mat4 {
    this._ensureMeshMatrices(meshState);
    return meshState.worldMatrix;
  }

  public writeInstanceData(
    drawItem: DrawItem,
    view: View,
    target: Float32Array,
    targetOffset: number,
    rtcTileResolver?: MeshRTCTileResolver
  ): void {
    const meshState = drawItem.meshState;
    const viewObject = this._getViewObject(meshState.mesh, view);
    const style = drawItem.style ?? this.getMeshDrawStyleInView(meshState, view);
    const color = style.color;

    this._ensureMeshMatrices(meshState);

    const rtcTile = rtcTileResolver
      ? rtcTileResolver.assignMesh(meshState.mesh.uniqueId, this._getMeshWorldCenter(meshState))
      : null;
    for (let i = 0; i < 16; i++) {
      target[targetOffset + i] = meshState.worldMatrix[i];
    }
    if (rtcTile) {
      target[targetOffset + 12] = meshState.worldMatrix[12] - rtcTile.center[0];
      target[targetOffset + 13] = meshState.worldMatrix[13] - rtcTile.center[1];
      target[targetOffset + 14] = meshState.worldMatrix[14] - rtcTile.center[2];
    }
    target[targetOffset + 16] = color[0];
    target[targetOffset + 17] = color[1];
    target[targetOffset + 18] = color[2];
    target[targetOffset + 19] = drawItem.opacity;
    target[targetOffset + 20] = viewObject?.clippable === false ? 0 : 1;
    target[targetOffset + 21] = rtcTile?.tileIndex ?? 0;
    target[targetOffset + 22] = meshState.mesh.billboard === "spherical" ? 1 : 0;
    target[targetOffset + 23] = 0;
    writeNormalMatrixRows(meshState.worldMatrix, target, targetOffset + 24);
    const frameState = resolveFrameTime(meshState.geometryState, meshState.mesh.frameTime);
    target[targetOffset + 36] = frameState.frameAOffset;
    target[targetOffset + 37] = frameState.frameBOffset;
    target[targetOffset + 38] = frameState.factor;
    target[targetOffset + 39] = frameState.flags;
    target[targetOffset + 40] = frameState.frameADecodeIndex;
    target[targetOffset + 41] = frameState.frameBDecodeIndex;
    target[targetOffset + 42] = frameState.normalAOffset;
    target[targetOffset + 43] = frameState.normalBOffset;
  }

  private _getMeshWorldCenter(meshState: RendererMesh): Vec3 {
    const aabb = meshState.geometryState.renderAABB;
    if (!aabb) {
      this._worldMeshCenter[0] = meshState.worldMatrix[12];
      this._worldMeshCenter[1] = meshState.worldMatrix[13];
      this._worldMeshCenter[2] = meshState.worldMatrix[14];
      return this._worldMeshCenter;
    }
    this._meshCenter[0] = (aabb[0] + aabb[3]) * 0.5;
    this._meshCenter[1] = (aabb[1] + aabb[4]) * 0.5;
    this._meshCenter[2] = (aabb[2] + aabb[5]) * 0.5;
    transformPoint3(meshState.worldMatrix, this._meshCenter, this._worldMeshCenter);
    return this._worldMeshCenter;
  }

  private _getViewObject(sceneMesh: SceneMesh, view: View): ViewObject | null {
    const sceneObject = sceneMesh.object;
    if (!sceneObject) {
      return null;
    }
    return view.objects?.[sceneObject.id] ?? null;
  }

  private _ensureMeshMatrices(meshState: RendererMesh): void {
    if (!meshState.matrixDirty) {
      return;
    }

    const source = (meshState.mesh.worldMatrix ?? meshState.mesh.matrix ?? IDENTITY_MATRIX) as Mat4;
    for (let i = 0; i < 16; i++) {
      meshState.worldMatrix[i] = source[i] ?? IDENTITY_MATRIX[i];
    }

    meshState.matrixDirty = false;
  }

  private _materialHasRegisteredMeshes(sceneMaterial: SceneMaterial): boolean {
    const meshes = sceneMaterial.model?.meshes;
    if (!meshes) {
      return false;
    }
    for (const id in meshes) {
      const mesh = meshes[id];
      if (mesh.material === sceneMaterial && this._meshStates[mesh.uniqueId]) {
        return true;
      }
    }
    return false;
  }

  private _getViewObjectView(viewObject: ViewObject): View | null {
    return (viewObject as any).view ?? viewObject.layer?.view ?? null;
  }

  private _markStructureDirty(kind: "append" | "non-append", meshState?: RendererMesh): void {
    this._structureVersion++;
    if (kind === "append" && meshState) {
      this._createdMeshStateEvents.push({
        structureVersion: this._structureVersion,
        meshState
      });
    } else {
      this._lastNonAppendStructureVersion = this._structureVersion;
      this._createdMeshStateEvents.length = 0;
    }
    this._markInstanceDataDirty();
  }

  private _updateVariantSetMeshMemberships(variantSet: SceneVariantSet): void {
    let dirty = false;
    for (const variantId in variantSet.variants) {
      const objectIds = variantSet.variants[variantId].objectIds;
      for (let i = 0, len = objectIds.length; i < len; i++) {
        const sceneObject = variantSet.model.objects[objectIds[i]];
        if (!sceneObject) {
          continue;
        }
        const meshes = sceneObject.meshes;
        for (let j = 0, meshLen = meshes.length; j < meshLen; j++) {
          const meshState = this._meshStates[meshes[j].uniqueId];
          if (meshState && this._updateMeshLODVariantMembership(meshState)) {
            dirty = true;
          }
        }
      }
    }
    if (dirty) {
      this._markStructureDirty("non-append");
    }
  }

  private _updateMeshLODVariantMembership(meshState: RendererMesh): boolean {
    const memberships = getLODVariantMembershipsForObject(meshState.mesh.object);
    const key = createLODVariantMembershipKey(memberships);
    if (meshState.lodVariantMembershipKey === key) {
      return false;
    }
    meshState.lodVariantMemberships = memberships;
    meshState.lodVariantMembershipKey = key;
    return true;
  }

  private _markInstanceDataDirty(): void {
    this._instanceDataVersion++;
  }

  private _markMeshInstanceDataDirty(meshState: RendererMesh, markGlobal = true): void {
    meshState.instanceDataVersion++;
    if (markGlobal) {
      this._markInstanceDataDirty();
    }
  }

  private _markViewObjectMeshesInstanceDataDirty(viewObject: ViewObject): void {
    const sceneObject = viewObject.sceneObject;
    if (!sceneObject) {
      return;
    }
    let dirty = false;
    const meshes = sceneObject.meshes;
    for (let i = 0, len = meshes.length; i < len; i++) {
      const meshState = this._meshStates[meshes[i].uniqueId];
      if (!meshState) {
        continue;
      }
      this._markMeshInstanceDataDirty(meshState, false);
      dirty = true;
    }
    if (dirty) {
      this._markInstanceDataDirty();
    }
  }

  private _markMaterialMeshesDirty(sceneMaterial: SceneMaterial): void {
    const meshes = sceneMaterial.model?.meshes;
    if (!meshes) {
      return;
    }
    let dirty = false;
    for (const id in meshes) {
      const mesh = meshes[id];
      const meshState = this._meshStates[mesh.uniqueId];
      if (mesh.material !== sceneMaterial || !meshState) {
        continue;
      }
      this._markMeshInstanceDataDirty(meshState, false);
      dirty = true;
    }
    if (dirty) {
      this._markInstanceDataDirty();
    }
  }

  private _markAllViewStateDirty(): void {
    this._allViewStateVersion++;
  }

  private _ok<T = void>(value?: T): SDKResult<T> {
    return {
      ok: true,
      value: value as T
    };
  }

}

function writeNormalMatrixRows(matrix: Mat4, target: Float32Array, offset: number): void {
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  const det = a00 * b01 + a01 * b11 + a02 * b21;

  if (Math.abs(det) < 1e-12) {
    target[offset + 0] = a00;
    target[offset + 1] = a01;
    target[offset + 2] = a02;
    target[offset + 3] = 0;
    target[offset + 4] = a10;
    target[offset + 5] = a11;
    target[offset + 6] = a12;
    target[offset + 7] = 0;
    target[offset + 8] = a20;
    target[offset + 9] = a21;
    target[offset + 10] = a22;
    target[offset + 11] = 0;
    return;
  }

  const invDet = 1 / det;
  target[offset + 0] = b01 * invDet;
  target[offset + 1] = b11 * invDet;
  target[offset + 2] = b21 * invDet;
  target[offset + 3] = 0;
  target[offset + 4] = (-a22 * a01 + a02 * a21) * invDet;
  target[offset + 5] = (a22 * a00 - a02 * a20) * invDet;
  target[offset + 6] = (-a21 * a00 + a01 * a20) * invDet;
  target[offset + 7] = 0;
  target[offset + 8] = (a12 * a01 - a02 * a11) * invDet;
  target[offset + 9] = (-a12 * a00 + a02 * a10) * invDet;
  target[offset + 10] = (a11 * a00 - a01 * a10) * invDet;
  target[offset + 11] = 0;
}
