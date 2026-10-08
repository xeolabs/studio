import {withoutViewHistory} from "./ViewHistoryService";
import type {Data} from "@xeokit/sdk/model/data";
import type {Scene} from "@xeokit/sdk/model/scene";
import type {View, SectionPlane} from "@xeokit/sdk/viewing/viewer";
import {OrthoProjectionType, PlanViewNavigationMode, OrbitNavigationMode} from "@xeokit/sdk/base/constants";
import {getSceneCollisionIndex} from "@xeokit/sdk/spatial/collision";
import {cancelStudioCameraFlights} from "./StudioCameraFlight";
import {viewIsolation} from "./ViewIsolation";
import {projectedRange, unionBounds, validBounds, planScale} from "./sectionGeometry";
import {estimateFloorElevation, sceneMetersPerUnit} from "./planElevation";
import {capturePlanAppearance, restorePlanAppearance, applyPlanAppearance} from "./planAppearance";
import type {SectionState} from "../state/sectionState";

import type {SavedSection} from "../state/savedViewsState";

type Navigation = {navMode: number; pointerEnabled: boolean};
type CutSettings = Pick<SectionState, "enabled" | "orientation" | "verticalAxis" | "position" | "flipped">;
const cutSettings = (state: CutSettings): CutSettings => ({enabled: state.enabled, orientation: state.orientation,
  verticalAxis: state.verticalAxis, position: state.position, flipped: state.flipped});
const spatialRelationships = new Set(["IfcRelAggregates", "IfcRelContainedInSpatialStructure", "IfcRelNests"]);

/** A reversible floor-plan session; camera and visibility survive floor changes. */
export class SectionViewService {
  private plane: SectionPlane | null = null;
  private snapshot: ReturnType<SectionViewService["capture"]> | null = null;
  private floorObjects = new Map<string, string[]>();
  private floorSpaces = new Map<string, string[]>();
  private unsubscribers: Array<() => void> = [];
  private disposed = false;
  private refreshQueued = false;

  constructor(private readonly params: {
    data: Data; scene: Scene; view: View; state: SectionState;
    getInputController: () => Navigation | null;
  }) {
    const {data, scene} = params;
    const schedule = () => {
      if (this.refreshQueued || this.disposed) return;
      this.refreshQueued = true;
      queueMicrotask(() => { this.refreshQueued = false; if (!this.disposed) this.refresh(); });
    };
    for (const event of [data.events.onDataObjectCreated, data.events.onDataObjectDestroyed,
      data.events.onRelationshipCreated, data.events.onRelationshipDestroyed,
      scene.events.onSceneModelBuildFinished, scene.events.onSceneModelDestroyed,
      scene.events.onSceneModelCoordSystemUpdated]) {
      this.unsubscribers.push(event.subscribe(schedule));
    }
    this.refresh();
  }

  refresh(): void {
    const {data, view, scene, state} = this.params;
    const index = getSceneCollisionIndex(scene);
    this.floorObjects.clear();
    this.floorSpaces.clear();
    state.floors = Object.values(data.objects).filter(object => object.type === "IfcBuildingStorey").flatMap(floor => {
      const visited = new Set<string>(), ids: string[] = [], pending = [floor.id];
      while (pending.length) {
        const id = pending.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const object = data.objects[id];
        if (!object || (id !== floor.id && object.type === "IfcBuildingStorey")) continue;
        if (view.objects[id]) ids.push(id);
        for (const [type, relationships] of Object.entries(object.related)) if (spatialRelationships.has(type)) {
          for (const relationship of relationships) pending.push(relationship.relatedObject.id);
        }
      }
      const bounds = unionBounds(ids.map(id => index.getObjectAABB(id)));
      if (!bounds) return [];
      this.floorObjects.set(floor.id, ids);
      this.floorSpaces.set(floor.id, [...visited].filter(id => data.objects[id]?.type === "IfcSpace"));
      return [{id: floor.id, title: floor.name || floor.id, elevation: estimateFloorElevation(ids.map(id => ({type: data.objects[id]?.type || "", bounds: index.getObjectAABB(id)})), scene.coordinateSystem.worldUp)!}];
    }).sort((a, b) => a.elevation - b.elevation || a.title.localeCompare(b.title, undefined, {numeric: true}));
    if (state.planFloorId && !this.floorObjects.has(state.planFloorId)) this.returnTo3D();
  }

  getPlanTitle(): string { return this.params.state.planFloorTitle; }

  captureSavedState(): SavedSection {
    const {state, view} = this.params;
    return {...cutSettings(state), planFloorId: state.planFloorId, planCutHeight: state.planCutHeight,
      planStyle: state.planStyle, labelsEnabled: state.labelsEnabled, labelDensity: state.labelDensity,
      planes: Object.values(view.sectionPlanes).filter(plane => plane.active || plane === this.plane).map(plane => ({
        id: plane.id, managed: plane === this.plane, pos: Array.from(plane.pos), dir: Array.from(plane.dir), active: plane.active}))};
  }

