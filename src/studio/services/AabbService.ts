import type {Scene, SceneObject} from "@xeokit/sdk/model/scene";
import type {Data} from "@xeokit/sdk/model/data";
import {getSceneCollisionIndex} from "@xeokit/sdk/spatial/collision";
import type {View} from "@xeokit/sdk/viewing/viewer";

export interface AabbObjectBoundary {
  id: string;
  title: string;
  modelId: string;
  layerId: string;
  meshCount: number;
  aabb: [number, number, number, number, number, number];
}

export interface AabbProjectionView {
  id: "top" | "front" | "side";
  label: string;
  ax0: number;
  ax1: number;
  flipV1: boolean;
}

export interface AabbPanelState {
  active: boolean;
  objects: AabbObjectBoundary[];
  sceneAabb: [number, number, number, number, number, number] | null;
  cameraEye: [number, number, number];
  cameraLook: [number, number, number];
  projectionViews: AabbProjectionView[];
  objectCount: number;
  indexedObjectCount: number;
  query: string;
  refreshing: boolean;
}

export interface AabbServiceParams {
  scene: Scene;
  data?: Data;
  view: View;
  state: AabbPanelState;
  resolveTitle?: (sceneObject: SceneObject) => string | null;
}

export function createAabbPanelState(): AabbPanelState {
  return {
    active: false,
    objects: [],
    sceneAabb: null,
    cameraEye: [0, 0, 0],
    cameraLook: [0, 0, 0],
    projectionViews: [
      {id: "top", label: "Top", ax0: 0, ax1: 2, flipV1: false},
      {id: "front", label: "Front", ax0: 0, ax1: 1, flipV1: true},
      {id: "side", label: "Side", ax0: 2, ax1: 1, flipV1: true}
    ],
    objectCount: 0,
    indexedObjectCount: 0,
    query: "",
    refreshing: false
  };
}

export class AabbService {
  private readonly _scene: Scene;
  private readonly _view: View;
  private readonly _state: AabbPanelState;
  private readonly _resolveTitle?: (sceneObject: SceneObject) => string | null;
  private readonly _unsubscribers: Array<() => void> = [];
  private _frame: number | null = null;
  private _objectsDirty = true;
  private _active = false;
  private _destroyed = false;

  constructor(params: AabbServiceParams) {
    this._scene = params.scene;
    this._view = params.view;
    this._state = params.state;
    this._resolveTitle = params.resolveTitle;
    this._state.projectionViews = getProjectionViews(params.scene);
    this._subscribe();
    if (params.data) {
      const refresh = () => this.scheduleRefresh();
      this._unsubscribers.push(
        params.data.events.onDataObjectCreated.subscribe(refresh),
        params.data.events.onDataObjectDestroyed.subscribe(refresh),
        params.data.events.onDataObjectUpdated.subscribe(refresh)
      );
    }
    this.refresh();
  }

  setActive(active: boolean): void {
    if (this._destroyed || this._active === active) return;
    this._active = active;
    if (active) this._scheduleUpdate();
    else this._cancelUpdate();
  }

  scheduleRefresh(): void {
    this._objectsDirty = true;
    this._scheduleUpdate();
  }

  private _scheduleUpdate(): void {
    if (this._destroyed || !this._active || this._frame !== null) return;
    this._state.refreshing = this._objectsDirty;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      if (this._destroyed || !this._active) return;
      if (this._objectsDirty) this.refresh();
      else this._updateCamera();
    });
  }

  refresh(): void {
    if (this._destroyed) return;
    this._objectsDirty = false;
    const collisionIndex = getSceneCollisionIndex(this._scene);
    const sceneAabb = collisionIndex.getSceneAABB();
    const objectsWithAabbs: AabbObjectBoundary[] = [];
    const objects = Object.values(this._scene.objects) as SceneObject[];

    for (const object of objects) {
      const aabb = collisionIndex.getObjectAABB(object.id);
      if (!aabb) {
        continue;
      }
      objectsWithAabbs.push({
        id: object.id,
        title: this._resolveTitle?.(object) || object.id,
        modelId: object.model.id,
        layerId: object.layerId || "default",
        meshCount: object.meshes.length,
        aabb: [aabb[0], aabb[1], aabb[2], aabb[3], aabb[4], aabb[5]]
      });
    }

    objectsWithAabbs.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    this._state.objects = objectsWithAabbs;
    this._state.sceneAabb = sceneAabb
      ? [sceneAabb[0], sceneAabb[1], sceneAabb[2], sceneAabb[3], sceneAabb[4], sceneAabb[5]]
      : null;
    this._updateCamera();
    this._state.projectionViews = getProjectionViews(this._scene);
    this._state.objectCount = objects.length;
    this._state.indexedObjectCount = objectsWithAabbs.length;
    this._state.refreshing = false;
  }

  destroy(): void {
    this._destroyed = true;
    this._cancelUpdate();
    while (this._unsubscribers.length > 0) {
      this._unsubscribers.pop()!();
    }
  }

  private _cancelUpdate(): void {
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._frame = null;
    this._state.refreshing = false;
  }

  private _updateCamera(): void {
    const {eye, look} = this._view.camera;
    if (this._state.cameraEye.some((value, i) => value !== eye[i])) this._state.cameraEye = toVec3(eye);
    if (this._state.cameraLook.some((value, i) => value !== look[i])) this._state.cameraLook = toVec3(look);
  }

  private _subscribe(): void {
    const events = this._scene.events;
    const refresh = () => this.scheduleRefresh();
    this._unsubscribers.push(
      events.onSceneObjectCreated.subscribe(refresh),
      events.onSceneObjectDestroyed.subscribe(refresh),
      events.onSceneObjectMeshAdded.subscribe(refresh),
      events.onSceneObjectMeshRemoved.subscribe(refresh),
      events.onSceneMeshCreated.subscribe(refresh),
      events.onSceneMeshDestroyed.subscribe(refresh),
      events.onSceneMeshMatrixChanged.subscribe(refresh),
      events.onSceneMeshMoved.subscribe(refresh),
      events.onSceneGeometryUpdated.subscribe(refresh),
      events.onSceneModelBuildFinished.subscribe(refresh),
      events.onSceneModelBatchCommitted.subscribe(refresh),
      events.onSceneModelDestroyed.subscribe(refresh),
      events.onSceneCoordSystemUpdated.subscribe(refresh),
      events.onSceneModelCoordSystemUpdated.subscribe(refresh),
      events.onSceneDestroyed.subscribe(() => this.destroy())
    );
    const viewerEvents = this._view.viewer?.events;
    if (viewerEvents?.onCameraViewMatrixUpdated?.subscribe) {
      this._unsubscribers.push(viewerEvents.onCameraViewMatrixUpdated.subscribe((view) => {
        if (view === this._view) this._scheduleUpdate();
      }));
    }
  }
}

function getProjectionViews(scene: Scene): AabbProjectionView[] {
  const coordinateSystem = scene.coordinateSystem;
  const upAxis = axisIndex(coordinateSystem.worldUp);
  const rightAxis = axisIndex(coordinateSystem.worldRight);
  const forwardAxis = axisIndex(coordinateSystem.worldForward);
  return [
    {id: "top", label: "Top", ax0: rightAxis, ax1: forwardAxis, flipV1: false},
    {id: "front", label: "Front", ax0: rightAxis, ax1: upAxis, flipV1: true},
    {id: "side", label: "Side", ax0: forwardAxis, ax1: upAxis, flipV1: true}
  ];
}

function axisIndex(vec: ArrayLike<number> | undefined | null): number {
  if (!vec || vec.length < 3) {
    return 1;
  }
  let bestAxis = 0;
  let bestMagnitude = Math.abs(vec[0]);
  for (let i = 1; i < 3; i++) {
    const magnitude = Math.abs(vec[i]);
    if (magnitude > bestMagnitude) {
      bestAxis = i;
      bestMagnitude = magnitude;
    }
  }
  return bestAxis;
}

function toVec3(values: ArrayLike<number>): [number, number, number] {
  return [Number(values[0]) || 0, Number(values[1]) || 0, Number(values[2]) || 0];
}