  canRestoreSavedState(saved: SavedSection): boolean {
    this.refresh();
    return !saved.planFloorId || this.params.state.floors.some(floor => floor.id === saved.planFloorId);
  }

  restoreSavedState(saved: SavedSection): void {
    if (!this.canRestoreSavedState(saved)) throw new Error("The saved floor is not loaded.");
    // A recalled plan returns to the 3D context from which it was opened.
    this.returnTo3D();
    const {state, view} = this.params;
    state.planStyle = saved.planStyle;
    if (saved.planFloorId) this.showFloorPlan(saved.planFloorId);
    Object.assign(state, cutSettings(saved), {planCutHeight: saved.planCutHeight,
      labelsEnabled: saved.labelsEnabled, labelDensity: saved.labelDensity});
    if (saved.enabled || saved.planes.some(plane => plane.managed)) this.updatePlane();
    for (const plane of Object.values(view.sectionPlanes)) plane.active = false;
    for (const cut of saved.planes) {
      let plane = cut.managed ? this.plane : view.sectionPlanes[cut.id];
      if (!plane) {
        const result = view.createSectionPlane({id: cut.managed ? undefined : cut.id,
          pos: new Float64Array(cut.pos), dir: new Float64Array(cut.dir), active: cut.active});
        if (result.ok === false) throw new Error(result.error);
        plane = result.value;
        if (cut.managed) this.plane = plane;
      }
      plane.pos = new Float64Array(cut.pos); plane.dir = new Float64Array(cut.dir); plane.active = cut.active;
    }
  }

  getPlanObjectIds(): string[] { return this.floorObjects.get(this.params.state.planFloorId) || []; }
  getPlanSpaceIds(): string[] { return this.floorSpaces.get(this.params.state.planFloorId) || []; }

  togglePlanStyle(): void {
    this.params.state.planStyle = !this.params.state.planStyle;
    if (!this.snapshot) return;
    if (this.params.state.planStyle) applyPlanAppearance(this.params.view);
    else restorePlanAppearance(this.params.view, this.snapshot.appearance);
  }

  setOrientation(value: unknown): void {
    if (value !== "horizontal" && value !== "vertical") return;
    if (this.params.state.planFloorId) this.returnTo3D();
    Object.assign(this.params.state, {orientation: value, position: 50, flipped: false, enabled: true});
    this.updatePlane();
  }
  setVerticalAxis(value: unknown): void {
    if (value !== "front" && value !== "side") return;
    this.params.state.verticalAxis = value;
    this.params.state.enabled = true;
    this.updatePlane();
  }
  setPosition(value: unknown): void {
    const position = Number(value);
    if (!Number.isFinite(position)) return;
    Object.assign(this.params.state, {position: Math.max(0, Math.min(100, position)), enabled: true});
    this.updatePlane();
  }
  setPlanCutHeight(value: unknown): void {
    const height = Number(value);
    if (!this.params.state.planFloorId || !Number.isFinite(height)) return;
    Object.assign(this.params.state, {planCutHeight: Math.max(.1, Math.min(5, height)), enabled: true});
    this.updatePlane();
  }
  flip(): void {
    this.params.state.flipped = !this.params.state.flipped;
    this.updatePlane();
  }
  clear(): void {
    this.params.state.enabled = false;
    if (this.plane) this.plane.active = false;
  }

  showFloorPlan(id: string): void {
    withoutViewHistory(this.params.view, () => this.enterPlan(id));
  }
  private enterPlan(id: string): void {
    this.refresh();
    const {state, view} = this.params;
    const floor = state.floors.find(floor => floor.id === id);
    if (!floor) { state.error = "This floor has no model geometry to view."; return; }
    cancelStudioCameraFlights(view);
    if (!this.snapshot) this.snapshot = this.capture();
    viewIsolation(view).clear();
    for (const plane of Object.values(view.sectionPlanes)) plane.active = false;
    view.setObjectsVisible(Object.keys(view.objects), false);
    view.setObjectsVisible(this.floorObjects.get(id)!, true);
    Object.assign(state, {planFloorId: id, planFloorTitle: floor.title, orientation: "horizontal",
      flipped: false, planCutHeight: 1.2, enabled: true, error: ""});
    if (state.planStyle) applyPlanAppearance(view);
    this.setNavigation(PlanViewNavigationMode);
    this.updatePlane();
    this.fitPlan();
  }

  fitPlan(): void {
    const {view, scene, state} = this.params;
    if (!state.planFloorId) return;
    const bounds = this.bounds();
    if (!bounds) return;
    cancelStudioCameraFlights(view);
    const center = [0, 1, 2].map(i => (bounds[i] + bounds[i + 3]) / 2);
    const distance = Math.max(1, Math.hypot(...[0, 1, 2].map(i => bounds[i + 3] - bounds[i])) * 1.5);
    const {worldUp, worldForward, worldRight} = scene.coordinateSystem;
    view.camera.eye = Float64Array.from(center, (v, i) => v + worldUp[i] * distance);
    view.camera.look = new Float64Array(center);
    view.camera.up = worldForward;
    view.camera.projectionType = OrthoProjectionType;
    // The renderer boundary may lag one frame behind a toolbar/drawer resize.
    const viewport = view.htmlElement?.getBoundingClientRect?.();
    view.camera.orthoProjection.scale = planScale(bounds, worldRight, worldForward,
      viewport?.width || view.boundary[2], viewport?.height || view.boundary[3]);
  }

  returnTo3D(): void {
    if (this.snapshot) withoutViewHistory(this.params.view, () => this.leavePlan());
  }
  private leavePlan(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const {view, state} = this.params;
    cancelStudioCameraFlights(view);
    this.clear();
    for (const plane of Object.values(view.sectionPlanes)) plane.active = false;
    for (const saved of snapshot.planes) {
      const plane = view.sectionPlanes[saved.id];
      if (plane) { plane.pos = saved.pos; plane.dir = saved.dir; plane.active = saved.active; }
    }
    for (const visible of [true, false]) view.setObjectsVisible(snapshot.visibility
      .filter(([id, wasVisible]) => !!view.objects[id] && wasVisible === visible).map(([id]) => id), visible);
    viewIsolation(view).restoreSession(snapshot.isolation);
    restorePlanAppearance(view, snapshot.appearance);
    const camera = view.camera;
    camera.eye = snapshot.eye; camera.look = snapshot.look; camera.up = snapshot.up;
    camera.orthoProjection.scale = snapshot.scale; camera.projectionType = snapshot.projection;
    this.setNavigation(snapshot.navMode);
    Object.assign(state, snapshot.cut, {planFloorId: "", planFloorTitle: "", planLabels: [], error: ""});
    this.snapshot = null;
  }

  destroy(): void {
    this.disposed = true;
    this.returnTo3D();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.plane?.destroy();
  }

  private setNavigation(mode: number): void {
    const controller = this.params.getInputController();
    if (controller) {
      // Clear residual orbit/pan inertia before changing the camera.
      const enabled = controller.pointerEnabled;
      controller.pointerEnabled = false; controller.navMode = mode; controller.pointerEnabled = enabled;
    }
  }
  private capture() {
    const {view, state} = this.params, camera = view.camera;
    return {eye: new Float64Array(camera.eye), look: new Float64Array(camera.look), up: new Float64Array(camera.up),
      scale: camera.orthoProjection.scale, projection: camera.projectionType,
      navMode: this.params.getInputController()?.navMode ?? OrbitNavigationMode,
      visibility: Object.entries(view.objects).map(([id, object]) => [id, object.visible] as const),
      isolation: viewIsolation(view).captureSession(), cut: cutSettings(state), appearance: capturePlanAppearance(view),
      planes: Object.values(view.sectionPlanes).map(plane => ({id: plane.id, pos: new Float64Array(plane.pos),
        dir: new Float64Array(plane.dir), active: plane.active}))};
  }
  private bounds(): number[] | null {
    const {scene, state} = this.params;
    const index = getSceneCollisionIndex(scene);
    if (state.planFloorId) return unionBounds((this.floorObjects.get(state.planFloorId) || []).map(id => index.getObjectAABB(id)));
    const bounds = index.getSceneAABB();
    return validBounds(bounds) ? Array.from(bounds) : null;
  }
  private updatePlane(): void {
    const {state, scene, view} = this.params;
    const bounds = this.bounds();
    if (!bounds) { state.error = "Load a model to use section cuts."; state.enabled = false; return; }
    state.error = "";
    const axes = scene.coordinateSystem;
    const normal = state.orientation === "horizontal" ? axes.worldUp : state.verticalAxis === "front" ? axes.worldForward : axes.worldRight;
    const range = projectedRange(bounds, normal);
    const floor = state.floors.find(floor => floor.id === state.planFloorId);
    const distance = floor
      ? floor.elevation + state.planCutHeight / sceneMetersPerUnit(scene.coordinateSystem)
      : range[0] + (range[1] - range[0]) * state.position / 100;
    const pos = Float64Array.from(normal, value => value * distance);
    const dir = Float64Array.from(normal, value => value * (state.flipped ? -1 : 1));
    if (!this.plane || view.sectionPlanes[this.plane.id] !== this.plane) {
      const result = view.createSectionPlane({pos, dir, active: state.enabled});
      if (result.ok === false) { state.error = result.error || "Unable to create section cut."; state.enabled = false; return; }
      this.plane = result.value;
    } else { this.plane.pos = pos; this.plane.dir = dir; this.plane.active = state.enabled; }
  }
}
